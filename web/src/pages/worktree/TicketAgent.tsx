import { CheckIcon, WrenchIcon, ChevronRightIcon, CircleHelpIcon, FlaskConicalIcon, PlayIcon, PlusIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Run, TicketPlanOutput, TicketWorkOutput } from '../../../../shared/types.ts'
import { useAbandonAgent, useRunDecision } from '../../data/mutations.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, PromptMenu, RunPanel, SectionLabel, Spinner, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

const CHECK = { pass: ['OK', 'green'], fail: ['Échec', 'red'], skip: ['Non fait', 'gray'] } as const

const MODES = {
  ticket: { plan: 'ticket-plan', work: 'ticket', title: 'Faire travailler l’IA' },
  // Demande directe, hors ticket et hors commentaire : le prompt part des commits et du diff de la branche.
  change: { plan: 'change-plan', work: 'change', title: 'Modification libre' },
} as const

/** Consigne de « Développer directement » quand aucune n'est écrite : le ticket fait office de plan. */
const DEVELOP_TICKET = 'Implement the ticket as described: it is the plan. If something is ambiguous, pick the reading closest to the ticket and say so in your output.'

/**
 * Faire travailler l'IA sur le ticket, ou sur une modification libre, en trois temps :
 * 1. elle propose un plan, que je peux faire réviser ;
 * 2. j'approuve, elle travaille (captures avant, code, captures après), sans commiter ;
 * 3. elle rend un audit avec l'avant / après : j'approuve, je demande des corrections, ou je refuse.
 */
