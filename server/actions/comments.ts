import type { CommentsFixAllAgentOutput, CommentsFixAllOutput, RunScope, ReviewThread, FixOutput, WorktreeDetail } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import { getRun, startJob, startRun, type RunSpec } from '../lib/claude.ts'
import * as gh from '../lib/github.ts'
import * as schemas from '../schemas.ts'
import { HookRefused, blockOnRefusal, commitRepos, existingCommitUrl, linkedToCommit, repoOf, toBlocked } from './commitFlow.ts'
import { DIFFS_DIR, type WorktreeActions, linkedContext, linkedFixText, linkedForFix, prContext, specFrom, threadText } from './context.ts'

/**
 * Corrige un commentaire de review, puis commite, pousse, répond « DONE <commit> » et résout le fil.
 * Worktrees liés : l'agent peut les adapter quand la correction l'exige (voir commitLinked).
 */
/** Commentaires généraux de la PR pour un prompt : le contexte des commentaires de ligne (« ici », « pareil qu'au-dessus »). */
async function generalText(repo: string, num: number): Promise<string> {
  const list = await gh.generalComments(repo, num, true).catch(() => [])
  if (!list.length) return ''
  return [
    '## General PR comments (not attached to a line)',
    'Context for the line comments above: a reviewer often explains there what a short line comment ("here", "same") means.',
    ...list.map((g) => `- ${g.author} (${g.kind === 'review' ? `review, ${g.state?.toLowerCase().replace('_', ' ')}` : 'comment'}): ${g.body.replace(/\n/g, '\n  ')}`),
  ].join('\n')
}

async function commentFixSpec(d: WorktreeDetail, thread: ReviewThread, action: string, scope: RunScope, cwd: string): Promise<RunSpec> {
  const first = thread.comments[0]
  const fix = await linkedForFix(d)
  return specFrom('comment-fix', {
    'comment.file': thread.path, 'comment.line': thread.line, 'comment.author': first?.author, 'comment.body': first?.body, 'audit.action': action,
    linked: linkedFixText(fix.linked),
    general: d.pr ? await generalText(d.project.repo, d.pr.number) : '',
  }, {
    kind: 'comment-fix', title: `Corriger le commentaire de ${first?.author}`, scope: { ...scope, ref: thread.id }, cwd, schema: schemas.fixSchema,
    addDirs: fix.linked.map((l) => l.worktree.path),
    onSuccess: async (run) => {
      const out = run.structured as FixOutput
      // Correction déjà faite par un commit précédent : on y renvoie, après avoir vérifié qu'il est sur la branche et poussé.
      const already = !out.changed && out.alreadyFixed ? await existingCommitUrl(d, out.alreadyFixed) : null
      const repos = [...(out.changed ? [repoOf(d)] : []), ...(await linkedToCommit(fix, (e) => run.events.push(e)))]
      const urls = await commitRepos(repos, out.commitTitle).catch((e) => blockOnRefusal(run, e, out.commitTitle, [thread.id], already ? [already] : []))
      const links = [already, ...urls].filter(Boolean)
      if (!links.length) throw new Error(`L’agent n’a rien modifié, pas de réponse postée : ${out.summary}`)
      if (already) run.events.push({ t: 'info', text: `Déjà corrigé par ${already.split('/').pop()?.slice(0, 7)} : rien à commiter.` })
      await gh.replyToThread(thread.id, `DONE ${links.join(' ')}`, true)
      run.events.push({ t: 'info', text: `Réponse « DONE ${links.join(' ')} » postée et fil résolu.` })
    },
  })
}

