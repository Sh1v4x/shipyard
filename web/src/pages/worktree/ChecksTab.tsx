import { ArrowRightIcon, ArrowUpRightIcon, ChevronRightIcon, OctagonAlertIcon, ClipboardCopyIcon, MessageSquareIcon, RefreshCwIcon, SendIcon, SparklesIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { CheckItem, CheckReport, ChecksAnalyzeOutput, FixOutput } from '../../../../shared/types.ts'
import { useRefreshProject } from '../../data/mutations.ts'
import { useChecks } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, Empty, ErrorBox, PromptMenu, RunPanel, SectionLabel, Spinner, SuccessBox, ago, plural, useToast, type Tone } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { actionsRunning } from './checklist.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'

const STATUS: Record<CheckReport['status'], [string, Tone]> = { pass: ['Rien à signaler', 'green'], warn: ['À regarder', 'amber'], fail: ['En échec', 'red'] }
/** Rapport avec une section Oxlint : seul son compte sur les lignes ajoutées décide. */
const GATE: Record<'pass' | 'fail', [string, Tone]> = { pass: ['La PR passe', 'green'], fail: ['Bloque la PR', 'red'] }
const VERDICT: Record<CheckItem['verdict'], [string, Tone]> = { fix: ['À corriger', 'amber'], ignore: ['À ignorer', 'gray'], manual: ['Hors du dépôt', 'blue'], ask: ['À décider', 'purple'] }

const FIX_LABEL: Partial<Record<CheckItem['verdict'], string>> = { manual: 'À faire : ', ask: 'Exception proposée (appliquée seulement si tu coches) : ' }

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
      {reports.map((r) => <ReportCard key={r.id} report={r} project={project.id} wtId={wtId} mine={detail.pr!.mine} ciRunning={actionsRunning(detail.pr!)} />)}
    </section>
  )
}

