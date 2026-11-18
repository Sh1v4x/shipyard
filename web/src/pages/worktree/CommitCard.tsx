import { CheckIcon, GitCommitHorizontalIcon, PlayIcon, Undo2Icon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CommitExecOutput, CommitExecResult, CommitPlanOutput } from '../../../../shared/types.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, FoldCard, PromptMenu, RunningBadge, RunPanel, SectionLabel, Spinner, plural, type Tone } from '../../ui.tsx'
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
  // Fichiers écartés dont j'annule les modifications ; par défaut ils restent tous en local.
  const [discards, setDiscards] = useState<string[]>([])
  const dirty = detail.dirtyFiles
  // Worktrees associés avec des changements : commités avec ceux-ci, chacun dans son dépôt.
  const linked = (detail.linked ?? []).filter((l) => l.dirtyFiles.length)
  const total = dirty.length + linked.reduce((a, l) => a + l.dirtyFiles.length, 0)
  const nameOf = (p?: string) => (p && p !== project.id ? detail.linked?.find((l) => l.project === p)?.name ?? p : linked.length ? project.name : null)

  // Un nouveau plan remplace la sélection ; un plan déjà exécuté n'est plus proposé.
  const planIsFresh = plan.run && (!exec.run || Date.parse(plan.run.startedAt) > Date.parse(exec.run.startedAt))
  useEffect(() => {
    setDrafts(plan.result && planIsFresh ? plan.result.commits.map((c) => ({ ...c, approved: true })) : null)
    setDiscards([])
  }, [plan.result, planIsFresh])

  if (!total && !exec.id) return null
  const approved = drafts?.filter((d) => d.approved && d.title.trim() && d.files.length) ?? []
  const report = exec.result
  // Fichiers modifiés qu'aucun commit approuvé n'emporte : ils resteront en local, alors que le code poussé peut en dépendre
  // (une migration sans son schéma, un type sans son usage…). Ceux que le plan écarte exprès sont listés à part.
  const taken = new Set(approved.flatMap((d) => d.files.map((f) => `${d.project ?? project.id}:${f}`)))
  const excluded = new Set((plan.result?.excluded ?? []).map((x) => x.file))
  // Fichiers que le plan écarte et qui sont encore modifiés : je choisis pour chacun de le garder ou d'annuler ses modifications.
  // Un dossier entièrement non suivi est une seule entrée de git (`coverage/`) : un fichier écarté peut être dedans.
  const dirtyPaths = [...dirty.map((f) => f.path), ...linked.flatMap((l) => l.dirtyFiles.map((f) => f.path))]
  const excludedFiles = (plan.result?.excluded ?? []).filter((x) => dirtyPaths.some((p) => p === x.file || (p.endsWith('/') && x.file.startsWith(p))))
  const leftOut = drafts
    ? [...dirty.map((f) => ({ project: project.id, path: f.path })), ...linked.flatMap((l) => l.dirtyFiles.map((f) => ({ project: l.project, path: f.path })))]
        .filter((f) => !taken.has(`${f.project}:${f.path}`) && !excluded.has(f.path) && !(f.path.endsWith('/') && [...excluded].some((x) => x.startsWith(f.path))))
    : []

  return (
    <FoldCard
      aria-label="Commiter"
      icon={GitCommitHorizontalIcon}
      title="Commiter les changements"
      summary={total ? `${plural(dirty.length, 'fichier modifié', 'fichiers modifiés')} dans le worktree${linked.length ? `, ${linked.map((l) => `${l.dirtyFiles.length} dans ${l.name}`).join(', ')} (worktree lié)` : ''}.` : 'Tout est commité.'}
      active={plan.working || exec.working}
      badge={plan.working || exec.working ? <RunningBadge /> : drafts ? <Badge tone="amber">{plural(drafts.length, 'commit à valider', 'commits à valider')}</Badge> : null}
      actions={<PromptMenu items={[['commit-plan', 'Commits']]} />}
    >
      <p className="text-sm text-muted-foreground">L’IA propose des commits, tu valides chacun, puis Shipyard commite et pousse. Si un hook (Biome, typecheck) refuse un commit, un agent le corrige et le commit est retenté.</p>

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
          {leftOut.length > 0 && (
            <Alert variant="warning">
              <AlertDescription>
                <span className="font-medium">{plural(leftOut.length, 'fichier modifié ne part dans aucun commit', 'fichiers modifiés ne partent dans aucun commit')}</span> et {leftOut.length > 1 ? 'resteront' : 'restera'} en local. Si le code poussé en dépend, la CI cassera : approuve le commit qui {leftOut.length > 1 ? 'les' : 'le'} contient, ou propose à nouveau.
                <span className="mt-1 block font-mono text-xs break-all">{leftOut.map((f) => (f.project !== project.id ? `${nameOf(f.project) ?? f.project} · ${f.path}` : f.path)).join(', ')}</span>
              </AlertDescription>
            </Alert>
          )}
          {excludedFiles.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{plural(excludedFiles.length, 'fichier écarté des commits', 'fichiers écartés des commits')}</p>
                  <p className="text-xs text-muted-foreground">Pour chacun : le garder modifié en local, ou annuler ses modifications. Rien n’est annulé avant que tu approuves, en bas.</p>
                </div>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={!discards.length} onClick={() => setDiscards([])}>Tout garder</Button>
                  <Button size="sm" variant="ghost" disabled={discards.length === excludedFiles.length} onClick={() => setDiscards(excludedFiles.map((x) => x.file))}>Tout annuler</Button>
                </span>
              </div>
              {excludedFiles.map((x) => {
                const drop = discards.includes(x.file)
                return (
                  <div key={x.file} className={cn('flex flex-wrap items-center gap-3 border-t pt-2', drop && 'text-muted-foreground')}>
                    <div className="min-w-0 flex-[1_1_240px]">
                      <span className={cn('font-mono text-xs break-all', drop && 'line-through')}>{x.file}</span>
                      <p className="text-xs text-muted-foreground">{x.reason}</p>
                    </div>
                    <span className="flex gap-1.5">
                      <Button size="sm" variant={drop ? 'outline' : 'default'} aria-pressed={!drop} onClick={() => setDiscards(discards.filter((f) => f !== x.file))}>Garder en local</Button>
                      <Button size="sm" variant="outline" className={cn(drop && 'border-red-500/40 text-destructive hover:text-destructive')} aria-pressed={drop} onClick={() => setDiscards([...discards.filter((f) => f !== x.file), x.file])}><Undo2Icon />Annuler ses modifications</Button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={(!approved.length && !discards.length) || exec.busy} onClick={() => exec.start({ commits: approved.map(({ title, files, project: p }) => ({ title, files, project: p })), discard: discards })}>
              {exec.starting && <Spinner />}
              {approved.length ? `Commiter et pousser ${plural(approved.length, 'commit', 'commits')}` : ''}
              {approved.length > 0 && discards.length > 0 ? ' · ' : ''}
              {discards.length ? `${approved.length ? 'annuler' : 'Annuler'} ${plural(discards.length, 'fichier écarté', 'fichiers écartés')}` : ''}
              {!approved.length && !discards.length ? 'Commiter et pousser' : ''}
            </Button>
            <Button size="sm" variant="outline" disabled={plan.busy} onClick={() => plan.start()}>Proposer à nouveau</Button>
            <span className="text-sm text-muted-foreground">Chaque commit est poussé juste après sa création.</span>
          </div>
        </div>
      )}

      <RunPanel id={exec.id} events={exec.events} running={exec.running} run={exec.run} label="Commits et push en cours" defaultOpen={exec.working} onStop={exec.stop} action={exec} />

      {report && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Rapport · {plural(report.pushed, 'commit poussé', 'commits poussés')}{report.failed ? ` · ${plural(report.failed, 'échec', 'échecs')}` : ''}</SectionLabel>
          {(report.discarded?.length ?? 0) > 0 && <p className="text-sm text-muted-foreground">Modifications annulées : <span className="font-mono text-xs break-all">{report.discarded!.join(', ')}</span></p>}
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
    </FoldCard>
  )
}