export const commentsActions: WorktreeActions = {
  'followup-check': async ({ kind, project, scope, cwd, needPr, vars }) => {
    const pr = needPr()
    const [threads, login] = await Promise.all([gh.threads(project.repo, pr.number, true), gh.me()])
    const mine = threads.filter((t) => t.byMe && !t.isDraft && !t.isResolved)
    if (!mine.length) throw new HttpError(400, 'Aucun de tes commentaires n’est ouvert sur cette PR')
    const [ctxd, commits] = await Promise.all([prContext(project.repo, pr.number, { cwd: project.path, base: pr.base }), gh.reviewHistory(project.repo, pr.number)])
    const context = [
      ctxd.context,
      commits.since.length ? `## Author's commits since my last review\n${commits.since.map((c) => `- ${c.sha.slice(0, 7)} ${c.message}`).join('\n')}` : '',
      '## My open threads',
      mine.map((t) => threadText(t, login)).join('\n\n'),
    ].filter(Boolean).join('\n\n')
    return startRun(specFrom('followup-check', { ...vars, context, 'diff.path': ctxd.diffPath }, {
      kind, title: `Suivi des retours #${pr.number}`, scope, cwd, schema: schemas.followupSchema, addDirs: [DIFFS_DIR],
    }))
  },
  'comments-analyze': async ({ kind, project, d, scope, cwd, needPr, vars }) => {
    const pr = needPr()
    const open = (await gh.threads(project.repo, pr.number, true)).filter((t) => !t.isResolved && !t.awaitingReviewer)
    if (!open.length) throw new HttpError(400, 'Aucun commentaire non résolu')
    const context = open
      .map((t) => [
        `### threadId: ${t.id}`,
        `File: ${t.path}${t.line ? `:${t.line}` : ''}${t.isOutdated ? ' (line changed since)' : ''}`,
        ...t.comments.map((c) => `- ${c.author}: ${c.body.replace(/\n/g, '\n  ')}`),
      ].join('\n'))
      .join('\n\n')
    const linked = await linkedContext(d, 'comments')
    return startRun(specFrom('comments-analyze', { ...vars, context, general: await generalText(project.repo, pr.number), linked: linked.text }, { kind, title: `Analyse des commentaires #${pr.number}`, scope, cwd, schema: schemas.commentsSchema, addDirs: linked.dirs }))
  },
  'comment-fix': async ({ input, project, d, scope, cwd, needPr }) => {
    const pr = needPr()
    const thread = (await gh.threads(project.repo, pr.number, true)).find((t) => t.id === input.threadId)
    if (!thread) throw new HttpError(404, 'Fil de discussion introuvable')
    return startRun(await commentFixSpec(d, thread, input.action ?? 'apply the comment', scope, cwd))
  },
  'comments-fix-all': async ({ kind, input, project, d, scope, cwd, needPr }) => {
    // Un seul agent pour toutes les corrections, dans la session de l'analyse quand elle existe (il a déjà lu le code),
    // puis un seul commit : chaque fil corrigé reçoit « DONE » avec son lien.
    const pr = needPr()
    const items = input.items ?? []
    if (!items.length) throw new HttpError(400, 'Aucun commentaire à traiter')
    const analysis = input.previousRunId ? getRun(input.previousRunId) : null
    const session = analysis?.kind === 'comments-analyze' && analysis.scope.worktree === input.worktree ? analysis.sessionId : null
    return startJob({ kind, title: `Tout accepter · ${items.length} commentaire(s)`, scope: { ...scope, ref: 'fix-all' } }, async (ctx): Promise<CommentsFixAllOutput> => {
      const threads = await gh.threads(project.repo, pr.number, true)
      const results: CommentsFixAllOutput['results'] = []
      const where = (t: ReviewThread) => `${t.path}${t.line ? `:${t.line}` : ''}`
      const fixes: { thread: ReviewThread; action: string }[] = []
      for (const item of items) {
        const thread = threads.find((t) => t.id === item.threadId && !t.isResolved)
        if (!thread) {
          results.push({ threadId: item.threadId, verdict: item.verdict, ok: false, detail: 'Fil introuvable ou déjà résolu' })
          continue
        }
        if (item.verdict === 'fix') {
          fixes.push({ thread, action: item.action ?? 'apply the comment' })
          continue
        }
        try {
          await gh.replyToThread(thread.id, item.reply ?? '', true)
          ctx.log({ t: 'info', text: `${where(thread)} : réponse postée, fil résolu` })
          results.push({ threadId: thread.id, verdict: 'skip', ok: true, detail: 'Réponse postée' })
        } catch (e) {
          ctx.log({ t: 'error', text: `${where(thread)} : ${(e as Error).message}` })
          results.push({ threadId: thread.id, verdict: 'skip', ok: false, detail: (e as Error).message })
        }
      }
      if (fixes.length && !ctx.cancelled()) {
        const fix = await linkedForFix(d)
        let progress = 0
        ctx.log({ t: 'progress', done: 0, total: fixes.length, label: 'commentaires corrigés', at: Date.now() })
        ctx.log({ t: 'info', text: `Un agent pour ${fixes.length} correction(s)${session ? ', dans la session de l’analyse' : ''}…` })
        const r = await ctx.runChild(specFrom('comments-fix-all', {
          comments: fixes.map(({ thread, action }) => [
            `### threadId: ${thread.id}`,
            `File: ${where(thread)}`,
            ...thread.comments.map((c) => `- ${c.author}: ${c.body.replace(/\n/g, '\n  ')}`),
            `Validated fix: ${action}`,
          ].join('\n')).join('\n\n'),
          linked: linkedFixText(fix.linked),
          general: await generalText(project.repo, pr.number),
        }, {
          kind, title: `Corrections · ${fixes.length} commentaire(s)`, scope: { ...scope, ref: 'fix-all-part' }, cwd, schema: schemas.commentsFixAllSchema,
          addDirs: fix.linked.map((l) => l.worktree.path), resume: session,
          // L'agent tient une tâche TodoWrite par commentaire : ses tâches terminées font le compteur en direct.
          onTool: (name, input) => {
            if (name !== 'TodoWrite' || !Array.isArray(input.todos)) return
            const done = Math.min(fixes.length, (input.todos as { status?: string }[]).filter((t) => t.status === 'completed').length)
            if (done === progress) return
            progress = done
            ctx.log({ t: 'progress', done, total: fixes.length, label: 'commentaires corrigés', at: Date.now() })
          },
        }))
        const out = r.status === 'success' ? (r.structured as CommentsFixAllAgentOutput | null) : null
        if (!out) {
          const why = r.events.filter((e) => e.t === 'error').at(-1)?.text ?? (r.status === 'cancelled' ? 'Arrêté' : 'Échec de l’agent')
          for (const { thread } of fixes) results.push({ threadId: thread.id, verdict: 'fix', ok: false, detail: why })
          ctx.log({ t: 'error', text: why })
        } else {
          const fixed = out.items.filter((i) => i.status === 'fixed')
          const repos = fixed.length ? [repoOf(d), ...(await linkedToCommit(fix, ctx.log))] : []
          let links: string[] = []
          try {
            links = await commitRepos(repos, out.commitTitle)
          } catch (e) {
            if (!(e instanceof HookRefused)) throw e
            // Les corrections restent dans le worktree : leurs DONE partiront quand le commit passera (hook-fix).
            ctx.run.blockedCommit = toBlocked(e, out.commitTitle, fixed.map((i) => i.threadId), [])
            ctx.log({ t: 'error', text: e.message })
          }
          for (const { thread } of fixes) {
            const it = out.items.find((i) => i.threadId === thread.id)
            if (it?.status === 'fixed' && ctx.run.blockedCommit) {
              results.push({ threadId: thread.id, verdict: 'fix', ok: false, detail: 'Corrigé, mais commit refusé par un hook : solution à valider' })
              continue
            }
            const done = it?.status === 'fixed' ? links : it?.status === 'already' && it.alreadyFixed ? [await existingCommitUrl(d, it.alreadyFixed)].filter(Boolean) : []
            if (!done.length) {
              const detail = it?.summary || (it ? 'Rien n’a été modifié' : 'Non traité par l’agent')
              ctx.log({ t: 'error', text: `${where(thread)} : ${detail}` })
              results.push({ threadId: thread.id, verdict: 'fix', ok: false, detail })
              continue
            }
            try {
              await gh.replyToThread(thread.id, `DONE ${done.join(' ')}`, true)
              ctx.log({ t: 'info', text: `${where(thread)} : DONE posté` })
              results.push({ threadId: thread.id, verdict: 'fix', ok: true, detail: it?.summary ?? 'Corrigé, DONE posté' })
            } catch (e) {
              results.push({ threadId: thread.id, verdict: 'fix', ok: false, detail: (e as Error).message })
            }
          }
        }
        // Le compteur suivait la liste de tâches de l'agent, qui n'en tient pas toujours une : il finit sur le résultat réel.
        ctx.log({ t: 'progress', done: results.filter((x) => x.verdict === 'fix' && x.ok).length, total: fixes.length, label: 'commentaires corrigés', at: Date.now() })
      }
      gh.clearPrCache(project.repo)
      return { results }
    })
  },
  'comment-reply': async ({ kind, input, project, scope, cwd, needPr }) => {
    const pr = needPr()
    const thread = (await gh.threads(project.repo, pr.number, true)).find((t) => t.id === input.threadId)
    if (!thread) throw new HttpError(404, 'Fil de discussion introuvable')
    if (!input.extra?.trim()) throw new HttpError(400, 'Dis ce que tu veux répondre')
    const first = thread.comments[0]
    return startRun(
      specFrom('comment-reply', {
        'comment.file': thread.path, 'comment.line': thread.line, 'comment.author': first?.author, 'comment.body': first?.body, intent: input.extra.trim(),
      }, { kind, title: `Réponse à ${first?.author}`, scope: { ...scope, ref: thread.id }, cwd, schema: schemas.commentReplySchema }),
    )
  },
}