function ReportCard({ report: r, project, wtId, mine, ciRunning }: { report: CheckReport; project: string; wtId: string; mine: boolean; /** Un job GitHub Actions tourne encore sur le dernier commit. */ ciRunning: boolean }) {
  const analysis = useAction<ChecksAnalyzeOutput>('checks-analyze', { project, worktree: wtId, ref: r.id }, { report: r.id })
  const fix = useAction<FixOutput>('checks-fix', { project, worktree: wtId, ref: r.id }, { report: r.id })
  const toast = useToast()
  const out = analysis.result
  // Par défaut : ce qui bloque la PR, et ce qu'elle a introduit et qui se corrige dans le code.
  // Jamais une exception proposée (ask) : désactiver une règle se décide en la cochant soi-même.
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => setPicked(out?.items.filter((i) => i.verdict !== 'ask' && (i.blocking || (i.verdict === 'fix' && i.introduced))).map((i) => i.id) ?? []), [out])
  const selected = out?.items.filter((i) => picked.includes(i.id)) ?? []
  const [label, tone] = r.blocking == null ? STATUS[r.status] : GATE[r.blocking > 0 ? 'fail' : 'pass']
  // Nouveau passage en cours : le rapport date du commit d'avant et la CI tourne. Son verdict ne vaut plus rien,
  // on ne l'affiche pas comme l'état de la PR (un rapport qui ne suit pas les commits garde juste son badge gris).
  const pending = r.stale && ciRunning
  // Analyse faite sur une version précédente du rapport (réécrit depuis par un push) : ses problèmes ne sont plus à jour.
  const analysedAt = analysis.run?.startedAt ?? null
  const outdated = !!out && !!analysedAt && analysedAt < r.updatedAt && !analysis.busy
  const [showOld, setShowOld] = useState(false)
  const hideAnalysis = pending || (outdated && !showOld)

  // Mon message à l'agent qui a fait l'analyse : il la révise dans sa session, avec tout ce qu'il a déjà lu.
  const [message, setMessage] = useState('')
  const send = async () => {
    const feedback = message.trim()
    if (!feedback || !analysis.id) return
    if (await analysis.start({ report: r.id, feedback, previousRunId: analysis.id })) setMessage('')
  }
  const where = (i: CheckItem) => (i.file ? `${i.file}${i.line ? `:${i.line}` : ''}` : i.source)

  const copy = () =>
    navigator.clipboard.writeText(selected.map((i) => `${i.source}${i.file ? ` · ${i.file}${i.line ? `:${i.line}` : ''}` : ''} : ${i.problem}\nCorrection : ${i.fix}`).join('\n\n'))
      .then(() => toast('Copié : à coller dans ta review'))

  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <span className="font-semibold">{r.title}</span>
        {pending ? <Badge tone="blue"><Spinner className="size-3" />Nouveau passage en cours</Badge> : <Badge tone={tone}>{label}</Badge>}
        {r.stale && !pending && <Badge tone="gray">Pas mis à jour sur le dernier commit</Badge>}
        <span className="text-xs text-muted-foreground">{pending ? 'rapport précédent : ' : ''}mis à jour {ago(r.updatedAt)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild><a href={r.url} target="_blank" rel="noreferrer">Commentaire<ArrowUpRightIcon /></a></Button>
          <Button variant={r.status === 'pass' || pending ? 'outline' : 'default'} size="sm" disabled={analysis.busy || pending} title={pending ? 'Attends le nouveau rapport : celui-ci date du commit précédent' : undefined} onClick={() => { setShowOld(false); void analysis.start({ report: r.id }) }}>
            {analysis.busy ? <Spinner /> : <SparklesIcon />}{out ? 'Ré-analyser' : 'Analyser'}
          </Button>
        </span>
      </div>
      {pending && (
        <p className="px-5 pb-3 text-sm text-muted-foreground">Le contrôle tourne sur le dernier commit. Le rapport ci-dessous est celui du commit précédent : il sera remplacé à la fin du passage, et la page se met à jour toute seule.</p>
      )}
      {!pending && r.blocking != null && (
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
      {!pending && r.metrics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {r.blocking != null && <span className="text-xs text-muted-foreground">Indicatif, ne bloque pas :</span>}
          {r.metrics.map((m) => <Badge key={m.label} tone={m.value > 0 && r.blocking == null ? 'amber' : 'gray'}>{m.label} : {m.value}</Badge>)}
        </div>
      )}
      <details className="group border-t">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />{pending ? 'Rapport du commit précédent' : 'Rapport complet'}{r.command && <span className="font-mono text-xs">· détail en local : {r.command}</span>}
        </summary>
        <pre className="max-h-96 overflow-auto px-5 pb-4 font-mono text-xs whitespace-pre-wrap">{r.body}</pre>
      </details>
      {(analysis.id || fix.id) && hideAnalysis && (
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1">
            {pending
              ? 'L’analyse précédente est masquée : elle portait sur le rapport d’avant.'
              : `L’analyse du ${new Date(analysedAt!).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} portait sur une version précédente du rapport, mis à jour depuis. Ré-analyse pour voir ce qui reste.`}
          </span>
          {!pending && <Button variant="ghost" size="sm" onClick={() => setShowOld(true)}>Afficher quand même</Button>}
        </div>
      )}
      {(analysis.id || fix.id) && !hideAnalysis && (
        <div className="flex flex-col gap-3 border-t px-5 py-4">
          {outdated && <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">Analyse d’une version précédente du rapport : ces problèmes ne sont peut-être plus d’actualité.</p>}
          <RunPanel id={analysis.id} events={analysis.events} running={analysis.running} run={analysis.run} label={r.command ? `Rapport détaillé (${r.command}), puis tri` : 'Tri des problèmes signalés'} onStop={analysis.stop} action={analysis} />
          {out && (
            <>
              <p className="text-sm leading-relaxed">{out.summary}</p>
              {!out.items.length && <p className="text-sm text-muted-foreground">Aucun problème à traiter.</p>}
              {out.items.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  {out.items.map((i) => (
                    <div key={i.id} className="flex gap-3 border-t px-4 py-3 first:border-t-0">
                      <Checkbox id={`check-${r.id}-${i.id}`} className="mt-0.5" checked={picked.includes(i.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
                      <div className={cn('min-w-0 flex-1', i.verdict === 'ignore' && !picked.includes(i.id) && 'opacity-70')}>
                        <label htmlFor={`check-${r.id}-${i.id}`} className="block cursor-pointer">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {i.blocking && <Badge tone="red">Bloque la PR</Badge>}
                          <Badge tone={VERDICT[i.verdict][1]}>{VERDICT[i.verdict][0]}</Badge>
                          <Badge tone={i.introduced ? 'purple' : 'gray'}>{i.introduced ? 'Introduit par la PR' : 'Existait déjà'}</Badge>
                          <span className="text-xs text-muted-foreground">{i.source}</span>
                          {i.file && <span className="font-mono text-xs break-all">{i.file}{i.line ? `:${i.line}` : ''}</span>}
                        </span>
                        <span className="mt-1.5 block text-sm font-medium">{i.problem}</span>
                        <span className="mt-1 block text-sm text-muted-foreground">{i.reason}</span>
                        <span className="mt-1 block text-sm"><span className="font-medium">{FIX_LABEL[i.verdict] ?? 'Correction : '}</span>{i.fix}</span>
                        </label>
                        {/* Hors du label de la case : sélectionner du code ne doit pas la cocher. */}
                        {(i.before || i.after) && (
                          <span className="mt-2 grid items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                            <CodeBlock title="Avant" code={i.before} tone="red" />
                            <ArrowRightIcon className="hidden size-4 self-center text-muted-foreground lg:block" aria-hidden />
                            <CodeBlock title="Après" code={i.after} tone="green" />
                          </span>
                        )}
                        {mine && (
                          <Button variant="ghost" size="sm" className="mt-1.5 -ml-2 text-muted-foreground"
                            onClick={() => { setMessage((m) => `${m.trim() ? `${m.trimEnd()}\n` : ''}${where(i)} : `); document.getElementById(`checks-message-${r.id}`)?.focus() }}>
                            <MessageSquareIcon />Demander une autre approche
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {mine && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`checks-message-${r.id}`} className="text-sm font-medium">Échanger avec l’agent de l’analyse <span className="font-normal text-muted-foreground">(demande une autre approche, pose une question : il révise ses corrections avec tout ce qu’il a déjà lu)</span></label>
                  <Textarea id={`checks-message-${r.id}`} rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
                    placeholder="Ex. : vehicles.utils.ts:69 : pas de schéma zod ici, type la réponse dans le client RegCheck · pourquoi cette règle se déclenche sur le catch ?" />
                  <div><Button variant="outline" size="sm" disabled={!message.trim() || analysis.busy} onClick={() => void send()} title="⌘ + Entrée"><SendIcon />Envoyer à l’agent</Button></div>
                </div>
              )}
              {out.items.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <SectionLabel className="mb-0">{plural(selected.length, 'problème choisi', 'problèmes choisis')}</SectionLabel>
                  {mine ? (
                    <Button size="sm" disabled={!selected.length || fix.busy || selected.some((i) => i.verdict === 'manual')} title={selected.some((i) => i.verdict === 'manual') ? 'Une action hors du dépôt ne se corrige pas dans le code : décoche-la' : undefined}
                      onClick={() => fix.start({ report: r.id, checkItems: selected, previousRunId: analysis.id ?? undefined })}>
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

/** Un extrait de code de la correction proposée : l'état actuel, ou ce qu'il deviendra. */
function CodeBlock({ title, code, tone }: { title: string; code: string | null | undefined; tone: 'red' | 'green' }) {
  return (
    <span className={cn('flex min-w-0 flex-col overflow-hidden rounded-md border', tone === 'red' ? 'border-red-500/25' : 'border-emerald-500/25')}>
      <span className={cn('px-3 py-1 text-xs font-medium', tone === 'red' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>{title}</span>
      <code className="block max-h-96 flex-1 cursor-text overflow-auto bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre select-text">{code || '(rien)'}</code>
    </span>
  )
}
