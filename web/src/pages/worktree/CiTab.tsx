import { ArrowUpRightIcon, RefreshCwIcon, RotateCcwIcon, SparklesIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { CiAllOutput, CiJob, CiOutput, FixOutput } from '../../../../shared/types.ts'
import { useRefreshProject, useRerunCi } from '../../data/mutations.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, Dot, Empty, PromptMenu, RunPanel, SectionLabel, Spinner, ciLabel, ciTone, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'

const ORIGIN: Record<CiOutput['origin'], string> = { pr: 'Lié à la PR', base: 'Retard sur la base', config: 'Configuration', flaky: 'Instable', infra: 'Infrastructure' }
const ORIGIN_TONE: Record<CiOutput['origin'], 'red' | 'amber' | 'gray' | 'purple'> = { pr: 'red', base: 'purple', config: 'amber', flaky: 'gray', infra: 'gray' }
const DOT: Record<string, string> = { pass: '#10b981', fail: '#ef4444', running: '#f59e0b', pending: '#a1a1aa', skipped: '#a1a1aa' }

export function CiTab({ project, detail, wtId }: TabProps) {
  const pr = detail.pr!
  const refresh = useRefreshProject()
  const rerun = useRerunCi(project.id, wtId)
  const toast = useToast()
  const rerunning = rerun.isPending
  const failing = pr.ci.jobs.filter((j) => j.state === 'fail')
  const passed = pr.ci.jobs.filter((j) => j.state === 'pass').length
  // Tous les échecs d'un coup : un agent pour le diagnostic, un pour les corrections retenues.
  const all = useAction<CiAllOutput>('ci-analyze-all', { project: project.id, worktree: wtId, ref: 'all' })
  const analysable = failing.filter((j) => j.jobId)

  const rerunFailed = async () => {
    try {
      let already = 0
      for (const runId of new Set(failing.map((j) => j.runId).filter((x): x is string => !!x))) if ((await rerun.mutateAsync({ runId })).alreadyRunning) already++
      toast(already ? 'Déjà relancés et en cours sur GitHub : l’état se met à jour' : 'Jobs en échec relancés')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="CI">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <span className="flex flex-wrap items-center gap-2.5">
          <Badge tone={ciTone(pr.ci.state)}>{pr.ci.state === 'fail' ? plural(pr.ci.failing, 'job en échec', 'jobs en échec') : pr.ci.state === 'pass' ? 'CI ok' : pr.ci.state === 'running' ? 'CI en cours' : 'Aucun check'}</Badge>
          <span className="text-sm text-muted-foreground">{passed} / {pr.ci.total} jobs réussis sur le dernier run</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(project.id)}>{refresh.isPending ? <Spinner /> : <RefreshCwIcon />}Actualiser</Button>
          {analysable.length > 1 && (
            <Button size="sm" variant="outline" disabled={all.busy} onClick={() => void all.start()} title="Un seul agent lit les logs de tous les jobs en échec et propose une solution pour chacun">
              {all.busy ? <Spinner /> : <SparklesIcon />}Analyser les {analysable.length} échecs
            </Button>
          )}
          {failing.some((j) => j.runId) && <Button size="sm" disabled={rerunning} onClick={rerunFailed}>{rerunning ? <Spinner /> : <RotateCcwIcon />}Relancer les échecs</Button>}
          <PromptMenu items={[['ci-analyze', 'Analyse CI'], ['ci-analyze-all', 'Analyse de tous les échecs'], ['ci-fix', 'Correction CI']]} />
        </span>
      </div>
      <RunPanel id={all.id} events={all.events} running={all.running} run={all.run} label="Claude lit les logs de tous les jobs en échec" onStop={all.stop} action={all} />
      {all.result && !all.busy && <AllDiagnostics out={all.result} at={all.run?.startedAt ?? null} failing={failing} project={project.id} wtId={wtId} base={pr.base} mine={pr.mine} onAnalyze={analysable.length ? () => void all.start() : undefined} />}
      {pr.ci.total === 0 && <Empty title="Aucun check sur cette PR." />}
      {pr.ci.jobs.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground">Jobs du dernier run</div>
          <div className="divide-y">
            {pr.ci.jobs.map((j) => <JobRow key={j.id} job={j} project={project.id} wtId={wtId} mine={pr.mine} />)}
          </div>
        </div>
      )}
    </section>
  )
}

