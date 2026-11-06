import { stripVTControlCharacters } from 'node:util'

import type { BaseSyncOutput, MergeState, MergeFinishOutput, RunScope, CommitFixOutput, WorktreeDetail } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import { getRun, startJob, startRun, type JobContext, type RunSpec } from '../lib/claude.ts'
import { CommandError, run } from '../lib/exec.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import { rulesFor } from '../lib/rules.ts'
import { sdkStatus } from '../lib/sdk.ts'
import * as schemas from '../schemas.ts'
import { commitRule } from './commitFlow.ts'
import { baseVars, type WorktreeActions, assertClean, specFrom } from './context.ts'
import { installDeps, refreshSdks, updateSdk } from './sdkTools.ts'

/** Résolution des conflits d'une fusion de la base : l'agent tranche lui-même (« Récupérer <base> » en un clic). */
const AUTO_RESOLVE = [
  '## Automatic mode',
  'The user started "Pull the base" in one click: merge, conflicts, commit and push without them. Settle each conflict yourself with the method below, keeping the intent of both sides.',
  'Only leave a conflict in place with a question if the two versions are incompatible on business behaviour and no reasonable combination exists: the merge then stops and the user will decide.',
  'After the resolution, also check what the base changed that the PR uses elsewhere (signature, type, constructor, import), even in files without conflict, and adapt the PR code: the commit typecheck must pass.',
].join('\n\n')

/** Agent de résolution des conflits d'une fusion en cours (onglet Conflits ou « Récupérer <base> »). */
async function conflictSpec(d: WorktreeDetail, merge: MergeState, base: string, opts: { answers: string; title: string; scope: RunScope; resume: string | null | undefined }): Promise<RunSpec> {
  const cwd = d.worktree.path
  const merged = merge.base ?? base
  const log = (range: string) => run('git', ['log', '--oneline', '--no-merges', '-n', '60', range], { cwd }).then((s) => s.trim() || '(none)').catch(() => '(unknown)')
  const [ours, theirs] = await Promise.all([log(`origin/${merged}..HEAD`), log(`HEAD..origin/${merged}`)])
  return specFrom('conflict-resolve', {
    ...baseVars(d),
    base: merged,
    conflicted: merge.conflicted.map((f) => `- ${f}${merge.remaining.includes(f) ? '' : ' (no markers left)'}`).join('\n'),
    ours,
    theirs,
    answers: opts.answers,
    rules: rulesFor(d.project.id),
  }, { kind: 'conflict-resolve', title: opts.title, scope: opts.scope, cwd, schema: schemas.conflictResolveSchema, resume: opts.resume })
}

/**
 * Commit de fusion puis push. Hook de pre-commit en échec : l'erreur utile est à la fin de sa sortie (types, lint…).
 * Avec autofix, un agent corrige d'après cette sortie, puis le commit est retenté (3 essais au plus).
 */
async function finishMergeWithFix(ctx: JobContext, d: WorktreeDetail, base: string, autofix: boolean): Promise<string> {
  const cwd = d.worktree.path
  const branch = d.worktree.branch!
  const scope = { project: d.project.id, worktree: d.worktree.id, pr: d.pr?.number }
  // Fusion pas encore commitée : node_modules d'abord d'accord avec le lockfile fusionné (sinon le typecheck du hook échoue).
  if (await git.mergeState(cwd)) await installDeps(cwd, (text) => ctx.log({ t: 'info', text }))
  let sha: string | null = null
  for (let attempt = 1; !sha; attempt++) {
    try {
      sha = await git.finishMerge(cwd, branch, (text) => ctx.log({ t: 'info', text }))
    } catch (e) {
      if (!(e instanceof CommandError)) throw e
      const out = stripVTControlCharacters(`${e.stdout}\n${e.stderr}`).trim().slice(-6000)
      ctx.log({ t: 'error', text: `${e.cmd} a échoué :\n${out.slice(-3000)}` })
      if (!autofix) throw new Error('Le commit de fusion a été refusé (voir le détail ci-dessus) : « Corriger avec l’IA et pousser », ou corrige puis relance « Valider et pousser ».')
      if (attempt >= 3) throw new Error('Le commit de fusion est encore refusé après deux corrections : regarde le détail ci-dessus.')
      const fix = await ctx.runChild(specFrom('merge-fix', { ...baseVars(d), base, error: out, rules: rulesFor(d.project.id) }, {
        kind: 'commit-fix', title: 'Corriger la fusion refusée par le hook', scope: { ...scope, ref: 'merge-fix' }, cwd, schema: schemas.commitFixSchema,
      }))
      const res = fix.structured as CommitFixOutput | null
      if (fix.status !== 'success' || !res) throw new Error('La correction automatique a échoué.')
      ctx.log({ t: 'info', text: `Correction : ${res.summary}` })
      if (!res.fixed) throw new Error(`L’IA n’a pas pu corriger sans décision de ta part : ${res.summary}`)
      ctx.log({ t: 'info', text: 'Nouvel essai du commit de fusion…' })
    }
  }
  gh.clearPrCache(d.project.repo)
  const url = `https://github.com/${d.project.repo}/commit/${sha}`
  ctx.log({ t: 'info', text: `Fusion poussée : ${url}` })
  return url
}

