import type { Run, HookFixPlanOutput, CommitFixOutput, FixOutput } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import { getRun, patchRun, startRun } from '../lib/claude.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import { checkReports, runReportCommand } from '../lib/checks.ts'
import * as schemas from '../schemas.ts'
import { rulesFor } from '../lib/rules.ts'
import { blockOnRefusal, commitAndPush, commitRepos } from './commitFlow.ts'
import { type WorktreeAction, type WorktreeActions, specFrom } from './context.ts'
import { warnOn } from '../lib/log.ts'

async function checksAction({ kind, input, project, d, scope, cwd, needPr, vars }: WorktreeAction): Promise<Run> {
  const pr = needPr()
  // Toujours l'état à jour du commentaire : le bot le réécrit à chaque push.
  const report = (await checkReports(project.repo, pr.number, true)).find((r) => r.id === input.report)
  if (!report) throw new HttpError(404, `Rapport « ${input.report} » introuvable sur la PR`)
  const runScope = { ...scope, pr: pr.number, ref: report.id }
  // L'analyse de ce rapport dont on reprend la session : l'agent a déjà lu les règles et le code.
  const prev = input.previousRunId ? getRun(input.previousRunId) : null
  const session = prev?.kind === 'checks-analyze' && prev.scope.worktree === scope.worktree && prev.scope.ref === report.id ? prev.sessionId : null
  if (kind === 'checks-analyze') {
    // Mon message sur l'analyse : l'agent la révise dans sa session, sans relancer le rapport qu'il a déjà.
    const feedback = input.feedback?.trim() || null
    const exchange = feedback && session ? session : null
    const local = !exchange && report.command ? await runReportCommand(report.command, cwd) : null
    const output = exchange
      ? '(unchanged: reuse the detailed report you already have, and rerun the command yourself if you need it fresh)'
      : local ? `${local.ok ? '' : 'The command failed. Output:\n'}\`\`\`\n${local.output || '(empty)'}\n\`\`\`` : '(no detailed report: work with the posted report)'
    return startRun(
      specFrom(kind, {
        ...vars, 'report.title': report.title, 'report.body': report.body, 'report.command': report.command ?? 'none: the posted report is complete',
        'report.output': output,
        feedback: feedback ? `## The user's message about your analysis\n\n${feedback}\n\nRevise your analysis accordingly: answer the message in summary, then return the complete list of items again (not only the ones that change), keeping the id of every item you keep. Reread the code if the message questions what you understood.` : '',
      }, {
        kind, title: feedback ? `Échange sur le contrôle · ${report.title}` : `Contrôle · ${report.title}`, scope: runScope, cwd, schema: schemas.checksAnalyzeSchema,
        note: feedback, resume: exchange,
      }),
    )
  }
  const items = input.checkItems ?? []
  if (!items.length) throw new HttpError(400, 'Choisis au moins un problème à corriger')
  const code = (label: string, text: string | null) => (text ? `\n  ${label}:\n${text.split('\n').map((l) => `      ${l}`).join('\n')}` : '')
  return startRun(
    specFrom(kind, {
      ...vars, 'report.title': report.title, 'report.command': report.command ?? 'none',
      items: items.map((i) => `- [${i.source}] ${i.file ? `${i.file}${i.line ? `:${i.line}` : ''}: ` : ''}${i.problem}\n  ${i.verdict === 'ask' ? 'Exception approved by the user' : 'Fix'}: ${i.fix}${code('Before', i.before)}${code('After', i.after)}`).join('\n'),
      session: session ? 'You made the analysis above in this conversation: you already read the rules, the code and its callers. Use it, reread only the files that changed since.' : '',
    }, {
      kind, title: `Corriger · ${report.title}`, scope: runScope, cwd, schema: schemas.fixSchema, resume: session,
      onSuccess: async (run) => {
        const out = run.structured as FixOutput
        if (!out.changed) return
        const url = await commitAndPush(d, out.commitTitle).catch((e) => blockOnRefusal(run, e, out.commitTitle))
        run.events.push({ t: 'info', text: url ? `Commit poussé, le contrôle va se relancer : ${url}` : 'Aucun changement à commiter.' })
      },
    }),
  )
}