export function TicketAgent({ project, detail, wtId, mode = 'ticket' }: TabProps & { mode?: keyof typeof MODES }) {
  const m = MODES[mode]
  // Ticket Linear, ou à défaut le ticket local (proposition gardée sur le Mac) : il sert de description.
  const ticket = mode === 'ticket' ? detail.ticket ?? detail.worktree.localTicket ?? null : null
  const scope = { project: project.id, worktree: wtId }
  const plan = useAction<TicketPlanOutput>(m.plan, scope)
  const work = useAction<TicketWorkOutput>(m.work, scope)
  const [extra, setExtra] = useState('')
  const [planFeedback, setPlanFeedback] = useState('')
  // « Nouveau plan » : réaffiche la consigne pour repartir d'une demande neuve (session neuve), plan en cours ou non.
  const [restart, setRestart] = useState(false)

  // Runs abandonnés dans cette session d'écran (le run suivi n'est pas rechargé après coup).
  const [droppedIds, setDroppedIds] = useState<string[]>([])
  const isDropped = (r: { id: string; decision?: Run['decision'] } | null | undefined) => !!r && (r.decision === 'declined' || droppedIds.includes(r.id))
  // Un plan en cours (son run n'est chargé qu'à la fin) passe toujours devant le travail précédent.
  const workIsCurrent = !!work.run && !plan.busy && (!plan.run || Date.parse(work.run.startedAt) >= Date.parse(plan.run.startedAt))
  const workRunning = work.running && (!plan.run || !plan.running)
  const decided = workIsCurrent && ((work.run?.decision && work.run.decision !== 'revised') || isDropped(work.run))
  // Plan écarté par « Abandonner » avant tout travail : on repart de la consigne.
  const planDropped = !workIsCurrent && isDropped(plan.run) && !plan.busy
  const abandoned = planDropped || (decided && isDropped(plan.run))
  // Versions : seulement celles depuis le dernier abandon, pour repartir de zéro.
  const sinceFresh = <A extends { history: { id: string }[] }>(a: A): A => {
    const i = a.history.findIndex((r) => isDropped(r as Run))
    return i < 0 ? a : { ...a, history: a.history.slice(0, i) }
  }
  const abandon = useAbandonAgent(project.id, wtId)
  const toast = useToast()
  const canAbandon = !!plan.id && !abandoned && !(decided && !work.running)

  const doAbandon = () => {
    const ids = { plan: plan.id ?? undefined, work: workIsCurrent ? work.id ?? undefined : undefined }
    if (!confirm(ids.work
      ? 'Abandonner ? Les agents en cours sont arrêtés et les fichiers modifiés par l’IA sont remis comme avant son travail (worktrees liés compris). Tes propres modifications sont gardées.'
      : 'Abandonner ce plan ? L’agent est arrêté et tu repars d’une consigne neuve.')) return
    const reset = () => {
      setDroppedIds([ids.plan, ids.work].filter((x): x is string => !!x))
      setExtra('')
      setPlanFeedback('')
      setRestart(false)
    }
    abandon.mutate(ids, {
      onSuccess: (r) => {
        if (r.needsAll) {
          if (!confirm('Ce travail date d’avant la photo du worktree : impossible de séparer les changements de l’IA des tiens. Annuler toutes les modifications non commitées du worktree ?')) {
            toast('Agents arrêtés. Les fichiers n’ont pas été touchés.')
            return
          }
          abandon.mutate({ ...ids, all: true }, { onSuccess: () => { reset(); toast('Abandonné : toutes les modifications non commitées sont annulées.') }, onError: (e) => toast(e.message, true) })
          return
        }
        reset()
        toast(r.reverted === 'agent' ? 'Abandonné : agents arrêtés, modifications de l’IA annulées.' : 'Abandonné : agents arrêtés.')
      },
      onError: (e) => toast(e.message, true),
    })
  }

  const startPlan = (feedback?: string) => {
    setRestart(false)
    return plan.start({ extra, feedback, previousRunId: feedback ? plan.id : undefined })
  }
  const canRestart = !!plan.id && !decided && !plan.busy && !workRunning && !restart
  // Travail lancé sans plan (« Tout traiter » depuis l'analyse du projet) : sa consigne fait office de plan pour les corrections.
  const workExtra = extra || work.run?.input?.extra || ''
  // Travail lancé sans plan et pas encore tranché : son compte rendu remplace le formulaire du plan.
  const directWork = !plan.id && workIsCurrent && !decided

  return (
    <article className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{m.title}</h2>
          {mode === 'change' && <p className="mt-0.5 text-sm text-muted-foreground">Une modification hors ticket et hors commentaire : l’IA part des commits et du diff de la branche pour l’intégrer au travail existant.</p>}
        </div>
        <span className="flex flex-wrap items-center gap-1">
          {canRestart && <Button variant="outline" size="sm" onClick={() => setRestart(true)}><PlusIcon />Nouveau plan</Button>}
          {canAbandon && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={abandon.isPending} onClick={doAbandon}>
              {abandon.isPending ? <Spinner /> : <Trash2Icon />}Abandonner
            </Button>
          )}
          <PromptMenu items={[[m.plan, 'Plan']]} />
          <PromptMenu items={[[mode === 'change' ? 'change' : ticket ? 'ticket' : 'free', 'Travail']]} />
        </span>
      </div>
      <Steps phase={workIsCurrent ? (decided ? 4 : work.result ? 3 : 2) : plan.result ? 1 : 0} />

      {/* ---------- 0. Consigne et demande de plan ---------- */}
      {(!plan.id || decided || restart || planDropped) && !plan.busy && !workRunning && !(directWork && !restart) && (
        <div className="flex flex-col gap-3">
          {abandoned && (
            <Alert>
              <Undo2Icon />
              <AlertDescription>Démarche abandonnée : agents arrêtés et modifications de l’IA annulées. Repars d’une nouvelle consigne.</AlertDescription>
            </Alert>
          )}
          {decided && !abandoned && (
            <Alert variant={work.run!.decision === 'approved' ? 'success' : 'default'}>
              {work.run!.decision === 'approved' ? <CheckIcon /> : <Undo2Icon />}
              <AlertDescription>
                {work.run!.decision === 'approved' ? 'Travail approuvé : relis les fichiers puis commite avec la carte Commiter.' : 'Travail refusé.'} Les captures ont été supprimées.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={`${mode}-extra`}>{ticket ? 'Consigne en plus' : mode === 'change' ? 'Modification à faire' : 'Consigne'} {ticket && <span className="font-normal text-muted-foreground">(facultatif)</span>}</FieldLabel>
            <Textarea id={`${mode}-extra`} rows={3} value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder={ticket ? 'Ex. réutilise le composant Badge, n’ajoute pas de dépendance…' : mode === 'change' ? 'Ex. : afficher aussi la date de relance dans la carte, renommer le champ en `notifiedAt`, gérer le cas où la liste est vide…' : 'Décris ce que l’IA doit faire dans ce worktree.'} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={(!ticket && !extra.trim()) || plan.busy} onClick={() => startPlan()}>
              <PlayIcon />{decided || restart || planDropped ? 'Nouveau plan' : 'Proposer un plan'}
            </Button>
            {/* Ticket (Linear ou local) sans plan encore : l'IA peut développer tout de suite, le ticket tient lieu de plan. */}
            {ticket && !plan.id && (
              <Button size="sm" variant="outline" disabled={work.busy} onClick={() => void work.start({ extra: extra.trim() || DEVELOP_TICKET })} title="Sans plan à valider : l’IA lit le ticket et développe. Rien n’est commité avant ton accord.">
                {work.busy ? <Spinner /> : <WrenchIcon />}Développer directement
              </Button>
            )}
            {restart && <Button size="sm" variant="ghost" onClick={() => setRestart(false)}>Revenir au plan actuel</Button>}
            <span className="text-sm text-muted-foreground">{restart ? 'Le plan actuel sera remplacé par un plan neuf, à partir de cette consigne.' : ticket && !plan.id ? 'Avec un plan, rien n’est modifié tant que tu ne l’as pas approuvé. Directement, rien n’est commité avant ton accord.' : 'Rien n’est modifié tant que tu n’as pas approuvé le plan.'}</span>
          </div>
        </div>
      )}

      {/* ---------- 1. Plan ---------- */}
      {restart || planDropped ? null : !workIsCurrent || plan.busy ? (
        <>
          <RunPanel id={plan.id} events={plan.events} running={plan.running} run={plan.run} label="Claude explore le code et prépare le plan" onStop={plan.stop} action={sinceFresh(plan)} />
          {plan.result && !plan.busy && (
            <PlanView
              id={mode}
              plan={plan.result}
              note={plan.run?.note ?? null}
              feedback={planFeedback}
              setFeedback={setPlanFeedback}
              busy={work.busy}
              onRevise={() => { void startPlan(planFeedback); setPlanFeedback('') }}
              onApprove={() => work.start({ planRunId: plan.id, extra })}
            />
          )}
        </>
      ) : null}

      {/* ---------- 2 et 3. Travail, avant / après, audit ---------- */}
      {workIsCurrent && !plan.busy && !decided && !restart && (
        <>
          <RunPanel id={work.id} events={work.events} running={work.running} run={work.run} label="L’IA travaille (captures avant, code, captures après)" defaultOpen onStop={work.stop} action={sinceFresh(work)} />
          {work.result && work.run && <WorkResult project={project.id} run={work.run} result={work.result} planRunId={plan.id} restartable={!!plan.id || !!workExtra} onRestart={(fb) => work.start({ planRunId: plan.id ?? undefined, extra: workExtra, feedback: fb, resumeFrom: work.id ?? undefined })} onRetest={() => work.start({ planRunId: plan.id ?? undefined, extra: workExtra, retest: true, resumeFrom: work.id ?? undefined })} />}
          {work.failed && work.run?.status !== 'success' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => work.start({ planRunId: plan.id, extra })}>Relancer le travail</Button>
              <Button size="sm" variant="ghost" onClick={() => startPlan()}>Revenir au plan</Button>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function Steps({ phase }: { phase: number }) {
  const steps = ['Plan', 'Validation', 'Travail', 'Avant / après', 'Décision']
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label="Étapes">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === phase ? 'step' : undefined} className={cn('flex items-center gap-1.5 text-xs', i <= phase ? 'text-foreground' : 'text-muted-foreground', i === phase && 'font-semibold')}>
          <span className={cn('inline-flex size-5 items-center justify-center rounded-full text-[11px]', i < phase ? 'bg-primary text-primary-foreground' : i === phase ? 'border border-foreground' : 'bg-muted')}>
            {i < phase ? <CheckIcon className="size-3" /> : i + 1}
          </span>
          {s}{i < steps.length - 1 && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
        </li>
      ))}
    </ol>
  )
}

function PlanView({ id, plan, note, feedback, setFeedback, busy, onRevise, onApprove }: {
  id: string
  plan: TicketPlanOutput
  /** Dernier message envoyé sur ce plan, et la réponse de l'agent (plan.reply). */
  note: string | null
  feedback: string
  setFeedback: (s: string) => void
  busy: boolean
  onRevise: () => void
  onApprove: () => void
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-dashed pt-4">
      {note && plan.reply && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <p><span className="font-medium">Toi :</span> <span className="whitespace-pre-wrap">{note}</span></p>
          <p><span className="font-medium">Agent :</span> <span className="whitespace-pre-wrap">{plan.reply}</span></p>
        </div>
      )}
      <div>
        <SectionLabel>Plan proposé</SectionLabel>
        <p className="text-sm leading-relaxed">{plan.summary}</p>
      </div>
      <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-sm marker:text-muted-foreground">
        {plan.steps.map((s, i) => (
          <li key={i}>
            <strong className="font-medium">{s.title}</strong>
            <p className="mt-0.5 text-muted-foreground">{s.details}</p>
            {s.files.length > 0 && <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{s.files.join(', ')}</p>}
          </li>
        ))}
      </ol>
      {plan.screenshots.length > 0 && (
        <div>
          <SectionLabel>Écrans capturés avant / après</SectionLabel>
          {plan.screenshots.map((s) => <div key={s.name} className="text-sm">{s.platform === 'android' && <Badge tone="green">Android</Badge>} <span className="font-mono text-xs">{s.route}</span> · {s.description}</div>)}
        </div>
      )}
      {plan.risks.length > 0 && (
        <div>
          <SectionLabel>Points d’attention</SectionLabel>
          <ul className="m-0 list-disc pl-5 text-sm">{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {plan.questions.length > 0 && (
        <Alert variant="warning">
          <CircleHelpIcon />
          <AlertTitle>Questions à trancher avant de lancer</AlertTitle>
          <AlertDescription>
            <ul className="m-0 list-disc pl-5">{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`${id}-plan-fb`} className="flex-wrap">Échanger sur le plan <span className="font-normal text-muted-foreground">(une question, une réponse aux questions, un ajustement : le plan n’est pas refait de zéro)</span></FieldLabel>
        <Textarea id={`${id}-plan-fb`} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedback.trim()) onRevise() }}
          placeholder="Ex. : pourquoi toucher à l’API ? · garde le composant existant et ajoute juste une prop · pour la question 2 : oui, sur le mobile aussi." />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onApprove}>{busy ? <Spinner /> : <CheckIcon />}Approuver et lancer le travail</Button>
        <Button size="sm" variant="outline" disabled={!feedback.trim()} onClick={onRevise} title="⌘ + Entrée">Envoyer</Button>
      </div>
    </div>
  )
}

/** Compte rendu d'un travail de l'IA, avec approbation, corrections et refus (onglet Ticket, correctifs du test). */
export function WorkResult({ project, run, result, planRunId, restartable = !!planRunId, onRestart, onRetest }: {
  project: string
  run: Run
  result: TicketWorkOutput
  planRunId: string | null
  /** Corrections et re-test possibles : un plan à reprendre, ou une consigne qui en tient lieu. */
  restartable?: boolean
  onRestart: (feedback: string) => void
  /** Refait la phase de test (app, captures, vérifications) sans toucher au code, et remplace ce compte rendu. */
  onRetest: () => void
}) {
  const [feedback, setFeedback] = useState('')
  const toast = useToast()
  const decision = useRunDecision(project)
  const busy = decision.isPending

  const decide = (value: 'approved' | 'declined', discard = false) => {
    if (discard && !confirm('Refuser et annuler toutes les modifications du worktree ? Les fichiers modifiés et créés seront perdus.')) return
    decision.mutate({ run: run.id, decision: value, discard }, {
      onSuccess: () => toast(value === 'approved' ? 'Approuvé. Les captures sont supprimées.' : discard ? 'Refusé : modifications annulées, captures supprimées.' : 'Refusé. Les captures sont supprimées.'),
      onError: (e) => toast(e.message, true),
    })
  }

  const shot = (file: string | null) => (file ? `/api/shots/${run.id}/${encodeURIComponent(file.split('/').pop()!)}` : null)
  const failed = result.checks.filter((c) => c.status === 'fail').length

  return (
    <div className="flex flex-col gap-4 border-t border-dashed pt-4">
      <div>
        <SectionLabel>Résultat</SectionLabel>
        <p className="text-sm leading-relaxed">{result.summary}</p>
      </div>

      {result.screenshots.length > 0 ? (
        <div className="flex flex-col gap-3">
          <SectionLabel className="mb-0">Avant / après</SectionLabel>
          {result.screenshots.map((s) => (
            <figure key={s.name} className="m-0">
              <figcaption className="mb-1.5 text-sm">{s.platform === 'android' && <><Badge tone="green">Android</Badge> </>}<strong className="font-medium">{s.name}</strong> · <span className="text-muted-foreground">{s.description}</span></figcaption>
              <div className="flex flex-wrap items-start gap-2.5">
                {(['before', 'after'] as const).map((k) => {
                  const src = shot(s[k])
                  return (
                    <div key={k} className={cn('flex min-w-0 flex-col gap-1', s.platform === 'android' ? 'w-[260px] max-w-full' : 'flex-[1_1_280px]')}>
                      <span className="text-xs text-muted-foreground">{k === 'before' ? 'Avant' : 'Après'}</span>
                      {src ? (
                        <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${s.name} ${k === 'before' ? 'avant' : 'après'}`} className="block w-full rounded-lg border" /></a>
                      ) : <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Pas de capture</div>}
                    </div>
                  )
                })}
              </div>
            </figure>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Aucune capture : {result.appNote}</p>}
      {result.screenshots.length > 0 && result.appNote && <p className="text-sm text-muted-foreground">{result.appNote}</p>}

      <details open className="group rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Audit · {plural(result.changes.length, 'fichier', 'fichiers')} · {failed ? <span className="text-red-600 dark:text-red-400">{plural(failed, 'vérification en échec', 'vérifications en échec')}</span> : <span className="text-emerald-600 dark:text-emerald-400">vérifications OK</span>}
        </summary>
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          <div>
            {result.changes.map((c) => <div key={c.file} className="py-0.5 text-sm break-words"><span className="font-mono text-xs">{c.file}</span> · <span className="text-muted-foreground">{c.change}</span></div>)}
          </div>
          <div className="flex flex-col gap-1.5">
            {result.checks.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={CHECK[c.status][1]}>{CHECK[c.status][0]}</Badge>
                <strong className="font-medium">{c.name}</strong>
                <span className="min-w-0 flex-1 text-muted-foreground">{c.detail}</span>
              </div>
            ))}
          </div>
          {result.risks.length > 0 && <div><SectionLabel>Risques</SectionLabel><ul className="m-0 list-disc pl-5 text-sm">{result.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          {result.followUps.length > 0 && <div><SectionLabel>À vérifier ou à faire</SectionLabel><ul className="m-0 list-disc pl-5 text-sm">{result.followUps.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="work-fb" className="flex-wrap">Demander des corrections <span className="font-normal text-muted-foreground">(l’IA reprend avec tout le contexte)</span></FieldLabel>
        <Textarea id="work-fb" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Ex. le badge doit être à droite du libellé, et en gris sur mobile." />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide('approved')}><CheckIcon />Approuver</Button>
        <Button size="sm" variant="outline" disabled={busy || !feedback.trim() || !restartable} onClick={() => onRestart(feedback)}>Demander ces corrections</Button>
        <Button size="sm" variant="outline" disabled={busy || !restartable} title="Relance l’app, refait les captures et les vérifications, sans toucher au code : le compte rendu est remplacé" onClick={onRetest}>
          <FlaskConicalIcon />Re-tester
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => decide('declined', true)}>Refuser et annuler les modifications</Button>
      </div>
      <p className="text-xs text-muted-foreground">Rien n’est commité : après approbation, commite avec la carte Commiter. Les captures sont supprimées dès ta décision.</p>
    </div>
  )
}
