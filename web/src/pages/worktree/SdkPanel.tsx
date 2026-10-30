import { RefreshCwIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SdkActionOutput, SdkStatus } from '../../../../shared/types.ts'
import { useSdkStatus } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, ErrorBox, RunPanel, Spinner, SuccessBox, plural } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'

/** SDK en retard : pas installé dans sa dernière version, ou des merges pas encore publiés. */
export const lateSdks = (list: SdkStatus[] | undefined) => (list ?? []).filter((s) => (s.latest && s.locked !== s.latest) || (s.unpublished?.length ?? 0) > 0)

/** Panneau « SDK » du worktree : les SDK privés dont dépend la branche, et de quoi les remettre à jour. */
export function SdkPanel({ project, detail, wtId }: TabProps) {
  const q = useSdkStatus(project.id, wtId)
  const late = lateSdks(q.data)
  const mine = detail.pr?.mine ?? detail.worktree.kind !== 'review'
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Lecture des SDK…</div>
  if (q.error) return <ErrorBox error={q.error} />
  const upToDate = (q.data ?? []).filter((s) => !late.includes(s))
  return (
    <section className="flex flex-col gap-4" aria-label="SDK">
      {!q.data?.length && <SuccessBox>Aucun SDK privé (GitHub Packages) dans ce worktree.</SuccessBox>}
      {late.map((s) => <SdkCard key={s.name} s={s} project={project.id} wtId={wtId} mine={mine} />)}
      {upToDate.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="text-xs font-medium text-muted-foreground">À jour</span>
          {upToDate.map((s) => <span key={s.name} className="flex items-center gap-2"><span className="font-mono">{s.name}</span><Badge tone="green">{s.locked}</Badge></span>)}
        </div>
      )}
    </section>
  )
}

function SdkCard({ s, project, wtId, mine }: { s: SdkStatus; project: string; wtId: string; mine: boolean }) {
  const update = useAction<SdkActionOutput>('sdk-update', { project, worktree: wtId, ref: s.name }, { sdk: s.name })
  const publish = useAction<SdkActionOutput>('sdk-publish', { project, worktree: wtId, ref: s.name }, { sdk: s.name })
  const outdated = !!s.latest && s.locked !== s.latest
  const pending = s.unpublished ?? []
  const busy = update.busy || publish.busy
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{s.name}</span>
        <Badge tone={outdated ? 'amber' : 'gray'}>figé en {s.locked ?? '?'}</Badge>
        <Badge tone="blue">dernière publiée : {s.latest ?? '?'}</Badge>
        {s.sourceRepo && <span className="text-xs text-muted-foreground">publié par {s.sourceRepo}{s.sourceBranch ? `@${s.sourceBranch}` : ''}</span>}
      </div>
      {outdated && <p>La CI installe la version figée par le lockfile ({s.locked}) : ce que la branche utilise du SDK peut ne pas y être.</p>}
      {pending.length > 0 && (
        <div className="flex flex-col gap-1">
          <p>
            {plural(pending.length, 'merge arrivé', 'merges arrivés')} dans le SDK depuis {s.latest}, <span className="font-medium">pas encore publiés</span>
            {s.lastRun && !s.lastRun.published && s.lastRun.conclusion === 'success' && <> : le dernier passage de <a className="underline" href={s.lastRun.url} target="_blank" rel="noreferrer">{s.workflow?.file}</a> n’a sorti aucune version</>}.
          </p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{pending.slice(0, 6).map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {outdated && mine && (
          <Button size="sm" variant={pending.length ? 'outline' : 'default'} disabled={busy} onClick={() => void update.start()}>
            {update.busy ? <Spinner /> : <RefreshCwIcon />}Passer en {s.latest} et pousser
          </Button>
        )}
        {pending.length > 0 && (s.workflow?.dispatchable
          ? <Button size="sm" disabled={busy} onClick={() => void publish.start()} title="Lance la publication du SDK, attend la nouvelle version, puis la met à jour ici et pousse">
              {publish.busy ? <Spinner /> : <SparklesIcon />}Publier le SDK{mine ? ' puis mettre à jour' : ''}
            </Button>
          : <span className="text-xs text-muted-foreground">
              Publication à la demande impossible : {s.workflow ? <><span className="font-mono">{s.workflow.file}</span> n’a pas de <span className="font-mono">workflow_dispatch</span></> : 'workflow de publication introuvable'}. Il faut un merge dans le SDK, ou ajouter ce déclencheur.
            </span>)}
      </div>
      <RunPanel id={update.id} events={update.events} running={update.running} run={update.run} label={`Mise à jour de ${s.name}, commit et push`} onStop={update.stop} action={update} />
      <BlockedCommit run={update.run} />
      <RunPanel id={publish.id} events={publish.events} running={publish.running} run={publish.run} label={`Publication de ${s.name}, puis mise à jour`} onStop={publish.stop} action={publish} />
      <BlockedCommit run={publish.run} />
    </div>
  )
}