async function hookFixAction({ kind, input, scope }: WorktreeAction): Promise<Run> {
  // Commit d'une correction refusé par un hook : proposer une solution (lecture seule), puis l'appliquer une fois
  // approuvée (ou la consigne que je donne à la place), recommiter, pousser et poster les DONE en attente.
  const blocked = input.previousRunId ? getRun(input.previousRunId) : null
  const b = blocked?.blockedCommit
  if (!blocked || !b) throw new HttpError(404, 'Aucun commit en attente sur ce run')
  if (b.resolvedBy) throw new HttpError(400, 'Ce commit est déjà passé')
  const files = (await Promise.all(b.repos.map(async (r) => (await git.dirtyFiles(r.path).catch(() => [])).map((f) => `- ${r.name}: ${f.status} ${f.path}`)))).flat()
  const common = {
    'commit.title': b.title, error: b.error, files: files.join('\n') || '(no changed file)',
    repos: b.repos.map((r) => `- ${r.name}: ${r.path}`).join('\n'),
  }
  const runScope = { ...scope, ref: blocked.id }
  const [first, ...others] = b.repos
  if (kind === 'hook-fix-plan') {
    return startRun(specFrom(kind, common, {
      kind, title: 'Solution au commit refusé', scope: runScope, cwd: first.path, addDirs: others.map((r) => r.path), schema: schemas.hookFixPlanSchema,
    }))
  }
  const plan = input.planRunId ? (getRun(input.planRunId)?.structured as HookFixPlanOutput | null) : null
  const instruction = input.feedback?.trim() || plan?.proposal
  if (!instruction) throw new HttpError(400, 'Approuve une solution ou dis quoi faire')
  return startRun(specFrom(kind, { ...common, instruction }, {
    kind, title: 'Correction du commit refusé', scope: runScope, cwd: first.path, addDirs: others.map((r) => r.path), schema: schemas.commitFixSchema,
    request: input.feedback?.trim() || null,
    onSuccess: async (run) => {
      const out = run.structured as CommitFixOutput
      if (!out.fixed) throw new Error(`Pas de correction : ${out.summary}`)
      const title = out.newTitle || (!input.feedback?.trim() && plan?.newTitle) || b.title
      // Refusé à nouveau : ce run porte à son tour le commit en attente (mêmes fils, mêmes commits déjà poussés).
      const urls = await commitRepos(b.repos, title).catch((e) => blockOnRefusal(run, e, title, b.threads, b.done))
      const links = [...b.done, ...urls]
      run.events.push({ t: 'info', text: urls.length ? `Commit poussé : ${urls.join(' ')}` : 'Rien à commiter.' })
      for (const t of b.threads) {
        if (!links.length) break
        await gh.replyToThread(t, `DONE ${links.join(' ')}`, true).then(
          () => run.events.push({ t: 'info', text: `DONE posté sur ${t}` }),
          (e: Error) => run.events.push({ t: 'error', text: `Réponse sur ${t} : ${e.message}` }),
        )
      }
      patchRun(blocked.id, { blockedCommit: { ...b, resolvedBy: run.id } })
    },
  }))
}