export const conflictsActions: WorktreeActions = {
  'conflict-resolve': async ({ input, d, scope, cwd, needPr }) => {
    const pr = needPr()
    const base = pr.base
    const prev = input.previousRunId ? getRun(input.previousRunId) : null
    const feedback = input.feedback?.trim()
    let merge = d.merge
    if (!merge) {
      await assertClean(d, `fusionner ${base}`)
      merge = await git.startMerge(cwd, base)
      if (!merge && d.worktree.branch) {
        // À jour avec la base en local : la branche distante a peut-être avancé (PR empilée mergée dedans), ou la fusion n'est pas poussée.
        const branch = d.worktree.branch
        await run('git', ['fetch', 'origin', branch], { cwd, timeoutMs: 120_000 }).catch(() => undefined)
        if (await git.behindRemote(cwd, branch)) merge = await git.startMerge(cwd, branch)
        else if (await git.unpushedCount(cwd, branch)) throw new HttpError(409, `La branche est à jour avec origin/${base} en local, mais ${await git.unpushedCount(cwd, branch)} commit(s) ne sont pas poussés : clique « Pousser la branche ».`)
      }
      if (!merge) throw new HttpError(409, `La branche est déjà à jour avec origin/${base} : aucun conflit à résoudre (GitHub peut mettre un moment à recalculer).`)
    }
    // Branche réellement fusionnée : la base, ou la branche distante quand elle a avancé de son côté.
    if (!merge.conflicted.length) throw new HttpError(409, `La fusion de ${merge.base ?? base} ne produit aucun conflit : valide-la avec « Valider et pousser ».`)
    return startRun(await conflictSpec(d, merge, base, {
      answers: feedback ? `## The user's answers to your questions\n\n${feedback}` : '',
      title: feedback ? 'Conflits · suite' : `Conflits avec ${merge.base ?? base}`, scope,
      // Après mes réponses, on reprend la session : l'agent a déjà analysé les deux côtés.
      resume: feedback ? prev?.sessionId : null,
    }))
  },
  'dirty-triage': async ({ kind, project, d, scope, cwd, vars }) => {
    if (!d.dirtyFiles.length) throw new HttpError(409, 'Aucun fichier non commité')
    const base = d.merge?.base ?? d.pr?.base ?? project.baseBranch
    return startRun(
      specFrom('dirty-triage', {
        ...vars,
        base,
        files: d.dirtyFiles.map((f) => `- ${f.status} ${f.path}`).join('\n'),
        commits: d.commitsAhead.map((c) => `- ${c}`).join('\n') || '(none)',
        commitRule: commitRule(cwd),
      }, { kind, title: `Trier ${d.dirtyFiles.length} fichier(s) non commité(s)`, scope: { ...scope, ref: 'dirty' }, cwd, schema: schemas.dirtyTriageSchema }),
    )
  },
  'merge-finish': async ({ kind, input, project, d, scope, cwd }) => {
    // Tâche suivie : elle continue si je change de page, et son état (en cours, poussé, échec) se retrouve au retour.
    const branch = d.worktree.branch
    if (!branch) throw new HttpError(400, 'Worktree sans branche')
    if (d.merge?.remaining.length) throw new HttpError(409, `Conflits encore présents dans : ${d.merge.remaining.join(', ')}`)
    if (!d.merge && !(await git.unpushedCount(cwd, branch))) throw new HttpError(409, 'Aucune fusion en cours ni commit à pousser')
    return startJob({ kind, title: 'Valider et pousser la fusion', scope: { ...scope, ref: 'merge' } }, async (ctx): Promise<MergeFinishOutput> =>
      ({ url: await finishMergeWithFix(ctx, d, d.merge?.base ?? d.pr?.base ?? project.baseBranch, !!input.autofix) }))
  },
  'base-sync': async ({ kind, d, scope, cwd, needPr }) => {
    // « Récupérer <base> » en un clic : fusion, conflits résolus par l'IA, commit de fusion (hooks compris,
    // corrigé par l'IA s'il est refusé), push. S'il reste un conflit qu'elle ne peut pas trancher, la fusion reste
    // en cours et se termine dans l'onglet Conflits.
    const pr = needPr()
    const base = pr.base
    if (!d.worktree.branch) throw new HttpError(400, 'Worktree sans branche')
    // Une fusion de cette même base restée en cours (passage précédent refusé par un hook) est reprise.
    const resume = d.merge && (d.merge.base ?? base) === base ? d.merge : null
    if (!resume) await assertClean(d, `récupérer ${base}`)
    return startJob({ kind, title: `Récupérer ${base}`, scope: { ...scope, ref: 'base-sync' } }, async (ctx): Promise<BaseSyncOutput> => {
      ctx.log({ t: 'info', text: resume ? `Reprise de la fusion de ${base} en cours…` : `Récupération et fusion de origin/${base}…` })
      const merge = resume ?? await git.startMerge(cwd, base)
      if (!merge) {
        ctx.log({ t: 'info', text: `La branche est déjà à jour avec ${base}.` })
        // Rien à fusionner : les SDK privés sont quand même mis à jour s'ils sont en retard (commit à part).
        for (const st of await sdkStatus(cwd, true)) {
          if (st.latest && st.locked !== st.latest) await updateSdk(ctx, d, st.name, st.latest)
        }
        return { url: null, conflicts: 0 }
      }
      if (merge.conflicted.length) {
        ctx.log({ t: 'info', text: `${merge.conflicted.length} fichier(s) en conflit : résolution par l’IA…` })
        const r = await ctx.runChild(await conflictSpec(d, merge, base, {
          answers: AUTO_RESOLVE, title: `Conflits avec ${base}`, scope: { ...scope, ref: 'base-sync-conflicts' }, resume: null,
        }))
        const after = await git.mergeState(cwd)
        if (r.status !== 'success' || after?.remaining.length) {
          const left = after?.remaining.length ? ` (${after.remaining.join(', ')})` : ''
          throw new Error(`Conflits non résolus${left} : la fusion reste en cours, à terminer dans l’onglet Conflits.`)
        }
        ctx.log({ t: 'info', text: 'Conflits résolus.' })
      } else ctx.log({ t: 'info', text: 'Fusion sans conflit.' })
      await refreshSdks(ctx, cwd)
      const url = await finishMergeWithFix(ctx, d, base, true)
      return { url, conflicts: merge.conflicted.length }
    })
  },
  'branch-sync': async ({ kind, d, scope, cwd }) => {
    // Quelqu'un a poussé sur ma branche : ses commits sont récupérés. Sans commit local non poussé, la branche avance
    // simplement ; sinon fusion de origin/<branche>, conflits résolus par l'IA, commit de fusion et push.
    const branch = d.worktree.branch
    if (!branch) throw new HttpError(400, 'Worktree sans branche')
    const resume = d.merge && d.merge.base === branch ? d.merge : null
    if (!resume) await assertClean(d, `récupérer origin/${branch}`)
    return startJob({ kind, title: `Récupérer origin/${branch}`, scope: { ...scope, ref: 'branch-sync' } }, async (ctx): Promise<BaseSyncOutput> => {
      if (!resume) {
        ctx.log({ t: 'info', text: `Récupération de origin/${branch}…` })
        await git.fetchBranch(cwd, branch)
        if (!(await git.behindRemote(cwd, branch))) {
          ctx.log({ t: 'info', text: 'La branche est déjà à jour avec GitHub.' })
          return { url: null, conflicts: 0 }
        }
        if (!(await git.unpushedCount(cwd, branch)) && (await git.fastForward(cwd, branch))) {
          ctx.log({ t: 'info', text: 'Aucun commit local à garder : la branche avance sur origin, sans commit de fusion.' })
          gh.clearPrCache(d.project.repo)
          return { url: null, conflicts: 0 }
        }
        ctx.log({ t: 'info', text: 'Des commits locaux ne sont pas encore poussés : fusion des deux historiques…' })
      }
      const merge = resume ?? await git.startMerge(cwd, branch)
      if (!merge) return { url: null, conflicts: 0 }
      if (merge.conflicted.length) {
        ctx.log({ t: 'info', text: `${merge.conflicted.length} fichier(s) en conflit : résolution par l’IA…` })
        const r = await ctx.runChild(await conflictSpec(d, merge, branch, {
          answers: AUTO_RESOLVE, title: `Conflits avec origin/${branch}`, scope: { ...scope, ref: 'branch-sync-conflicts' }, resume: null,
        }))
        const after = await git.mergeState(cwd)
        if (r.status !== 'success' || after?.remaining.length) {
          const left = after?.remaining.length ? ` (${after.remaining.join(', ')})` : ''
          throw new Error(`Conflits non résolus${left} : la fusion reste en cours, à terminer dans l’onglet À jour.`)
        }
        ctx.log({ t: 'info', text: 'Conflits résolus.' })
      } else ctx.log({ t: 'info', text: 'Fusion sans conflit.' })
      const url = await finishMergeWithFix(ctx, d, branch, true)
      return { url, conflicts: merge.conflicted.length }
    })
  },
}
