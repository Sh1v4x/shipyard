import { CheckCheckIcon, ChevronRightIcon, FileIcon, PlayIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { FollowupItem, FollowupOutput, FollowupStatus, ReviewThread } from '../../../../shared/types.ts'
import { labelWithRole } from '../../../../shared/review.ts'
import { ThreadMessages } from '@/components/Thread'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDismissInbox, useReplyThread } from '../../data/mutations.ts'
import { useHealth, useLabelRules, useThreads } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Badge, ErrorBox, PromptMenu, RunPanel, Spinner, SuccessBox, plural, useToast, type Tone } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

const STATUS: Record<FollowupStatus, [string, Tone]> = {
  corrigé: ['Corrigé', 'green'],
  partiel: ['Corrigé en partie', 'amber'],
  'non-corrigé': ['Non corrigé', 'red'],
  contesté: ['Contesté par l’auteur', 'purple'],
}

/** J'ai répondu dans le fil après l'auteur (le dernier message est de moi, et ce n'est pas mon commentaire d'origine). */
export const isWaitingAuthor = (t: ReviewThread) => t.awaitingReviewer && t.comments.length > 1

/** Mes fils encore ouverts sur la PR d'un autre : ce que j'ai demandé, ce qu'il a répondu, ce qui reste à faire. */
export const myOpenThreads = (threads: ReviewThread[] | undefined) => (threads ?? []).filter((t) => t.byMe && !t.isDraft && !t.isResolved)

/**
 * Suivi de mes retours sur la PR d'un autre : chaque commentaire que je lui ai laissé, avec sa réponse.
 * L'IA vérifie dans le code ce qui est corrigé ; je résous, je réponds ou je relance fil par fil.
 */