export const ciActions: WorktreeActions = {
  'checks-analyze': checksAction,
  'checks-fix': checksAction,
  'hook-fix-plan': hookFixAction,
  'hook-fix': hookFixAction,
  'ci-analyze-all': async ({ kind, project, scope, cwd, needPr, vars }) => {
    // Un seul agent pour tous les jobs en échec : logs récupérés ici, un diagnostic par job.
    const pr = needPr()
    const failing = pr.ci.jobs.filter((j) => j.state === 'fail' && j.jobId)
    if (!failing.length) throw new HttpError(400, 'Aucun job GitHub Actions en échec à analyser')
    const external = pr.ci.jobs.filter((j) => j.state === 'fail' && !j.jobId).map((j) => j.name)
    const logs = await Promise.all(failing.map(async (j) => {
      const log = await gh.failedJobLog(project.repo, j.jobId!, 150).catch(warnOn('gh.failedJobLog', null))
      // Pas de log (job jamais lancé) : l'annotation de GitHub dit pourquoi.
      const body = log ?? `No log. GitHub annotations:\n${(await gh.jobAnnotations(project.repo, j.jobId!)).join('\n') || '(none)'}`
      return [`### jobId: ${j.jobId} · ${j.workflow ? `${j.workflow} › ` : ''}${j.name}`, '```', body, '```'].join('\n')
    }))
    const behind = await git.behindRemote(cwd, pr.base)
    return startRun(specFrom('ci-analyze-all', {
      ...vars,
      'pr.base': pr.base,
      behind: behind ? `The branch is ${behind} commit(s) behind origin/${pr.base}.` : `The branch is up to date with origin/${pr.base}.`,
      external: external.length ? `Checks without a GitHub Actions log (result reports, external services), not to analyze: ${external.join(', ')}.` : '',
      context: logs.join('\n\n'),
    }, { kind, title: `CI · ${failing.length} job(s) en échec`, scope: { ...scope, pr: pr.number, ref: 'all' }, cwd, schema: schemas.ciAllSchema }))
  },
  'ci-fix-all': async ({ kind, input, d, scope, cwd, needPr }) => {
    const pr = needPr()
    const jobs = input.ciJobs ?? []
    if (!jobs.length) throw new HttpError(400, 'Aucun diagnostic à corriger')
    return startRun(
      specFrom('ci-fix-all', {
        rules: rulesFor(d.project.id),
        'pr.base': pr.base,
        jobs: jobs.map((j) => `### ${j.name}\nCause: ${j.cause}\nFix: ${j.fix}`).join('\n\n'),
      }, {
        kind, title: `Corriger ${jobs.length} job(s) CI`, scope: { ...scope, pr: pr.number, ref: 'all' }, cwd, schema: schemas.fixSchema,
        onSuccess: async (run) => {
          const out = run.structured as FixOutput
          if (!out.changed) return
          const url = await commitAndPush(d, out.commitTitle).catch((e) => blockOnRefusal(run, e, out.commitTitle))
          run.events.push({ t: 'info', text: url ? `Commit poussé, la CI va se relancer : ${url}` : 'Aucun changement à commiter.' })
        },
      }),
    )
  },
  'ci-analyze': async ({ kind, input, project, scope, cwd, needPr, vars }) => {
    const pr = needPr()
    const job = input.job
    if (!job?.jobId) throw new HttpError(400, 'Job GitHub Actions introuvable (check externe ?)')
    const log = await gh.failedJobLog(project.repo, job.jobId)
    const context = `## Failing log (last lines)\n\`\`\`\n${log}\n\`\`\``
    return startRun(
      specFrom('ci-analyze', { ...vars, 'job.name': job.name, 'job.workflow': job.workflow ?? '?', context }, {
        kind, title: `CI · ${job.name}`, scope: { ...scope, pr: pr.number, ref: job.jobId }, cwd, schema: schemas.ciSchema,
      }),
    )
  },
  'ci-fix': async ({ kind, input, d, scope, cwd, needPr }) => {
    needPr()
    const job = input.job
    if (!job || !input.ci) throw new HttpError(400, 'Diagnostic CI manquant')
    return startRun(
      specFrom('ci-fix', { rules: rulesFor(d.project.id), 'job.name': job.name, 'ci.cause': input.ci.cause, 'ci.fix': input.ci.fix }, {
        kind, title: `Corriger ${job.name}`, scope: { ...scope, ref: job.jobId ?? job.name }, cwd, schema: schemas.fixSchema,
        onSuccess: async (run) => {
          const out = run.structured as FixOutput
          if (!out.changed) return
          const url = await commitAndPush(d, out.commitTitle).catch((e) => blockOnRefusal(run, e, out.commitTitle))
          run.events.push({ t: 'info', text: url ? `Commit poussé, la CI va se relancer : ${url}` : 'Aucun changement à commiter.' })
        },
      }),
    )
  },
}
