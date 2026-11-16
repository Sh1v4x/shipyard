import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FindingsFixAllAgentOutput, FindingsFixAllOutput, PrReviewOutput, ReviewOutput, ReviewThread, FixOutput, SelfReviewMergeOutput } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import { getRun, listRuns, startJob, startRun, type JobContext, type RunSpec } from '../lib/claude.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import { rulesFor } from '../lib/rules.ts'
import * as schemas from '../schemas.ts'
import { HookRefused, blockOnRefusal, commitAndPush, toBlocked } from './commitFlow.ts'
import { DIFFS_DIR, type WorktreeActions, branchContext, linkedContext, localContext, pool, prContext, priorThreadsText, repoRules, specFrom, threadText } from './context.ts'
import { type Lot, SEVERITY_RANK, diffLines, finishReview, finishSelfReview, isMonorepo, mergeReviews, mergeSelfReviews, splitIntoLots } from './reviewDiff.ts'
import { earlierFixesText, lastPasses, passBefore, passOf, previousPassText, selfReviewDiffPath } from './selfReviewHistory.ts'
import { warnOn } from '../lib/log.ts'
import { reviewDecisionsPath } from '../lib/runArtifacts.ts'

/**
 * Relit une grosse PR en lots (un agent par lot, 5 en parallèle) : écrit le diff de chaque lot et le contexte
 * commun, lance l'agent, et renvoie la sortie de chaque lot (null s'il a échoué).
 */
async function reviewLots<T>(ctx: JobContext, opts: {
  repo: string
  /** Numéro de la PR, ou nom de la branche quand elle n'en a pas encore (nomme les fichiers de diff). */
  pr: number | string
  lots: Lot[]
  skipped: string[]
  commits: string[]
  /** Ajouté au contexte de chaque lot (peut dépendre du lot : ce que relisent les autres). */
  note: string | ((lot: Lot, i: number) => string)
  child: (lot: Lot, i: number, vars: { context: string; 'diff.path': string }) => RunSpec
  count: (out: T) => number
}): Promise<{ zone: string; out: T | null }[]> {
  const totalFiles = opts.lots.reduce((a, l) => a + l.files, 0)
  ctx.log({ t: 'info', text: `PR de ${totalFiles} fichiers découpée en ${opts.lots.length} lots : ${opts.lots.map((l) => `${l.name} (${l.files})`).join(', ')}` })
  if (opts.skipped.length) ctx.log({ t: 'info', text: `Ignorés (lockfiles, générés) : ${opts.skipped.join(', ')}` })
  return pool(opts.lots, 5, async (l, i) => {
    const lotPath = join(DIFFS_DIR, `${opts.repo.replace('/', '__')}-${opts.pr}-lot${i + 1}.diff`)
    writeFileSync(lotPath, l.diff)
    const context = [
      '## Commits', opts.commits.map((c) => `- ${c}`).join('\n'), '',
      '## Batch',
      `The PR has ${totalFiles} files: it is reviewed in ${opts.lots.length} batches by reviewers in parallel. This batch (${i + 1}/${opts.lots.length}, "${l.name}") covers ${l.files} files and ${l.lines} diff lines, in ${lotPath}.`,
      'Only report on the files of this batch, but read anything else in the repository you need to understand them (callers, types, neighbouring components). This batch\'s diff is short enough to be read in full: read all of it.',
      typeof opts.note === 'string' ? opts.note : opts.note(l, i),
    ].filter(Boolean).join('\n')
    const r = await ctx.runChild(opts.child(l, i, { context, 'diff.path': lotPath }))
    const out = r.structured as T | null
    ctx.log(out ? { t: 'info', text: `${l.name} : ${opts.count(out)} remarque(s)` } : { t: 'error', text: `${l.name} : relecture en échec` })
    return { zone: l.name, out }
  })
}

/**
 * Mode re-review si j'ai déjà commenté la PR : mes fils de discussion et les patchs poussés par l'auteur
 * depuis ma dernière review (écrits sur disque). Renvoie null en mode review.
 */
