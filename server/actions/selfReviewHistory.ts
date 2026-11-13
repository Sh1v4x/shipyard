import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Finding, FindingsFixAllOutput, FixOutput, ReviewDecisions, ReviewOutput, Run } from '../../shared/types.ts'
import { allRuns, getRun, listRuns } from '../lib/claude.ts'
import { reviewDecisionsPath } from '../lib/runArtifacts.ts'
import { DIFFS_DIR } from './context.ts'

// Les agents d'une auto-review se passent le relais : la passe suivante sait ce que la précédente a relevé, ce que
// l'agent de correction en a fait (corrigé, refusé, raté) et ce que j'ai écarté. Elle vérifie au lieu de repartir de zéro.

/** Diff relu par une auto-review, gardé pour dire à la suivante ce qui a changé depuis. */
export const selfReviewDiffPath = (runId: string) => join(DIFFS_DIR, `self-${runId}.diff`)

type Status = 'fixed' | 'declined' | 'failed' | 'ignored' | 'open'

export interface Pass {
  run: Run
  summary: string
  items: { f: Finding; status: Status; note: string }[]
}

/** Les dernières auto-reviews réussies du worktree, la plus récente d'abord. */
export function lastPasses(project: string, worktree: string, limit = 2): Run[] {
  return listRuns({ project, worktree, kind: 'self-review', status: 'success' }, limit).map((r) => getRun(r.id)).filter((r): r is Run => !!r?.structured)
}

/** L'auto-review réussie qui précède celle-ci sur le même worktree (celle dont les corrections sont déjà dans le code). */
export function passBefore(project: string, worktree: string, runId: string | undefined): Run | null {
  const runs = listRuns({ project, worktree, kind: 'self-review', status: 'success' }, 20)
  const i = runs.findIndex((r) => r.id === runId)
  const prev = i >= 0 ? runs[i + 1] : undefined
  const run = prev ? getRun(prev.id) : null
  return run?.structured ? run : null
}

/** Une auto-review passée et le sort de chacune de ses remarques. */
export function passOf(run: Run): Pass {
  const out = run.structured as ReviewOutput
  const path = reviewDecisionsPath(run.id)
  const ignored = existsSync(path) ? ((JSON.parse(readFileSync(path, 'utf8')) as Partial<ReviewDecisions>).ignored ?? []) : []
  // Corrections groupées (la plus récente l'emporte, sauf sur une remarque déjà corrigée) et corrections unitaires.
  const results = new Map<string, FindingsFixAllOutput['results'][number]>()
  const single = new Map<string, string>()
  for (const r of allRuns().filter((x) => x.scope.worktree === run.scope.worktree).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (r.kind === 'findings-fix-all' && r.scope.ref === run.id) {
      for (const x of (r.structured as FindingsFixAllOutput | null | undefined)?.results ?? []) if (!results.get(x.id)?.ok) results.set(x.id, x)
    } else if (r.kind === 'finding-fix' && r.status === 'success' && r.scope.ref?.startsWith(`${run.id}:`)) {
      const fix = r.structured as FixOutput | null
      if (fix?.changed) single.set(r.scope.ref.slice(run.id.length + 1), fix.summary)
    }
  }
  return {
    run,
    summary: out.summary,
    items: (out.findings ?? []).map((f) => {
      const res = results.get(f.id)
      if (res?.ok || single.has(f.id)) return { f, status: 'fixed' as const, note: res?.ok ? res.detail : single.get(f.id)! }
      if (ignored.includes(f.id)) return { f, status: 'ignored' as const, note: '' }
      if (res) return { f, status: res.declined ? 'declined' as const : 'failed' as const, note: res.detail }
      return { f, status: 'open' as const, note: '' }
    }),
  }
}

const blocks = (diff: string) => new Map(diff.split(/^(?=diff --git )/m).flatMap((b) => {
  const path = b.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1]
  return path ? [[path, b] as const] : []
}))

/** Fichiers dont le diff a changé depuis la passe précédente (nouveaux, modifiés, ou sortis du diff) ; null si son diff n'est plus là. */
export function changedSince(prevRunId: string, diff: string): { changed: string[]; gone: string[] } | null {
  const path = selfReviewDiffPath(prevRunId)
  if (!existsSync(path)) return null
  const before = blocks(readFileSync(path, 'utf8'))
  const now = blocks(diff)
  return { changed: [...now].filter(([p, b]) => before.get(p) !== b).map(([p]) => p), gone: [...before.keys()].filter((p) => !now.has(p)) }
}

const line = (i: Pass['items'][number], withFix = false) =>
  `- [${i.f.id}] ${i.f.file}:${i.f.line} · ${i.f.severity} · ${i.f.title}${withFix ? `\n  Problem: ${i.f.body.replace(/\n/g, ' ').slice(0, 400)}\n  Fix asked: ${i.f.fix.replace(/\n/g, ' ').slice(0, 400)}` : ''}${i.note ? `\n  ${i.status === 'fixed' ? 'What the fixing agent did' : 'What the fixing agent answered'}: ${i.note.replace(/\n/g, ' ').slice(0, 500)}` : ''}`

