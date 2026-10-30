

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { MultiTestOutput, TestCheckOutput, TestOutput, CommitExecOutput, CommitExecResult, CommitFixOutput } from '../../shared/types.ts'
import { HttpError, getProject } from '../lib/config.ts'
import { getRun, listRuns, startJob, startRun } from '../lib/claude.ts'
import { run } from '../lib/exec.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import { loadPrompt } from '../lib/prompts.ts'
import * as schemas from '../schemas.ts'
import { type WorktreeActions, assertNoMerge, specFrom } from './context.ts'
import { commitRule, hookOutput } from './commitFlow.ts'
import { manualTest } from '../lib/progress.ts'

const PR_TEMPLATES = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md']

const MAX_COMMIT_ATTEMPTS = 3

const SCENARIO: Record<string, string> = { pass: 'passed', fail: 'failed', warn: 'to check' }

const CHECK: Record<TestCheckOutput['verdict'], string> = { pass: 'as expected', fail: 'not as expected', unclear: 'inconclusive' }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long' })

/**
 * Ce qui a été testé sur la branche, pour la section Tests de la PR : le dernier test de l'IA (suite, scénarios)
 * et le dernier test manuel (étapes cochées, vérifications par commande, avec mes décisions qui priment sur l'IA).
 */
function testsForPr(worktree: string): string {
  const out: string[] = []
  const lastTest = listRuns({ worktree, kind: 'test', status: 'success' }, 1)[0]
  const test = lastTest && getRun(lastTest.id)
  if (test?.structured) {
    const st = test.structured as TestOutput | MultiTestOutput
    const parts = 'parts' in st ? st.parts.map((p) => ({ name: p.projectName, out: p.output })) : [{ name: '', out: st }]
    out.push(`Automated test by the AI (${day(test.startedAt)}):`)
    for (const p of parts) {
      if (!p.out) continue
      if (p.name) out.push(`Repository ${p.name}:`)
      out.push(`- Suite \`${p.out.suite.command}\`: ${p.out.suite.passed} passed, ${p.out.suite.failed} failed. ${p.out.suite.summary}`)
      for (const sc of p.out.scenarios) out.push(`- [${SCENARIO[sc.status]}] ${sc.name}: ${sc.detail}`)
    }
  }
  const manual = manualTest(worktree)
  if (manual) {
    out.push('', `Manual test by the author (${day(manual.run.startedAt)}):`)
    for (const { step, done, check } of manual.steps) {
      const how = check ? ` · checked by command: ${CHECK[check.verdict]}${check.decided ? ' (decided by the author)' : ''} (${check.output.explanation})` : ''
      out.push(`- [${done ? 'x' : ' '}] ${step.title} · expected: ${step.expected}${how}`)
    }
  }
  return out.length ? out.join('\n') : '(no test run on this branch)'
}

