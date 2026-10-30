import { ArrowUpRightIcon, ChevronRightIcon, OctagonAlertIcon, ClipboardCopyIcon, RefreshCwIcon, SparklesIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { CheckItem, CheckReport, ChecksAnalyzeOutput, FixOutput } from '../../../../shared/types.ts'
import { useRefreshProject } from '../../data/mutations.ts'
import { useChecks } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, Empty, ErrorBox, PromptMenu, RunPanel, SectionLabel, Spinner, SuccessBox, ago, plural, useToast, type Tone } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'

const STATUS: Record<CheckReport['status'], [string, Tone]> = { pass: ['Rien à signaler', 'green'], warn: ['À regarder', 'amber'], fail: ['En échec', 'red'] }
/** Rapport avec une section Oxlint : seul son compte sur les lignes ajoutées décide. */
const GATE: Record<'pass' | 'fail', [string, Tone]> = { pass: ['La PR passe', 'green'], fail: ['Bloque la PR', 'red'] }
const VERDICT: Record<CheckItem['verdict'], [string, Tone]> = { fix: ['À corriger', 'amber'], ignore: ['À ignorer', 'gray'], manual: ['Hors du dépôt', 'blue'] }

/** Rapports qui demandent mon attention : le compteur de l'onglet. */
export const checksToReview = (reports: CheckReport[] | undefined) => (reports ?? []).filter((r) => r.status !== 'pass' && !r.stale).length

export function ChecksTab({ project, detail, wtId }: TabProps) {
  const checks = useChecks(project.id, wtId)
  const refresh = useRefreshProject()
  const reports = checks.data ?? []
  return (
    <section className="flex flex-col gap-4" aria-label="Contrôles">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <span className="text-sm text-muted-foreground">Rapports postés sur la PR par les contrôles automatiques (qualité de code, variables d’environnement…), mis à jour à chaque push.</span>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(project.id)}>{refresh.isPending ? <Spinner /> : <RefreshCwIcon />}Actualiser</Button>
          <PromptMenu items={[['checks-analyze', 'Analyser un contrôle'], ['checks-fix', 'Corriger un contrôle']]} />
        </span>
      </div>
      {checks.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Lecture des commentaires de la PR…</div>}
      <ErrorBox error={checks.error} />
      {checks.data && !reports.length && <Empty title="Aucun rapport de contrôle sur cette PR." />}
      {reports.map((r) => <ReportCard key={r.id} report={r} project={project.id} wtId={wtId} mine={detail.pr!.mine} />)}
    </section>
  )
}