/** Diagnostic de tous les échecs : je coche ce qui se corrige dans le code, un seul agent le corrige et pousse. */
function AllDiagnostics({ out, at, failing, project, wtId, base, mine, onAnalyze }: {
  out: CiAllOutput
  /** Quand l'analyse a été lancée. */
  at: string | null
  /** Jobs en échec sur le dernier run : un diagnostic ne vaut que pour l'un d'eux. */
  failing: CiJob[]
  project: string
  wtId: string
  base: string
  mine: boolean
  onAnalyze?: () => void
}) {
  const fix = useAction<FixOutput>('ci-fix-all', { project, worktree: wtId, ref: 'all' })
  const toast = useToast()
  const [picked, setPicked] = useState<string[]>([])
  // Un diagnostic porte sur un job précis d'un run précis : si ce job n'est plus en échec (corrigé, ou relancé depuis),
  // il est périmé. Il reste lisible, mais on ne corrige plus d'après lui.
  const live = new Set(failing.map((j) => j.jobId).filter((x): x is string => !!x))
  const current = out.jobs.filter((j) => live.has(j.jobId))
  const stale = out.jobs.filter((j) => !live.has(j.jobId))
  const uncovered = failing.filter((j) => j.jobId && !out.jobs.some((x) => x.jobId === j.jobId))
  const liveKey = [...live].sort().join(',')
  useEffect(() => setPicked(out.jobs.filter((j) => j.fixable && liveKey.split(',').includes(j.jobId)).map((j) => j.jobId)), [out, liveKey])
  // Même cause pour plusieurs jobs : un seul correctif à transmettre.
  const selected = current.filter((j) => picked.includes(j.jobId))
  const unique = selected.filter((j, i) => selected.findIndex((x) => x.cause === j.cause && x.fix === j.fix) === i)
  const needsBase = current.some((j) => j.origin === 'base')
  const date = at ? new Date(at).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel className="mb-0">Diagnostic de tous les échecs{date && ` · analyse du ${date}`}</SectionLabel>
        {stale.length > 0 && <Badge tone="amber">{current.length ? `${plural(stale.length, 'diagnostic périmé', 'diagnostics périmés')}` : 'Périmé'}</Badge>}
      </div>
      {(stale.length > 0 || uncovered.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">
            {stale.length > 0 && <>Cette analyse porte sur {plural(stale.length, 'job qui n’est plus en échec', 'jobs qui ne sont plus en échec')} sur le dernier run ({stale.map((j) => j.name).join(', ')}) : corrigé depuis, ou relancé. </>}
            {uncovered.length > 0 && <>{plural(uncovered.length, 'échec actuel n’a', 'échecs actuels n’ont')} pas été analysé ({uncovered.map((j) => j.name).join(', ')}). </>}
            Relance l’analyse avant de corriger.
          </p>
          {onAnalyze && <Button size="sm" onClick={onAnalyze}><SparklesIcon />Analyser les échecs actuels</Button>}
        </div>
      )}
      {current.length > 0 && <p className="text-sm leading-relaxed">{out.summary}</p>}
      {needsBase && <p className="rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-sm">Au moins un échec vient du retard sur <span className="font-mono">{base}</span> : utilise « Récupérer {base} » en haut de la page, qui fusionne, adapte et pousse.</p>}
      <div className="overflow-hidden rounded-lg border">
        {[...current, ...stale].map((j) => {
          const old = !live.has(j.jobId)
          return (
          <label key={j.jobId} className={cn('flex gap-3 border-t px-4 py-3 first:border-t-0', old ? 'opacity-60' : j.fixable ? 'cursor-pointer' : 'opacity-80')}>
            <Checkbox className="mt-0.5" disabled={old || !j.fixable || !mine} checked={picked.includes(j.jobId)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, j.jobId] : p.filter((x) => x !== j.jobId)))} />
            <span className="min-w-0 flex-1 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{j.name}</span>
                <Badge tone={ORIGIN_TONE[j.origin]}>{ORIGIN[j.origin]}</Badge>
                {old && <Badge tone="gray">n’est plus en échec</Badge>}
                {!old && !j.fixable && <span className="text-xs text-muted-foreground">rien à changer dans la branche</span>}
              </span>
              <span className="mt-1 block leading-relaxed">{j.cause}</span>
              <span className="mt-1 block leading-relaxed"><span className="font-medium">Correctif : </span>{j.fix}</span>
            </span>
          </label>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {mine ? (
          <Button size="sm" disabled={!unique.length || fix.busy} onClick={() => void fix.start({ ciJobs: unique.map((j) => ({ name: j.name, cause: j.cause, fix: j.fix })) })}>
            {fix.busy ? <Spinner /> : <WrenchIcon />}Corriger {plural(unique.length, 'cause', 'causes')} et pousser
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => navigator.clipboard.writeText(selected.map((j) => `CI « ${j.name} » : ${j.cause}\nCorrection : ${j.fix}`).join('\n\n')).then(() => toast('Diagnostic copié pour la review'))}>Copier pour la review</Button>
        )}
      </div>
      <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Un agent corrige les jobs retenus, puis commit et push" onStop={fix.stop} action={fix} />
      <BlockedCommit run={fix.run} />
      {fix.result && !fix.busy && (fix.result.changed
        ? <p className="text-xs text-muted-foreground">{fix.result.summary}</p>
        : <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"><span className="font-medium">Rien n’a été modifié ni poussé.</span> {fix.result.summary}</p>)}
    </div>
  )
}

function JobRow({ job, project, wtId, mine }: { job: CiJob; project: string; wtId: string; mine: boolean }) {
  const rerun = useRerunCi(project, wtId)
  const ref = job.jobId ?? job.name
  const analysis = useAction<CiOutput>('ci-analyze', { project, worktree: wtId, ref }, { job })
  const fix = useAction<FixOutput>('ci-fix', { project, worktree: wtId, ref }, { job })
  const toast = useToast()
  const d = analysis.result
  const isFail = job.state === 'fail'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <Dot color={DOT[job.state]} className="size-2.5" />
        <span className="min-w-40 flex-1 font-mono text-[13px] font-medium break-all">{job.workflow ? `${job.workflow} › ` : ''}{job.name}</span>
        {job.duration && <span className="font-mono text-xs text-muted-foreground">{job.duration}</span>}
        <Badge tone={ciTone(job.state)}>{ciLabel[job.state]}</Badge>
        {job.url && <Button variant="ghost" size="sm" asChild><a href={job.url} target="_blank" rel="noreferrer">Logs<ArrowUpRightIcon /></a></Button>}
        {isFail && !d && (
          <Button variant="outline" size="sm" disabled={analysis.busy || !job.jobId} title={job.jobId ? undefined : 'Check externe : pas de log GitHub Actions'} onClick={() => analysis.start({ job })}>
            {analysis.busy ? <Spinner /> : <SparklesIcon />}Analyser l’échec
          </Button>
        )}
      </div>
      {isFail && (analysis.id || fix.id) && (
        <div className="flex flex-col gap-3 px-5 pb-4">
          <RunPanel id={analysis.id} events={analysis.events} running={analysis.running} run={analysis.run} label="Claude lit les logs du job" onStop={analysis.stop} action={analysis} />
          {d && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SectionLabel className="mb-0">Diagnostic de l’IA</SectionLabel>
                <Badge tone={ORIGIN_TONE[d.origin]}>{ORIGIN[d.origin]}</Badge>
              </div>
              <p className="text-sm leading-relaxed">{d.cause}</p>
              <p className="text-sm leading-relaxed"><strong className="font-medium">Correctif proposé : </strong>{d.fix}</p>
              <div className="flex flex-wrap gap-2">
                {d.fixable && mine && !fix.busy && fix.run?.status !== 'success' && (
                  <Button size="sm" onClick={() => fix.start({ job, ci: { cause: d.cause, fix: d.fix } })}>Appliquer le correctif et pousser</Button>
                )}
                {d.fixable && !mine && (
                  <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(`CI « ${job.name} » : ${d.cause}\nCorrection : ${d.fix}`).then(() => toast('Diagnostic copié pour la review'))}>Copier pour la review</Button>
                )}
                {job.runId && (
                  <Button variant="outline" size="sm" disabled={rerun.isPending} onClick={() => rerun.mutate({ runId: job.runId!, jobId: job.jobId }, { onSuccess: (r) => toast(r.alreadyRunning ? `${job.name} est déjà en cours sur GitHub` : `${job.name} relancé`), onError: (e) => toast(e.message, true) })}>
                    Relancer le job
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => analysis.start({ job })} disabled={analysis.busy}>Ré-analyser</Button>
              </div>
              <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit et push" onStop={fix.stop} action={fix} />
              <BlockedCommit run={fix.run} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
