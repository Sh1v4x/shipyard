import { CheckIcon, GitCommitHorizontalIcon, PlayIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CommitExecOutput, CommitExecResult, CommitPlanOutput } from '../../../../shared/types.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, PromptMenu, RunPanel, SectionLabel, Spinner, plural, type Tone } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

interface Draft {
  title: string
  files: string[]
  /** Projet du worktree lié où se fait le commit (absent : ce worktree). */
  project?: string
  approved: boolean
}

const STATUS: Record<CommitExecResult['status'], { label: string; tone: Tone }> = {
  pushed: { label: 'Poussé', tone: 'green' },
  committed: { label: 'Commité, push refusé', tone: 'amber' },
  failed: { label: 'Échec', tone: 'red' },
  skipped: { label: 'Ignoré', tone: 'gray' },
}

/** Propose des commits pour les changements en cours, les fait valider un par un, puis commite et pousse (avec correction auto des hooks). */
export function CommitCard({ project, detail, wtId }: TabProps) {
  const scope = { project: project.id, worktree: wtId }
  const plan = useAction<CommitPlanOutput>('commit-plan', scope)
  const exec = useAction<CommitExecOutput>('commit-exec', scope)
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const dirty = detail.dirtyFiles
  // Worktrees associés avec des changements : commités avec ceux-ci, chacun dans son dépôt.
  const linked = (detail.linked ?? []).filter((l) => l.dirtyFiles.length)
  const total = dirty.length + linked.reduce((a, l) => a + l.dirtyFiles.length, 0)
  const nameOf = (p?: string) => (p && p !== project.id ? detail.linked?.find((l) => l.project === p)?.name ?? p : linked.length ? project.name : null)

  // Un nouveau plan remplace la sélection ; un plan déjà exécuté n'est plus proposé.
  const planIsFresh = plan.run && (!exec.run || Date.parse(plan.run.startedAt) > Date.parse(exec.run.startedAt))
  useEffect(() => {
    setDrafts(plan.result && planIsFresh ? plan.result.commits.map((c) => ({ ...c, approved: true })) : null)
  }, [plan.result, planIsFresh])

  if (!total && !exec.id) return null
  const approved = drafts?.filter((d) => d.approved && d.title.trim() && d.files.length) ?? []
  const report = exec.result

  return (
    <article className="flex flex-col gap-4 rounded-xl border bg-card p-5" aria-label="Commiter">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-[1_1_320px] gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><GitCommitHorizontalIcon className="size-4" /></div>
          <div className="min-w-0">
            <h2 className="font-semibold">Commiter les changements</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {total ? `${plural(dirty.length, 'fichier modifié', 'fichiers modifiés')} dans le worktree${linked.length ? `, ${linked.map((l) => `${l.dirtyFiles.length} dans ${l.name}`).join(', ')} (worktree lié)` : ''}.` : 'Tout est commité.'} L’IA propose des commits, tu valides chacun, puis Shipyard commite et pousse. Si un hook (Biome, typecheck) refuse un commit, un agent le corrige et le commit est retenté.
            </p>
          </div>
        </div>
        <PromptMenu items={[['commit-plan', 'Commits']]} />
      </div>

      {total > 0 && !drafts && (
        <div>
          <Button size="sm" disabled={plan.busy || exec.busy} onClick={() => plan.start()}>
            {plan.busy ? <Spinner /> : <PlayIcon />}Proposer les commits
          </Button>
        </div>
      )}
      <RunPanel id={plan.id} events={plan.events} running={plan.running} run={plan.run} label="Claude regroupe les changements" onStop={plan.stop} action={plan} />

      {drafts && !exec.running && (
        <div className="flex flex-col gap-2.5">
          {plan.result?.notes && <Alert variant="warning"><AlertDescription>{plan.result.notes}</AlertDescription></Alert>}
          {drafts.map((d, i) => (
            <div key={i} className={cn('flex flex-wrap items-start gap-3 rounded-lg border p-3 transition-opacity', d.approved ? 'border-foreground/30 bg-background' : 'opacity-60')}>
              <div className="flex gap-1.5">
                <Button size="sm" variant={d.approved ? 'default' : 'outline'} aria-pressed={d.approved} onClick={() => setDrafts(drafts.map((x, j) => (j === i ? { ...x, approved: true } : x)))}><CheckIcon />Approuver</Button>
                <Button size="sm" variant="outline" className={cn(!d.approved && 'border-red-500/40 text-destructive hover:text-destructive')} aria-pressed={!d.approved} onClick={() => setDrafts(drafts.map((x, j) => (j === i ? { ...x, approved: false } : x)))}><XIcon />Refuser</Button>
              </div>
              <div className="min-w-0 flex-[1_1_240px]">
                {nameOf(d.project) && <Badge tone={d.project && d.project !== project.id ? 'purple' : 'blue'} className="mb-1">{nameOf(d.project)}</Badge>}
                <Input className="h-8 font-mono text-xs" aria-label={`Titre du commit ${i + 1}`} value={d.title} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <div className="mt-1 font-mono text-xs break-all text-muted-foreground">{d.files.join(', ')}</div>
              </div>
            </div>
          ))}
          {(plan.result?.excluded.length ?? 0) > 0 && (
            <div className="text-sm text-muted-foreground">
              Exclus du commit : {plan.result!.excluded.map((x) => `${x.file} (${x.reason})`).join(', ')}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!approved.length || exec.busy} onClick={() => exec.start({ commits: approved.map(({ title, files, project: p }) => ({ title, files, project: p })) })}>
              {exec.starting && <Spinner />}Commiter et pousser {plural(approved.length, 'commit', 'commits')}
            </Button>
            <Button size="sm" variant="outline" disabled={plan.busy} onClick={() => plan.start()}>Proposer à nouveau</Button>
            <span className="text-sm text-muted-foreground">Chaque commit est poussé juste après sa création.</span>
          </div>
        </div>
      )}

      <RunPanel id={exec.id} events={exec.events} running={exec.running} run={exec.run} label="Commits et push en cours" defaultOpen={exec.running} onStop={exec.stop} action={exec} />

      {report && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Rapport · {plural(report.pushed, 'commit poussé', 'commits poussés')}{report.failed ? ` · ${plural(report.failed, 'échec', 'échecs')}` : ''}</SectionLabel>
          {report.results.map((r, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-mono text-xs font-medium break-all">{nameOf(r.project) && <Badge tone={r.project ? 'purple' : 'blue'}>{nameOf(r.project)}</Badge>} {r.sha && <span className="text-muted-foreground">{r.sha.slice(0, 7)} </span>}{r.title}</span>
                <span className="flex items-center gap-1.5">
                  {r.attempts > 1 && <span className="text-xs text-muted-foreground">{r.attempts} essais</span>}
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </span>
              </div>
              {r.fixes.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5 text-sm">
                  {r.fixes.map((f, j) => <li key={j}><strong className="font-medium">Correction IA :</strong> {f}</li>)}
                </ul>
              )}
              {r.error && r.status !== 'pushed' && <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{r.error}</pre>}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