/**
 * Points de la review IA précédente sur ce worktree que j'ai écartés au tri (ignorés, ou tous leurs emplacements retirés) :
 * une nouvelle review ne doit pas les ressortir.
 */
function dismissedFromLastReview(project: string, worktree: string): string {
  const last = listRuns({ project, worktree, kind: 'review', status: 'success' }, 1)[0]
  const out = last && (getRun(last.id)?.structured as PrReviewOutput | null)
  const path = last && reviewDecisionsPath(last.id)
  if (!out || !path || !existsSync(path)) return ''
  const d = JSON.parse(readFileSync(path, 'utf8')) as { ignored?: string[]; dropped?: string[] }
  const dismissed = out.comments.filter((c) => d.ignored?.includes(c.id) || (d.dropped?.includes(c.id) && c.also.every((_, i) => d.dropped?.includes(`${c.id}#${i}`))))
  if (!dismissed.length) return ''
  return [
    '### Points I dismissed in my previous review',
    'I judged them irrelevant: do not raise them again, even reworded, unless the code changed at that spot and the problem has become real.',
    ...dismissed.map((c) => `- ${c.file}:${c.line}: ${c.body.replace(/\n/g, ' ').slice(0, 300)}`),
  ].join('\n')
}

/**
 * Ce que l'agent de correction doit savoir de l'auto-review d'où viennent les remarques : son résumé, et celles que
 * j'ai ignorées au tri (à ne pas appliquer au passage).
 */