function ReportCard({ report: r, project, wtId, mine }: { report: CheckReport; project: string; wtId: string; mine: boolean }) {
  const analysis = useAction<ChecksAnalyzeOutput>('checks-analyze', { project, worktree: wtId, ref: r.id }, { report: r.id })
  const fix = useAction<FixOutput>('checks-fix', { project, worktree: wtId, ref: r.id }, { report: r.id })
  const toast = useToast()
  const out = analysis.result
  // Par défaut : ce qui bloque la PR, et ce qu'elle a introduit et qui se corrige dans le code.
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => setPicked(out?.items.filter((i) => i.blocking || (i.verdict === 'fix' && i.introduced)).map((i) => i.id) ?? []), [out])
  const selected = out?.items.filter((i) => picked.includes(i.id)) ?? []
  const [label, tone] = r.blocking == null ? STATUS[r.status] : GATE[r.blocking > 0 ? 'fail' : 'pass']

  const copy = () =>
    navigator.clipboard.writeText(selected.map((i) => `${i.source}${i.file ? ` · ${i.file}${i.line ? `:${i.line}` : ''}` : ''} : ${i.problem}\nCorrection : ${i.fix}`).join('\n\n'))
      .then(() => toast('Copié : à coller dans ta review'))

  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <span className="font-semibold">{r.title}</span>
        <Badge tone={tone}>{label}</Badge>
        {r.stale && <Badge tone="gray">Ancien commit · nouveau passage attendu</Badge>}
        <span className="text-xs text-muted-foreground">mis à jour {ago(r.updatedAt)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild><a href={r.url} target="_blank" rel="noreferrer">Commentaire<ArrowUpRightIcon /></a></Button>
          <Button variant={r.status === 'pass' ? 'outline' : 'default'} size="sm" disabled={analysis.busy} onClick={() => analysis.start({ report: r.id })}>
            {analysis.busy ? <Spinner /> : <SparklesIcon />}{out ? 'Ré-analyser' : 'Analyser'}
          </Button>
        </span>
      </div>
      {r.blocking != null && (
        <div className="px-5 pb-3">
          {r.blocking > 0 ? (
            <Alert variant="destructive">
              <OctagonAlertIcon />
              <AlertTitle>Oxlint sur les lignes ajoutées : {plural(r.blocking, 'problème', 'problèmes')}</AlertTitle>
              <AlertDescription>C’est ce qui bloque la PR : à corriger pour qu’elle passe.</AlertDescription>
            </Alert>
          ) : <SuccessBox>Aucun problème Oxlint sur les lignes ajoutées : la PR passe.</SuccessBox>}
        </div>
      )}
      {r.metrics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {r.blocking != null && <span className="text-xs text-muted-foreground">Indicatif, ne bloque pas :</span>}
          {r.metrics.map((m) => <Badge key={m.label} tone={m.value > 0 && r.blocking == null ? 'amber' : 'gray'}>{m.label} : {m.value}</Badge>)}
        </div>
      )}
      <details className="group border-t">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />Rapport complet{r.command && <span className="font-mono text-xs">· détail en local : {r.command}</span>}
        </summary>
        <pre className="max-h-96 overflow-auto px-5 pb-4 font-mono text-xs whitespace-pre-wrap">{r.body}</pre>
      </details>
      {(analysis.id || fix.id) && (
        <div className="flex flex-col gap-3 border-t px-5 py-4">
          <RunPanel id={analysis.id} events={analysis.events} running={analysis.running} run={analysis.run} label={r.command ? `Rapport détaillé (${r.command}), puis tri` : 'Tri des problèmes signalés'} onStop={analysis.stop} action={analysis} />
          {out && (
            <>
              <p className="text-sm leading-relaxed">{out.summary}</p>
              {!out.items.length && <p className="text-sm text-muted-foreground">Aucun problème à traiter.</p>}
              {out.items.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  {out.items.map((i) => (
                    <label key={i.id} className="flex cursor-pointer gap-3 border-t px-4 py-3 first:border-t-0">
                      <Checkbox className="mt-0.5" checked={picked.includes(i.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
                      <span className={cn('min-w-0 flex-1', i.verdict === 'ignore' && !picked.includes(i.id) && 'opacity-70')}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {i.blocking && <Badge tone="red">Bloque la PR</Badge>}
                          <Badge tone={VERDICT[i.verdict][1]}>{VERDICT[i.verdict][0]}</Badge>
                          <Badge tone={i.introduced ? 'purple' : 'gray'}>{i.introduced ? 'Introduit par la PR' : 'Existait déjà'}</Badge>
                          <span className="text-xs text-muted-foreground">{i.source}</span>
                          {i.file && <span className="font-mono text-xs break-all">{i.file}{i.line ? `:${i.line}` : ''}</span>}
                        </span>
                        <span className="mt-1.5 block text-sm font-medium">{i.problem}</span>
                        <span className="mt-1 block text-sm text-muted-foreground">{i.reason}</span>
                        <span className="mt-1 block text-sm"><span className="font-medium">{i.verdict === 'manual' ? 'À faire : ' : 'Correction : '}</span>{i.fix}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {out.items.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <SectionLabel className="mb-0">{plural(selected.length, 'problème choisi', 'problèmes choisis')}</SectionLabel>
                  {mine ? (
                    <Button size="sm" disabled={!selected.length || fix.busy || selected.some((i) => i.verdict === 'manual')} title={selected.some((i) => i.verdict === 'manual') ? 'Une action hors du dépôt ne se corrige pas dans le code : décoche-la' : undefined}
                      onClick={() => fix.start({ report: r.id, checkItems: selected })}>
                      {fix.busy ? <Spinner /> : <WrenchIcon />}Corriger la sélection et pousser
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!selected.length} onClick={copy}><ClipboardCopyIcon />Copier dans ma review</Button>
                  )}
                </div>
              )}
              <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit et push" onStop={fix.stop} action={fix} />
              <BlockedCommit run={fix.run} />
            </>
          )}
        </div>
      )}
    </article>
  )
}