/**
 * Le relais pour une nouvelle passe d'auto-review. files : restreint aux fichiers d'un lot (les autres lots ont le leur).
 * Vide s'il n'y a pas de passe précédente.
 */
export function previousPassText(pass: Pass | null, diff: string, opts: { files?: Set<string>; verify?: boolean; earlier?: Pass[] } = {}): string {
  if (!pass) return 'First pass: no previous self-review of this branch.'
  const { files } = opts
  const mine = (f: string) => !files || files.has(f)
  // Passes plus anciennes : leurs sujets sont réglés (corrigés, refusés, ignorés), en une ligne chacun.
  const settled = (opts.earlier ?? []).flatMap((p) => p.items.filter((i) => i.status !== 'open' && i.status !== 'failed' && mine(i.f.file)))
  const items = pass.items.filter((i) => mine(i.f.file))
  const of = (s: Status) => items.filter((i) => i.status === s)
  const since = changedSince(pass.run.id, diff)
  const changed = since?.changed.filter(mine) ?? []
  const section = (title: string, intro: string, list: Pass['items'], withFix = false) => (list.length ? [`### ${title}`, intro, ...list.map((i) => line(i, withFix))].join('\n') : '')
  return [
    `This is a second pass. A previous self-review ran on ${new Date(pass.run.startedAt).toLocaleString('en-US')}; an agent then fixed the findings I accepted. You pick up where they left off: you check their work and review the rest, you do not start from scratch.`,
    `Previous summary: ${pass.summary.slice(0, 1500)}`,
    section('Fixed since (verify each one)',
      'Open the code at each spot. Fixed correctly: nothing to report. Not fixed, half fixed, or fixed in a way that breaks something else (a caller, a test, the other side of a contract, a neighbouring behavior): raise a finding, with previousId set to the id in brackets, and say in body what is still wrong compared to what was asked.',
      of('fixed'), true),
    section('Declined by the fixing agent',
      'It judged the fix wrong for this code and explained why. Read its reason against the code. It is right: do not raise the finding again. It is wrong: raise it again with previousId, and answer its reason in body so I can settle it.',
      of('declined'), true),
    section('Dismissed by me',
      'I judged them wrong or not worth it. Do not raise them again, even reworded, unless the code changed at that spot and the problem has become real.',
      of('ignored')),
    section('Still open (not fixed yet)',
      'Accepted or not sorted yet, and not fixed. Still true in the code: raise it again with previousId, keeping the same title. No longer true: drop it.',
      [...of('open'), ...of('failed')], true),
    settled.length ? [
      '### Settled in earlier passes',
      'Raised, then fixed, declined or dismissed before the previous pass. The topic is closed: do not raise it again, even reworded or from another angle, unless it is a real bug today.',
      ...settled.slice(0, 120).map((i) => `- ${i.f.file} · ${i.f.title} (${i.status})`),
    ].join('\n') : '',
    opts.verify ? [
      '### Scope of this pass: verification',
      'This pass exists to close the review, not to reopen it. Every review of a diff finds ten more things to polish: that is how a review never ends.',
      '- A new finding (previousId null) is only allowed when it is `bloquant` or `important`: a real bug, a regression introduced by a fix, an unmet requirement of the ticket.',
      '- No new `suggestion`. Style, naming, small duplication, test organisation, optional refactors, "could be simpler": that was the job of the first pass, and what it did not raise is accepted.',
      '- Code written by the fixing agent gets the same treatment: check that it is correct and consistent with the rest, not that it is how you would have written it.',
      '- Never raise a finding that reverses a previous fix (asking to remove or inline what an earlier finding asked to add or extract, or the opposite). If a fix really made things worse, it is a bug with a consequence: say which one.',
      '- Nothing left to report is the expected outcome: say so in summary, with what you verified.',
    ].join('\n') : '',
    since
      ? changed.length
        ? `### Files whose diff changed since the previous pass\nThis is where the fixes and the new work landed: review them with the most care, the fixes included (a fix can introduce its own bug or disagree with another fix).\n${changed.map((f) => `- ${f}`).join('\n')}\nThe other files of the diff did not change since the previous pass: reread them for consistency with what changed (a fix elsewhere can break them), but do not raise new style findings on code that the previous pass already read and accepted.`
        : 'No file of this diff changed since the previous pass: only follow up on the findings above.'
      : '',
    'Check that the whole agrees: the fixes with each other, with the rest of the branch, and with the ticket.',
  ].filter(Boolean).join('\n\n')
}

/** Pour l'agent de correction : ce que la passe d'avant avait relevé et ce qui en a été fait, pour ne pas le défaire. */
export function earlierFixesText(pass: Pass | null): string {
  const done = pass?.items.filter((i) => i.status === 'fixed' || i.status === 'declined') ?? []
  if (!done.length) return ''
  return [
    '## What the previous self-review pass led to',
    'Another agent already fixed or declined these, before the findings you are handling now were written. Do not undo a fix below, and do not redo what was declined for a good reason: build on it.',
    ...done.map((i) => `- ${i.f.file}:${i.f.line} · ${i.f.title} → ${i.status === 'fixed' ? 'fixed' : 'declined'}: ${i.note.replace(/\n/g, ' ').slice(0, 300)}`),
  ].join('\n')
}