export function FollowupTab({ project, detail, wtId }: TabProps) {
  const pr = detail.pr!
  const q = useThreads(project.id, wtId)
  const me = useHealth().data?.github
  const rules = useLabelRules()
  const check = useAction<FollowupOutput>('followup-check', { project: project.id, worktree: wtId })
  const [refused, setRefused] = useRefused(check.id)
  // Réponses proposées modifiées à la main, par fil : reprises par « Tout approuver ».
  const [edits, setEdits] = useState<Record<string, string>>({})
  const reply = useReplyThread(project.id, wtId)
  const toast = useToast()
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement de tes commentaires…</div>
  if (!q.data) return <ErrorBox error={q.error} />
  const open = myOpenThreads(q.data)
  // J'ai répondu après l'auteur : la balle est dans son camp, le fil passe « en attente » (plus rien à approuver).
  const waiting = open.filter(isWaitingAuthor)
  const active = open.filter((t) => !isWaitingAuthor(t))
  // L'auteur a répondu en dernier : à lire en premier. Puis mes commentaires restés sans aucune réponse.
  const answered = active.filter((t) => !t.awaitingReviewer)
  const silent = active.filter((t) => t.awaitingReviewer)
  const resolved = q.data.filter((t) => t.byMe && !t.isDraft && t.isResolved)
  const items = new Map((check.result?.items ?? []).map((i) => [i.threadId, i]))
  const rerequested = labelWithRole(rules, 'awaitingReview', pr.labels)
  const changes = labelWithRole(rules, 'changes', pr.labels)
  // Propositions encore à valider : fil toujours ouvert, analysé, et proposition non refusée.
  // Fil où j'ai déjà répondu depuis l'analyse : sa proposition est appliquée, on ne la repropose pas (évite les doublons).
  const repliedSince = (t: ReviewThread) => {
    const last = t.comments.at(-1)
    return !!check.run && !!last && last.author === me && last.createdAt > check.run.startedAt
  }
  const proposals = active.flatMap((t) => {
    const item = items.get(t.id)
    if (!item || refused.includes(t.id) || repliedSince(t)) return []
    const p = proposalOf(item)
    const body = p.reply ? (edits[t.id] ?? p.reply).trim() : ''
    return p.reply && !body ? [] : [{ thread: t, body, resolve: p.resolve }]
  })
  const approveAll = async () => {
    const replies = proposals.filter((p) => p.body).length
    const resolves = proposals.filter((p) => p.resolve).length
    if (!confirm(`Appliquer ${plural(proposals.length, 'proposition', 'propositions')} sur GitHub : ${plural(replies, 'réponse postée', 'réponses postées')}, ${plural(resolves, 'fil résolu', 'fils résolus')} ?`)) return
    setBulk({ done: 0, total: proposals.length })
    let failed = 0
    // Une à une : GitHub limite les mutations rapprochées, et un échec n'arrête pas les suivantes.
    for (const [i, p] of proposals.entries()) {
      try {
        await reply.mutateAsync({ threadId: p.thread.id, body: p.body, resolve: p.resolve })
      } catch {
        failed++
      }
      setBulk({ done: i + 1, total: proposals.length })
    }
    setBulk(null)
    toast(failed ? `${proposals.length - failed} appliquée(s), ${failed} en échec : réessaie-les une par une` : `${plural(proposals.length, 'proposition appliquée', 'propositions appliquées')} sur GitHub`, failed > 0)
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Suivi des retours">
      <AutoDismiss runId={check.id} done={!!check.result && !check.busy && !bulk && proposals.length === 0} />
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-5 py-4">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <p className="font-semibold">Tes retours à {pr.author}</p>
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge tone={answered.length ? 'amber' : 'gray'}>{plural(answered.length, 'réponse à lire', 'réponses à lire')}</Badge>
            <span>{silent.length} sans réponse · {waiting.length} en attente de l’auteur · {plural(resolved.length, 'résolu', 'résolus')}</span>
          </span>
          {rerequested && <p className="text-sm">L’auteur a redemandé ta review (label « {rerequested.name} ») : vérifie ce qu’il a corrigé avant de relancer une re-review.</p>}
          {!rerequested && changes && <p className="text-sm text-muted-foreground">La PR attend encore ses correctifs (label « {changes.name} »).</p>}
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <PromptMenu items={[['followup-check', 'Suivi des retours']]} />
          {open.length > 0 && (
            <Button size="sm" disabled={check.busy} onClick={() => check.start()}>
              {check.busy ? <Spinner /> : <PlayIcon />}{check.result ? 'Revérifier les correctifs' : 'Vérifier les correctifs avec l’IA'}
            </Button>
          )}
        </span>
      </div>
      <RunPanel id={check.id} events={check.events} running={check.running} run={check.run} label="Claude vérifie chaque retour dans le code" onStop={check.stop} action={check} />
      {check.result && !check.busy && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-5 py-3 text-sm">
          <p className="min-w-0 flex-1 basis-80">{check.result.summary}</p>
          {proposals.length > 0 && (
            <Button size="sm" disabled={bulk != null} onClick={approveAll} title="Poste chaque réponse proposée (avec tes modifications) et résout les fils proposés à la résolution, hors propositions refusées">
              {bulk ? <><Spinner />{bulk.done} / {bulk.total}</> : <><CheckCheckIcon />Tout approuver · {proposals.length}</>}
            </Button>
          )}
        </div>
      )}

      {open.length === 0 && <SuccessBox><span className="font-medium">Tous tes commentaires sur cette PR sont résolus.</span></SuccessBox>}
      {active.length === 0 && open.length > 0 && <SuccessBox><span className="font-medium">Rien à traiter : tu as répondu à tous les fils ouverts, ils attendent l’auteur.</span></SuccessBox>}
      {[...answered, ...silent].map((t) => <FollowupCard
        key={t.id}
        thread={t}
        item={items.get(t.id)}
        text={edits[t.id]}
        onText={(v) => setEdits((e) => ({ ...e, [t.id]: v }))}
        refused={refused.includes(t.id)}
        applied={repliedSince(t)}
        onRefuse={(v) => setRefused(t.id, v)}
        locked={bulk != null}
        me={me}
        project={project.id}
        wtId={wtId}
      />)}

      {waiting.length > 0 && (
        <Fold title={`En attente de l’auteur · ${waiting.length}`}>
          <div className="flex flex-col gap-3">
            {waiting.map((t) => <FollowupCard key={t.id} thread={t} waiting locked={bulk != null} refused={false} applied={false} onRefuse={() => undefined} onText={() => undefined} me={me} project={project.id} wtId={wtId} />)}
          </div>
        </Fold>
      )}

      {resolved.length > 0 && (
        <Fold title={`Résolus · ${resolved.length}`}>
          {resolved.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0">
              <span className="font-mono text-xs break-all text-muted-foreground">{t.path}{t.line ? `:${t.line}` : ''}</span>
              <ThreadMessages thread={t} me={me} />
            </div>
          ))}
        </Fold>
      )}
    </section>
  )
}

/** Plus aucune proposition à valider (appliquées, refusées ou fils résolus) : l'analyse sort de « À valider ». */
function AutoDismiss({ runId, done }: { runId: string | null; done: boolean }) {
  const dismiss = useDismissInbox()
  useEffect(() => {
    if (runId && done) dismiss.mutate(runId)
  }, [runId, done]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Propositions refusées, mémorisées par analyse : une nouvelle vérification refait une proposition pour chaque fil. */
function useRefused(runId: string | null) {
  const key = `devpanel:followup-refused:${runId}`
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }
  const [state, setState] = useState<{ key: string; ids: string[] }>(() => ({ key, ids: read() }))
  const ids = state.key === key ? state.ids : read()
  const set = (threadId: string, v: boolean) => {
    const next = v ? [...ids.filter((x) => x !== threadId), threadId] : ids.filter((x) => x !== threadId)
    setState({ key, ids: next })
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* stockage indisponible */ }
  }
  return [ids, set] as const
}

/** Proposition de l'IA sur un fil : répondre, résoudre, ou les deux. Les anciennes analyses n'avaient pas `resolve`. */
const proposalOf = (item: FollowupItem) => ({ reply: item.reply.trim(), resolve: item.resolve ?? item.status === 'corrigé' })