function selfReviewNotes(runId: string | undefined): string {
  const out = runId ? (getRun(runId)?.structured as ReviewOutput | null) : null
  if (!out?.findings) return ''
  const path = reviewDecisionsPath(runId!)
  const ignored = existsSync(path) ? ((JSON.parse(readFileSync(path, 'utf8')) as { ignored?: string[] }).ignored ?? []) : []
  const dismissed = out.findings.filter((f) => ignored.includes(f.id))
  return [
    '## The self-review these findings come from',
    out.summary,
    dismissed.length ? `Findings the user dismissed (they judged them wrong or not worth it): do not apply them, even in passing while fixing a neighbouring one.\n${dismissed.map((f) => `- ${f.file}:${f.line}: ${f.title}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

async function reReviewContext(repo: string, num: number, threads: ReviewThread[], login: string): Promise<{ text: string; threadIds: Set<string> } | null> {
  const [hist, files] = await Promise.all([gh.reviewHistory(repo, num), gh.prFiles(repo, num, undefined, true)])
  // Les fils de ma review en attente (brouillon jamais envoyé) ne sont pas des échanges avec l'auteur : on les ignore.
  const all = threads.filter((t) => t.byMe && !t.isDraft)
  // Ceux que j'ai résolus moi-même sont tranchés (correctif validé, ou argument de l'auteur accepté) : pas de suivi.
  const mine = all.filter((t) => !t.resolvedByMe)
  const closed = all.filter((t) => t.resolvedByMe)
  if (!hist.lastReview && !all.length) return null

  const inPr = new Set(files.files.map((f) => f.path))
  let note = ''
  let patches: { filename: string; patch?: string; from: string }[] = []
  if (hist.lastReview && hist.refFound) {
    for (const c of hist.since) patches.push(...(await gh.commitPatches(repo, c.sha)).map((f) => ({ ...f, from: `${c.sha.slice(0, 7)} ${c.message}` })))
  } else if (hist.lastReview) {
    const cmp = await gh.comparePatches(repo, hist.lastReview.sha, hist.head).catch(warnOn('gh.comparePatches', null))
    if (cmp) {
      patches = cmp.map((f) => ({ ...f, from: 'compare' }))
      note = 'The branch was rewritten (force-push or rebase) since my last review: the changes come from a compare.'
    } else note = 'The branch was rewritten and the compare failed: review all the files of the PR.'
  } else note = 'I only commented outside of a review: review all the files of the PR (full diff), in addition to following up on my threads.'
  patches = patches.filter((p) => inPr.has(p.filename))

  const sincePath = join(DIFFS_DIR, `${repo.replace('/', '__')}-${num}-since.diff`)
  writeFileSync(sincePath, patches.map((p) => `### ${p.filename} (${p.from})\n${p.patch ?? '(patch too large: read the file)'}`).join('\n\n'))
  const changed = [...new Set(patches.map((p) => p.filename))]

  return {
    text: [
      '## Re-review mode',
      hist.lastReview ? `Last review: commit ${hist.lastReview.sha.slice(0, 7)} (${hist.lastReview.at}) → now ${hist.head.slice(0, 7)}.` : '',
      hist.since.length ? `Author's commits since then (merges excluded):\n${hist.since.map((c) => `- ${c.sha.slice(0, 7)} ${c.message}`).join('\n')}` : 'No commit from the author since my last review.',
      note,
      changed.length ? `Files to review (patches in ${sincePath}):\n${changed.map((f) => `- ${f}`).join('\n')}`
        : hist.lastReview && hist.refFound ? 'No file changed since: only follow up on the comments.' : '',
      '',
      '### My discussion threads',
      ...(mine.length ? mine.map((t) => threadText(t, login)) : ['No open thread of mine.']),
      ...(closed.length ? ['', '### My threads I resolved myself', 'Settled: fix validated, or the author\'s argument accepted. Do not reopen them or raise their topic again, unless a recent commit breaks that point again.', ...closed.map((t) => threadText(t, login))] : []),
    ].filter(Boolean).join('\n'),
    threadIds: new Set(all.map((t) => t.id)),
  }
}

/** Le commit est fait (rien en attente dans le worktree) et la branche a des commits que GitHub n'a pas : seul le push a échoué. */
async function committedNotPushed(cwd: string, branch: string | null): Promise<boolean> {
  if (!branch) return false
  const [dirty, unpushed] = await Promise.all([git.dirtyFiles(cwd).catch(() => null), git.unpushedCount(cwd, branch)])
  return !!dirty && !dirty.length && unpushed > 0
}

export const reviewActions: WorktreeActions = {
  'self-review': async ({ kind, input, project, d, scope, cwd, vars }) => {
    // Sans PR, la relecture porte sur la branche face à origin/<base> : de quoi corriger avant d'ouvrir la PR.
    const pr = d.pr
    if (!pr && d.worktree.kind === 'review') throw new HttpError(400, 'Ce worktree n’a pas de PR')
    const [ctxd, threads, login] = pr
      ? await Promise.all([prContext(project.repo, pr.number, { cwd: project.path, base: pr.base }), gh.threads(project.repo, pr.number, true), gh.me()])
      : [await localContext(d), [], '']
    if (!ctxd.diff.trim()) throw new HttpError(409, `Rien à relire : la branche n’a aucun changement face à origin/${project.baseBranch}`)
    const name = pr ? `#${pr.number}` : d.worktree.branch ?? 'la branche'
    const selfVars = {
      ...vars, rules: rulesFor(project.id), threads: pr ? priorThreadsText(threads, login) : 'None: the PR is not open yet.',
      subject: pr ? `my PR #${pr.number} (${pr.title})` : `my branch ${d.worktree.branch ?? ''}, before I open its PR (changes compared with origin/${project.baseBranch})`,
    }
    const spec = { schema: schemas.reviewSchema, addDirs: [DIFFS_DIR], cwd }
    // Passe précédente : ce qu'elle a relevé et ce que l'agent de correction en a fait. La nouvelle passe vérifie et complète.
    const [prevRun, ...olderRuns] = lastPasses(project.id, input.worktree!, 10)
    const prev = prevRun ? passOf(prevRun) : null
    // Après une première passe, la suivante est une vérification : elle suit les corrections et ne relève de nouveau que
    // les vrais problèmes. Sans cela chaque passe trouve dix nouveaux détails et la boucle ne finit jamais.
    // « Relecture complète » (action full) repart sur une review entière, par exemple après un nouveau développement.
    const verify = !!prev && input.action !== 'full'
    const history = { verify, earlier: olderRuns.map(passOf) }
    const outOfScope = (log: (text: string) => void) => (dropped: { file: string; line: number; title: string }[]) =>
      log(`Hors de la PR, écartée(s) : ${dropped.map((f) => `${f.file}:${f.line} ${f.title}`).join(' · ')} (code que la branche n’a pas écrit).`)
    /** Passe de vérification : les nouvelles suggestions sont écartées, quoi qu'en dise l'agent. */
    const closing = (out: ReviewOutput, log?: (text: string) => void): ReviewOutput => {
      if (!verify) return out
      const kept = out.findings.filter((f) => f.severity !== 'suggestion' || f.previousId)
      if (kept.length < out.findings.length) log?.(`Passe de vérification : ${out.findings.length - kept.length} nouvelle(s) suggestion(s) écartée(s) (« Relecture complète » pour les voir).`)
      return { ...out, findings: kept }
    }
    // Le diff relu est gardé : la passe suivante saura quels fichiers ont changé depuis.
    const keepDiff = (runId: string) => writeFileSync(selfReviewDiffPath(runId), ctxd.diff)
    // Même découpage que la review : au-delà d'un diff raisonnable, un agent par lot.
    const { lots, skipped } = splitIntoLots(ctxd.diff, isMonorepo(project.path))
    if (lots.length >= 2) {
      const filesOf = lots.map((l) => [...diffLines(l.diff).keys()])
      const batches = (except?: number) => lots.map((l, i) => (i === except ? '' : `- Batch ${i + 1} "${l.name}" (${l.files} files): ${filesOf[i].slice(0, 60).join(', ')}${filesOf[i].length > 60 ? '…' : ''}`)).filter(Boolean).join('\n')
      return startJob({ kind, title: `Auto-review ${name} · ${lots.length} lots`, scope }, async (ctx): Promise<ReviewOutput> => {
        if (prev) ctx.log({ t: 'info', text: `${verify ? 'Passe de vérification' : 'Relecture complète'} : ${prev.items.filter((i) => i.status === 'fixed').length} correction(s) à vérifier, ${prev.items.filter((i) => i.status === 'ignored').length} remarque(s) ignorée(s) à ne pas ressortir.` })
        const parts = await reviewLots<ReviewOutput>(ctx, {
          repo: project.repo, pr: pr?.number ?? (d.worktree.branch ?? 'branch').replace(/[^\w.-]/g, '_'), lots, skipped, commits: ctxd.commits,
          // Chaque lot sait ce que relisent les autres : il vérifie ce qui le relie à eux, sans relire leurs fichiers.
          note: (_l, i) => [
            '## The other batches',
            'Reviewed at the same time by other reviewers. Do not report on their files, but when a file of your batch depends on one of theirs (API route and the screen that calls it, shared type or schema, translation key), open it and check that both sides agree: a mismatch is a finding, placed on the line of your batch. A last reviewer then reads all the findings together.',
            batches(i),
          ].join('\n'),
          child: (l, i, v) => specFrom('self-review', { ...selfVars, ...v, previous: previousPassText(prev, ctxd.diff, { ...history, files: new Set(filesOf[i]) }) }, { ...spec, kind: 'self-review-part', title: `Auto-review ${name} · ${l.name}`, scope: { ...scope, ref: `lot${i + 1}` } }),
          count: (out) => out.findings.length,
        })
        const ok = parts.filter((p): p is { zone: string; out: ReviewOutput } => !!p.out)
        if (!ok.length) throw new Error('Toutes les auto-reviews de lot ont échoué')
        const merged = mergeSelfReviews(ok)
        // Relecture d'ensemble : les lots ne se voient pas entre eux. Un dernier agent lit toutes leurs remarques,
        // retire doublons et contradictions, et cherche ce qui tient à plusieurs lots (contrat API / écran…).
        const whole = await ctx.runChild(specFrom('self-review-merge', {
          ...selfVars, 'diff.path': ctxd.diffPath, batches: batches(),
          findings: merged.findings.map((f) => `### id: ${f.id}\n${f.file}:${f.line} · ${f.severity} · ${f.title}\n${f.body}\nFix: ${f.fix}`).join('\n\n') || '(no finding)',
          previous: previousPassText(prev, ctxd.diff, history),
        }, { ...spec, schema: schemas.selfReviewMergeSchema, kind: 'self-review-part', title: `Auto-review ${name} · relecture d’ensemble`, scope: { ...scope, ref: 'merge' } }))
        const all = whole.status === 'success' ? (whole.structured as SelfReviewMergeOutput | null) : null
        if (all) {
          const drop = new Map(all.drop.map((x) => [x.id, x.reason]))
          const kept = merged.findings.filter((f) => !drop.has(f.id))
          ctx.log({ t: 'info', text: `Relecture d’ensemble : ${merged.findings.length - kept.length} doublon(s) ou contradiction(s) retiré(s), ${all.add.length} remarque(s) entre lots ajoutée(s).` })
          for (const f of merged.findings) if (drop.has(f.id)) ctx.log({ t: 'info', text: `Retirée · ${f.file}:${f.line} ${f.title} : ${drop.get(f.id)}` })
          merged.findings = [...kept, ...all.add.map((f, i) => ({ ...f, id: `x${i + 1}` }))].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
          merged.summary = all.summary
        } else ctx.log({ t: 'info', text: 'Relecture d’ensemble en échec : les remarques des lots sont gardées telles quelles.' })
        const failed = parts.filter((p) => !p.out).map((p) => p.zone)
        if (failed.length) merged.summary += `\n\n(Lots non relus suite à une erreur : ${failed.join(', ')}.)`
        keepDiff(ctx.run.id)
        return finishSelfReview(closing(merged, (text) => ctx.log({ t: 'info', text })), ctxd.diff, cwd, { read: [...lots.map((l) => l.diff), ctxd.diff], size: !verify, onOutOfScope: outOfScope((text) => ctx.log({ t: 'info', text })) })
      })
    }
    const id = randomUUID()
    return startRun(
      specFrom(kind, { ...selfVars, context: ctxd.context, 'diff.path': ctxd.diffPath, previous: previousPassText(prev, ctxd.diff, history) }, {
        ...spec, id, kind, title: `Auto-review ${name}`, scope,
        onSuccess: async (run) => {
          if (run.structured) run.structured = finishSelfReview(closing(run.structured as ReviewOutput, (text) => run.events.push({ t: 'info', text })), ctxd.diff, cwd, { size: !verify, onOutOfScope: outOfScope((text) => run.events.push({ t: 'info', text })) })
          keepDiff(id)
        },
      }),
    )
  },
  review: async ({ kind, input, project, d, scope, cwd, needPr, vars }) => {
    const pr = needPr()
    const local = { cwd: project.path, base: pr.base }
    const [threads, login] = await Promise.all([gh.threads(project.repo, pr.number, true), gh.me()])
    const [ctxd, rr, rules, linked] = await Promise.all([prContext(project.repo, pr.number, local), reReviewContext(project.repo, pr.number, threads, login), repoRules(project), linkedContext(d, 'review')])
    const reviewVars = {
      ...vars, repo: project.name, linked: linked.text, mode: rr ? 're-review' : 'review', rules: rules.text, rereview: rr?.text ?? 'Review mode: no previous review of mine.',
      // Mes fils sont déjà dans le contexte de re-review : ici, ceux des autres reviewers (et les miens en mode review).
      threads: [priorThreadsText(threads, login, rr?.threadIds), dismissedFromLastReview(project.id, input.worktree!)].filter(Boolean).join('\n\n'),
    }
    const spec = { schema: schemas.prReviewSchema, addDirs: [DIFFS_DIR, ...rules.dirs, ...linked.dirs], cwd }

    // Grosse PR : une review par lot (zone du mono-repo puis dossier, ~3 000 lignes), en parallèle, puis fusion.
    // Pas en re-review : elle ne porte déjà que sur ce qui a changé depuis ma dernière review.
    const { lots, skipped } = rr ? { lots: [], skipped: [] } : splitIntoLots(ctxd.diff, isMonorepo(project.path))
    if (lots.length >= 2) {
      return startJob({ kind, title: `Review #${pr.number} · ${lots.length} lots`, scope }, async (ctx): Promise<PrReviewOutput> => {
        const parts = await reviewLots<PrReviewOutput>(ctx, {
          repo: project.repo, pr: pr.number, lots, skipped, commits: ctxd.commits,
          note: 'For recurring issues, give short and generic pattern names: identical patterns across batches will be merged into a single comment.',
          child: (l, i, v) => specFrom('review', { ...reviewVars, ...v }, { ...spec, kind: 'review-part', title: `Review #${pr.number} · ${l.name}`, scope: { ...scope, ref: `lot${i + 1}` } }),
          count: (out) => out.comments.length,
        })
        const ok = parts.filter((p): p is { zone: string; out: PrReviewOutput } => !!p.out)
        if (!ok.length) throw new Error('Toutes les reviews de lot ont échoué')
        const merged = mergeReviews(ok)
        const failed = parts.filter((p) => !p.out).map((p) => p.zone)
        if (failed.length) merged.summary += `\n\n(Lots non relus suite à une erreur : ${failed.join(', ')}.)`
        ctx.log({ t: 'info', text: `Fusion : ${merged.comments.length} commentaire(s), dont ${merged.comments.filter((c) => c.also.length).length} motif(s) récurrent(s)` })
        return finishReview(merged, ctxd.diff, cwd)
      })
    }

    return startRun(
      specFrom(kind, { ...reviewVars, context: ctxd.context, 'diff.path': ctxd.diffPath }, {
        ...spec, kind, title: `${rr ? 'Re-review' : 'Review'} #${pr.number}`, scope,
        onSuccess: async (run) => {
          if (run.structured) run.structured = finishReview(run.structured as PrReviewOutput, ctxd.diff, cwd)
        },
      }),
    )
  },
  'findings-fix-all': async ({ kind, input, project, d, scope, cwd }) => {
    // Un seul agent pour toutes les remarques acceptées de l'auto-review (au lieu d'un agent par remarque), un seul commit.
    const findings = input.findings ?? []
    if (!findings.length) throw new HttpError(400, 'Aucune remarque acceptée')
    return startJob({ kind, title: `Corriger ${findings.length} remarque(s) de l’auto-review`, scope: { ...scope, ref: input.ref } }, async (ctx): Promise<FindingsFixAllOutput> => {
      let progress = 0
      ctx.log({ t: 'progress', done: 0, total: findings.length, label: 'remarques corrigées', at: Date.now() })
      // Périmètre de la PR : les fichiers que la branche modifie déjà (commités ou en cours). L'agent doit y rester.
      const base = d.pr?.base ?? project.baseBranch
      const prFiles = new Set([...(await git.changedFiles(cwd, base).catch(() => [])), ...d.dirtyFiles.map((f) => f.path)])
      const r = await ctx.runChild(specFrom('findings-fix-all', {
        scope: [...prFiles].sort().map((f) => `- ${f}`).join('\n') || '(none)',
        // Le travail de la branche (ticket, commits, corrections déjà faites) : l'agent s'y adapte au lieu d'appliquer à la lettre.
        context: await branchContext(d),
        review: [selfReviewNotes(input.ref), earlierFixesText((() => { const before = passBefore(project.id, input.worktree!, input.ref); return before ? passOf(before) : null })())].filter(Boolean).join('\n\n'),
        findings: findings.map((f) => [
          `### id: ${f.id}`,
          `${f.file}:${f.line} · ${f.severity} · ${f.title}`,
          f.body,
          `Fix: ${f.fix}`,
        ].join('\n')).join('\n\n'),
        rules: rulesFor(project.id),
      }, {
        kind, title: `Corrections · ${findings.length} remarque(s)`, scope: { ...scope, ref: `${input.ref}-part` }, cwd, schema: schemas.findingsFixAllSchema,
        onTool: (name, input) => {
          if (name !== 'TodoWrite' || !Array.isArray(input.todos)) return
          const done = Math.min(findings.length, (input.todos as { status?: string }[]).filter((t) => t.status === 'completed').length)
          if (done === progress) return
          progress = done
          ctx.log({ t: 'progress', done, total: findings.length, label: 'remarques corrigées', at: Date.now() })
        },
      }))
      const out = r.status === 'success' ? (r.structured as FindingsFixAllAgentOutput | null) : null
      if (!out) throw new Error(r.events.filter((e) => e.t === 'error').at(-1)?.text ?? (r.status === 'cancelled' ? 'Arrêté' : 'Échec de l’agent'))
      const outside = (await git.dirtyFiles(cwd).catch(() => [])).map((f) => f.path).filter((f) => !prFiles.has(f))
      if (outside.length) ctx.log({ t: 'info', text: `⚠ Fichiers touchés hors de la PR (à vérifier ou annuler avant de commiter) : ${outside.join(', ')}` })
      let url: string | null = null
      // Avant la PR, rien n'est commité : les corrections rejoignent le travail en cours, à commiter avec lui.
      if (!d.pr) ctx.log({ t: 'info', text: 'Pas encore de PR : les corrections restent dans le worktree, à commiter avec la carte Commiter (onglet Ticket).' })
      else if (out.items.some((i) => i.status === 'fixed')) {
        try {
          url = await commitAndPush(d, out.commitTitle)
          ctx.log({ t: 'info', text: url ? `Commit poussé : ${url}` : 'Aucun changement à commiter.' })
        } catch (e) {
          if (e instanceof HookRefused) {
            ctx.run.blockedCommit = toBlocked(e, out.commitTitle, [], [])
            ctx.log({ t: 'error', text: e.message })
          } else if (await committedNotPushed(cwd, d.worktree.branch)) {
            // Commit fait, seul le push a échoué : les corrections sont acquises, il reste à pousser la branche.
            ctx.log({ t: 'error', text: `Corrections commitées, mais le push a échoué : pousse la branche (onglet À jour). ${(e as Error).message}` })
          } else throw e
        }
      }
      const blocked = !!ctx.run.blockedCommit
      const results = findings.map((f) => {
        const it = out.items.find((i) => i.id === f.id)
        const ok = it?.status === 'already' || (it?.status === 'fixed' && !blocked)
        const detail = it?.status === 'fixed' && blocked ? 'Corrigé, mais commit refusé par un hook : solution à valider'
          : it?.status === 'declined' ? `Refusée par l’agent : ${it.summary}` : it?.summary ?? 'Non traité par l’agent'
        return { id: f.id, ok, detail, ...(it?.status === 'declined' && { declined: true }) }
      })
      // Le compteur suivait la liste de tâches de l'agent, qui n'en tient pas toujours une : il finit sur le résultat réel.
      ctx.log({ t: 'progress', done: results.filter((x) => x.ok).length, total: findings.length, label: 'remarques corrigées', at: Date.now() })
      return { url, results }
    })
  },
  'finding-fix': async ({ kind, input, d, scope, cwd }) => {
    const f = input.finding
    if (!f) throw new HttpError(400, 'Remarque manquante')
    return startRun(
      specFrom('finding-fix', {
        rules: rulesFor(d.project.id),
        'finding.file': f.file, 'finding.line': f.line, 'finding.severity': f.severity, 'finding.title': f.title, 'finding.body': f.body, 'finding.fix': f.fix,
        context: await branchContext(d),
      }, {
        kind, title: `Corriger ${f.file}:${f.line}`, scope: { ...scope, ref: input.ref ?? f.id }, cwd, schema: schemas.fixSchema,
        onSuccess: async (run) => {
          const out = run.structured as FixOutput
          if (!out.changed || !d.pr) return
          const url = await commitAndPush(d, out.commitTitle).catch((e) => blockOnRefusal(run, e, out.commitTitle))
          run.events.push({ t: 'info', text: url ? `Commit poussé : ${url}` : 'Aucun changement à commiter.' })
        },
      }),
    )
  },
}