export const commitsActions: WorktreeActions = {
  'pr-prepare': async ({ kind, input, project, d, scope, cwd, vars }) => {
    const base = d.project.baseBranch
    const [stat, example] = await Promise.all([git.diffStat(cwd, base), gh.lastMergedPrBody(project.repo)])
    const tplFile = PR_TEMPLATES.map((f) => join(cwd, f)).find((f) => existsSync(f))
    const context = [
      `Branch commits:\n${d.commitsAhead.map((c) => `- ${c}`).join('\n') || '(none)'}`,
      d.dirtyFiles.length ? `Warning: ${d.dirtyFiles.length} file(s) still uncommitted, they will not be part of the PR.` : '',
      stat,
    ].filter(Boolean).join('\n\n')
    return startRun(
      specFrom('pr-prepare', {
        ...vars, 'pr.base': base, context, tests: testsForPr(input.worktree!),
        template: tplFile ? readFileSync(tplFile, 'utf8').trim() : '(no template in the repository: use the sections Type de changement, Résumé, Changements détaillés, Comment tester, Liens utiles)',
        example: example ? example.slice(0, 6000) : '(no merged PR yet)',
      }, { kind, title: 'Préparer la PR', scope, cwd, schema: schemas.prPrepareSchema }),
    )
  },
  'commit-plan': async ({ kind, project, d, scope, cwd, vars }) => {
    assertNoMerge(d, 'préparer des commits')
    // Ce worktree et ses worktrees liés (projets du groupe) : un seul plan, chaque commit dans son dépôt.
    const targets = [
      { project: project.id, name: project.name, path: cwd, branch: d.worktree.branch, dirtyFiles: d.dirtyFiles },
      ...(d.linked ?? []).filter((l) => l.dirtyFiles.length),
    ].filter((t) => t.dirtyFiles.length)
    if (!targets.length) throw new HttpError(400, 'Rien à commiter')
    const exclude = loadPrompt('commit-plan').exclude
    const sections = await Promise.all(targets.map(async (t) => {
      const [stat, recent] = await Promise.all([
        run('git', ['diff', '--stat', 'HEAD'], { cwd: t.path }).catch(() => ''),
        run('git', ['log', '-12', '--no-merges', '--format=%s'], { cwd: t.path }).catch(() => ''),
      ])
      return [
        targets.length > 1 ? `## Project \`${t.project}\` (${t.name}): ${t.path}, branch ${t.branch ?? 'detached'}` : '',
        `Changed files:\n${t.dirtyFiles.map((f) => `- [${f.status}] ${f.path}${exclude.includes(basename(f.path)) ? '  ← to exclude' : ''}`).join('\n')}`,
        stat && `Diff (stat):\n${stat}`,
        `Latest commits of the repository (format to imitate):\n${recent.trim()}`,
        commitRule(t.path),
      ].filter(Boolean).join('\n\n')
    }))
    const context = targets.length > 1
      ? [
          `The changes are spread over ${targets.length} linked worktrees (one feature over several repositories). A commit never mixes two worktrees: project is the project id given in the heading, and files are paths relative to its worktree. To read a linked worktree: \`git -C <path> diff\`, or Read with the absolute path. Order the commits repository by repository, keeping the same title conventions in each.`,
          ...sections,
        ].join('\n\n')
      : `Project: \`${project.id}\` (put this value in project).\n\n${sections[0]}`
    return startRun(specFrom('commit-plan', { ...vars, context }, {
      kind, title: 'Proposer les commits', scope, cwd, schema: schemas.commitPlanSchema, addDirs: targets.slice(1).map((t) => t.path),
    }))
  },
  'commit-exec': async ({ kind, input, project, d, scope, cwd }) => {
    const commits = input.commits ?? []
    if (!commits.length) throw new HttpError(400, 'Aucun commit à créer')
    assertNoMerge(d, 'commiter')
    // Chaque commit se fait dans son worktree : celui-ci, ou un worktree lié (projet du groupe).
    const targets = new Map([
      [project.id, { cwd, branch: d.worktree.branch, repo: project.repo, name: project.name }],
      ...(d.linked ?? []).map((l) => [l.project, { cwd: l.path, branch: l.branch, repo: getProject(l.project).repo, name: l.name }] as const),
    ])
    const targetOf = (c: { project?: string }) => targets.get(c.project ?? project.id) ?? null
    for (const c of commits) {
      const t = targetOf(c)
      if (!t) throw new HttpError(400, `Projet ${c.project} non associé à ce worktree`)
      if (!t.branch) throw new HttpError(400, `Worktree sans branche (${t.name})`)
    }
    const multi = new Set(commits.map((c) => c.project ?? project.id)).size > 1
    const exclude = loadPrompt('commit-plan').exclude
    return startJob({ kind, title: `Commiter et pousser ${commits.length} commit(s)`, scope }, async (ctx): Promise<CommitExecOutput> => {
      const results: CommitExecResult[] = []
      for (const c of commits) {
        const { cwd, branch, name } = targetOf(c)!
        const files = c.files.filter((f) => !exclude.includes(basename(f)))
        const r: CommitExecResult = { title: c.title, files, ...(c.project && c.project !== project.id ? { project: c.project } : {}), status: 'failed', sha: null, attempts: 0, fixes: [], error: null }
        results.push(r)
        if (ctx.cancelled()) {
          r.status = 'skipped'
          continue
        }
        while (r.attempts < MAX_COMMIT_ATTEMPTS) {
          r.attempts++
          ctx.log({ t: 'info', text: `${r.attempts > 1 ? `Essai ${r.attempts} · ` : ''}${multi ? `${name} · ` : ''}git commit « ${r.title} »` })
          try {
            await run('git', ['add', '-A', '--', ...files], { cwd })
            const staged = await run('git', ['diff', '--cached', '--name-only'], { cwd })
            if (!staged.trim()) {
              r.status = 'skipped'
              r.error = 'Rien à commiter (fichiers déjà commités ou inchangés).'
              break
            }
            await run('git', ['commit', '-m', r.title], { cwd, timeoutMs: 900_000 }) // les hooks (typecheck) peuvent être longs
            r.sha = (await run('git', ['rev-parse', 'HEAD'], { cwd })).trim()
            r.error = null
            break
          } catch (e) {
            r.error = hookOutput(e)
            ctx.log({ t: 'error', text: `Refusé par un hook :\n${r.error.split('\n').slice(-25).join('\n')}` })
            await run('git', ['reset', '-q', '--', ...files], { cwd }).catch(() => undefined)
            if (r.attempts >= MAX_COMMIT_ATTEMPTS || ctx.cancelled()) break
            const fix = await ctx.runChild(
              specFrom('commit-fix', { 'commit.title': r.title, 'commit.files': files.join(', '), error: r.error }, {
                kind: 'commit-fix', title: `Corriger le commit « ${r.title} »`, scope, cwd, schema: schemas.commitFixSchema,
              }),
            )
            const out = fix.structured as CommitFixOutput | null
            if (fix.status !== 'success' || !out) {
              r.fixes.push('La correction automatique a échoué.')
              break
            }
            r.fixes.push(out.summary)
            ctx.log({ t: 'info', text: `Correction : ${out.summary}` })
            if (out.newTitle) r.title = out.newTitle
            if (!out.fixed) break
          }
        }
        if (r.sha) {
          r.status = 'committed'
          try {
            await run('git', ['push', '-u', 'origin', branch!], { cwd, timeoutMs: 300_000 })
            r.status = 'pushed'
            ctx.log({ t: 'info', text: `Poussé : ${r.sha.slice(0, 7)} ${r.title}` })
          } catch (e) {
            r.error = `Push refusé : ${hookOutput(e).split('\n').slice(-15).join('\n')}`
            ctx.log({ t: 'error', text: r.error })
          }
        }
      }
      for (const t of targets.values()) {
        gh.clearPrCache(t.repo)
        const left = await git.dirtyFiles(t.cwd).catch(() => [])
        if (left.length) ctx.log({ t: 'info', text: `${targets.size > 1 ? `${t.name} : ` : ''}${left.length} fichier(s) restent non commités : ${left.map((f) => f.path).join(', ')}` })
      }
      return { results, pushed: results.filter((x) => x.status === 'pushed').length, failed: results.filter((x) => x.status === 'failed').length }
    })
  },
}