function FollowupCard({ thread, item, text, onText, refused, applied, waiting, onRefuse, locked, me, project, wtId }: {
  thread: ReviewThread
  item?: FollowupItem
  text?: string
  onText: (v: string) => void
  refused: boolean
  /** J'ai déjà répondu dans le fil depuis l'analyse : la proposition est faite. */
  applied: boolean
  /** Fil en attente de l'auteur : pas de proposition, seulement de quoi ajouter un commentaire ou résoudre. */
  waiting?: boolean
  onRefuse: (v: boolean) => void
  /** « Tout approuver » en cours : pas d'action fil par fil en même temps. */
  locked: boolean
  me?: string | null
  project: string
  wtId: string
}) {
  const reply = useReplyThread(project, wtId)
  const toast = useToast()
  const proposal = item && proposalOf(item)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const refuse = onRefuse

  const send = (key: string, body: string, resolve: boolean) => {
    setBusy(key)
    reply.mutate({ threadId: thread.id, body, resolve }, {
      onSuccess: () => {
        setSent(true)
        toast(!body ? 'Fil résolu' : resolve ? 'Réponse postée et fil résolu' : 'Réponse postée')
      },
      onError: (e) => toast(e.message, true),
      onSettled: () => setBusy(null),
    })
  }
  const status = item && STATUS[item.status]
  const proposed = text ?? proposal?.reply ?? ''
  // Envoyé : masqué tout de suite, sans attendre le rechargement des fils (sinon un second clic poste un doublon).
  const done = applied || sent
  const showProposal = proposal && !refused && !done

  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <button type="button" className="min-w-0 text-left font-mono text-xs break-all hover:underline" onClick={() => go({ page: 'worktree', project, wt: wtId, tab: 'files' })}>
          {thread.path}{thread.line ? <span className="text-muted-foreground">:{thread.line}</span> : ''}
        </button>
        {thread.isOutdated && <Badge tone="gray">Code modifié à cet endroit</Badge>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {waiting ? <Badge tone="gray">En attente de l’auteur</Badge> : thread.awaitingReviewer ? <Badge tone="gray">Sans réponse</Badge> : <Badge tone="blue">Réponse de l’auteur</Badge>}
          {status && <Badge tone={status[1]}>{status[0]}</Badge>}
        </span>
      </div>
      <div className="px-4 py-3.5">
        <ThreadMessages thread={thread} me={me} />
      </div>

      {item && (
        <div className="flex flex-col gap-3 border-t border-dashed bg-muted/30 px-4 py-3.5 text-sm">
          <div className="flex items-start gap-2">
            <SparklesIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p>{item.explanation}</p>
          </div>
          {showProposal && (
            <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
              <span className="text-xs font-medium text-muted-foreground">
                Proposition : {!proposal.reply ? 'résoudre le fil sans répondre' : proposal.resolve ? 'répondre, puis résoudre le fil' : 'répondre, le fil reste ouvert pour l’auteur'}
              </span>
              {proposal.reply && <Textarea aria-label={`Réponse proposée sur ${thread.path}`} rows={2} value={proposed} onChange={(e) => onText(e.target.value)} />}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" disabled={locked || busy != null} onClick={() => refuse(true)}>Refuser</Button>
                <Button size="sm" disabled={locked || busy != null || (!!proposal.reply && !proposed.trim())} onClick={() => send('proposal', proposal.reply ? proposed : '', proposal.resolve)}>
                  {busy === 'proposal' && <Spinner />}
                  {!proposal.reply ? 'Approuver : résoudre' : proposal.resolve ? 'Approuver : répondre et résoudre' : 'Approuver : répondre'}
                </Button>
              </div>
            </div>
          )}
          {done && <span className="text-xs text-muted-foreground">Proposition appliquée : ta réponse est postée, le fil attend l’auteur.</span>}
          {refused && !done && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Proposition refusée.
              <Button variant="link" size="sm" className="h-6 px-0" onClick={() => refuse(false)}>La réafficher</Button>
            </span>
          )}
        </div>
      )}

      {/* Sans analyse, proposition refusée ou déjà appliquée : je réponds ou résous moi-même. */}
      {(!item || refused || done) && (
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <Textarea aria-label={`Réponse sur ${thread.path}`} rows={2} placeholder={waiting ? 'Ajouter un commentaire dans le fil' : 'Ta réponse dans le fil (facultatif pour résoudre)'} value={manual} onChange={(e) => setManual(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={locked || busy != null} onClick={() => send('resolve', '', true)}>{busy === 'resolve' && <Spinner />}Résoudre sans répondre</Button>
            <Button variant="outline" size="sm" disabled={locked || busy != null || !manual.trim()} onClick={() => send('reply', manual, false)}>{busy === 'reply' && <Spinner />}Répondre</Button>
            <Button size="sm" disabled={locked || busy != null || !manual.trim()} onClick={() => send('both', manual, true)}>{busy === 'both' && <Spinner />}Répondre et résoudre</Button>
          </div>
        </div>
      )}
    </article>
  )
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border bg-card px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
