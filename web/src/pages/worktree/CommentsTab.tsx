import { CheckCheckIcon, CheckIcon, ChevronRightIcon, FileIcon, LayersIcon, Link2Icon, PlayIcon, SparklesIcon, WrenchIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { GeneralComment, CommentAudit, CommentReplyOutput, CommentsFixAllOutput, CommentsOutput, FixOutput, ReviewThread } from '../../../../shared/types.ts'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDismissInbox, useReplyThread } from '../../data/mutations.ts'
import { useGeneralComments, useThreads } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Avatar, Badge, ErrorBox, PromptMenu, RunPanel, Spinner, SuccessBox, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'
import { Markdown, plain, suggestionOf } from '../../components/Markdown.tsx'

export function CommentsTab({ project, wtId }: TabProps) {
  const q = useThreads(project.id, wtId)
  const general = useGeneralComments(project.id, wtId)
  const analysis = useAction<CommentsOutput>('comments-analyze', { project: project.id, worktree: wtId })
  const fixAll = useAction<CommentsFixAllOutput>('comments-fix-all', { project: project.id, worktree: wtId, ref: 'fix-all' })
  // Pile : ce que j'ai validé commentaire par commentaire, avec mes exigences, traité ensuite en une fois.
  const pile = usePile(project.id, wtId, (q.data ?? []).filter((t) => !t.isResolved && !t.awaitingReviewer).map((t) => t.id))

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des commentaires…</div>
  if (!q.data) return <ErrorBox error={q.error} />
  const open = q.data.filter((t) => !t.isResolved && !t.awaitingReviewer)
  const awaiting = q.data.filter((t) => !t.isResolved && t.awaitingReviewer)
  const resolved = q.data.filter((t) => t.isResolved)
  const audits = new Map((analysis.result?.items ?? []).map((a) => [a.threadId, a]))
  // « Tout accepter » : ce que l'analyse propose, pour chaque fil encore ouvert que je n'ai pas écarté.
  const acceptable = open.filter((t) => audits.has(t.id) && !isIgnored(t.id)).map((t) => audits.get(t.id)!)
  const toFix = acceptable.filter((a) => a.verdict === 'fix').length
  // PR liée : les corrections qui touchent aussi l'autre dépôt, regroupées en tête pour ne rien casser de l'autre côté.
  const crossRepo = open.map((t) => ({ t, a: audits.get(t.id) })).filter((x) => x.a?.verdict === 'fix' && x.a.linkedImpact?.trim())
  const runPile = async () => {
    const id = await fixAll.start({ previousRunId: analysis.id, items: pile.items.map((i) => ({ threadId: i.threadId, verdict: i.verdict, action: i.verdict === 'fix' ? pileAction(i) : undefined, reply: i.reply })) })
    if (id) pile.clear()
  }
  const acceptAll = () => {
    const parts = [toFix && `${toFix} correction(s) par un seul agent, en un commit`, acceptable.length - toFix && `${acceptable.length - toFix} réponse(s) sans correction`].filter(Boolean).join(' et ')
    if (!confirm(`Tout accepter : ${parts} ?`)) return
    // previousRunId : l'agent reprend la session de l'analyse, il a déjà lu le code.
    void fixAll.start({ previousRunId: analysis.id, items: acceptable.map((a) => ({ threadId: a.threadId, verdict: a.verdict, action: a.action, reply: a.reply })) })
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Commentaires">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <Badge tone={open.length ? 'amber' : 'green'}>{open.length ? plural(open.length, 'commentaire à traiter', 'commentaires à traiter') : 'Aucun commentaire à traiter'}</Badge>
          {/* État de review et labels sont déjà affichés sous l'en-tête du worktree : pas de doublon ici. */}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {acceptable.length > 0 && !analysis.busy && (
            <Button size="sm" disabled={fixAll.busy} onClick={acceptAll} title="Applique l’action proposée par l’analyse sur chaque commentaire non écarté">
              {fixAll.busy ? <Spinner /> : <CheckCheckIcon />}Tout accepter ({acceptable.length})
            </Button>
          )}
          {open.length > 0 && (
            <Button size="sm" variant={acceptable.length ? 'outline' : 'default'} disabled={analysis.busy} onClick={() => analysis.start()}>
              {analysis.busy ? <Spinner /> : <PlayIcon />}{analysis.result ? 'Ré-analyser' : 'Analyser les commentaires'}
            </Button>
          )}
          <PromptMenu items={[['comments-analyze', 'Analyse des commentaires'], ['comment-fix', 'Correction d’un commentaire']]} />
        </span>
      </div>
      {general.data && general.data.length > 0 && <GeneralComments comments={general.data} project={project.id} wtId={wtId} />}
      <RunPanel id={analysis.id} events={analysis.events} running={analysis.running} run={analysis.run} label="Claude vérifie chaque commentaire dans le code" onStop={analysis.stop} action={analysis} />
      {crossRepo.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300"><Link2Icon className="size-4" />{plural(crossRepo.length, 'correction touche', 'corrections touchent')} aussi le projet lié</p>
          <ul className="flex flex-col gap-1.5">
            {crossRepo.map(({ t, a }) => (
              <li key={t.id}><span className="font-mono text-xs text-muted-foreground">{t.path}{t.line ? `:${t.line}` : ''}</span> · {a!.linkedImpact}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Le projet lié est modifié avec la correction, puis commité et poussé s’il n’avait pas de modifications en cours ; sinon, c’est à toi de le commiter.</p>
        </div>
      )}
      {fixAll.id && <RunPanel id={fixAll.id} events={fixAll.events} running={fixAll.running} run={fixAll.run} label="Tout accepter : réponses, puis un agent pour toutes les corrections" onStop={fixAll.stop} action={fixAll} defaultOpen />}
      {fixAll.result && !fixAll.busy && <FixAllRecap results={fixAll.result.results} threads={q.data} />}
      <BlockedCommit run={fixAll.run} />

      {open.length === 0 && <SuccessBox><span className="font-medium">Aucun commentaire à traiter sur cette PR.</span></SuccessBox>}
      {open.map((t) => <ThreadCard key={t.id} thread={t} audit={audits.get(t.id)} project={project.id} wtId={wtId} queued={pile.get(t.id)} onQueue={pile.add} onNote={(note) => pile.note(t.id, note)} onUnqueue={() => pile.remove(t.id)} />)}
      {pile.items.length > 0 && <PileBar items={pile.items} threads={open} busy={fixAll.busy} onRun={() => void runPile()} onRemove={pile.remove} onClear={pile.clear} />}

      {awaiting.length > 0 && (
        <Fold title={`Répondu, en attente du reviewer · ${awaiting.length}`}>
          {awaiting.map((t) => (
            <div key={t.id} className="flex flex-col gap-0.5 border-t py-2.5 text-sm">
              <span className="font-mono text-xs break-all text-muted-foreground">{t.path}{t.line ? `:${t.line}` : ''}</span>
              <p><span className="font-medium">{t.comments[0]?.author} :</span> {plain(t.comments[0]?.body ?? '')}</p>
              <p className="text-muted-foreground">Ta réponse : {plain(t.comments.at(-1)?.body ?? '')}</p>
            </div>
          ))}
        </Fold>
      )}
      {resolved.length > 0 && (
        <Fold title={`Déjà résolus · ${resolved.length}`}>
          {resolved.map((t) => (
            <div key={t.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t.comments[0]?.author}</span>
              <span className="font-mono text-xs break-all">{t.path}{t.line ? `:${t.line}` : ''}</span>
              <span className="min-w-0 flex-1">{plain(t.comments[0]?.body ?? '', 160)}</span>
            </div>
          ))}
        </Fold>
      )}
    </section>
  )
}

/** Section repliable (fils en attente ou résolus). */
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

const ignoredKey = (id: string) => `devpanel:thread-ignored:${id}`
const VERDICT: Record<string, { label: string; tone: 'green' | 'red' | 'gray' }> = {
  APPROVED: { label: 'a approuvé', tone: 'green' },
  CHANGES_REQUESTED: { label: 'demande des changements', tone: 'red' },
  COMMENTED: { label: 'a commenté', tone: 'gray' },
}

/**
 * Commentaires généraux de la PR : le texte d'une review ou de la conversation, attaché à aucune ligne.
 * C'est souvent là que le reviewer explique ses commentaires de ligne courts (« ici »). L'analyse et les corrections les lisent aussi.
 */
function GeneralComments({ comments, project, wtId }: { comments: GeneralComment[]; project: string; wtId: string }) {
  return (
    <details open className="group overflow-hidden rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        Commentaires généraux · {comments.length}
        <span className="font-normal text-muted-foreground">attachés à aucune ligne : le contexte des commentaires ci-dessous</span>
      </summary>
      {comments.map((g) => (
        <div key={g.url} className="flex flex-col gap-1.5 border-t px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar login={g.author} size="sm" />
            <span className="font-medium">{g.author}</span>
            {g.state && VERDICT[g.state] ? <Badge tone={VERDICT[g.state].tone}>{VERDICT[g.state].label}</Badge> : <Badge tone="gray">{g.kind === 'review' ? 'review' : 'conversation'}</Badge>}
            <a href={g.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-muted-foreground hover:underline">Voir sur GitHub ↗</a>
          </div>
          <Markdown text={g.body} />
          <GeneralFix comment={g} project={project} wtId={wtId} />
        </div>
      ))}
    </details>
  )
}

/**
 * « Appliquer à toute la PR » : un agent applique la remarque partout où elle vaut dans le code de la PR (pas seulement
 * la ligne pointée), puis Shipyard commite, pousse et répond « DONE <commit> » sous le commentaire, dans la conversation.
 */
function GeneralFix({ comment, project, wtId }: { comment: GeneralComment; project: string; wtId: string }) {
  const fix = useAction<FixOutput>('general-fix', { project, worktree: wtId, ref: comment.url }, { commentUrl: comment.url })
  const start = () => {
    if (!confirm(`Appliquer « ${comment.body.slice(0, 80)} » à tout le code de la PR ? L’IA modifie les fichiers, puis Shipyard commite, pousse et répond sur la PR.`)) return
    void fix.start()
  }
  return (
    <div className="flex flex-col gap-2">
      {!fix.busy && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={start} title="L’IA applique la remarque partout où elle vaut dans le code de la PR, puis commit, push et réponse DONE">
            <WrenchIcon />{fix.result ? 'Réappliquer à toute la PR' : 'Appliquer à toute la PR'}
          </Button>
          <PromptMenu items={[['general-fix', 'Appliquer un commentaire général']]} />
        </div>
      )}
      <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="L’IA applique la remarque à toute la PR" defaultOpen={fix.running} onStop={fix.stop} action={fix} />
      {fix.result && !fix.busy && <p className="text-sm text-muted-foreground">{fix.result.summary}</p>}
    </div>
  )
}

/** Récapitulatif du dernier traitement groupé : pour chaque commentaire, ce qui a été fait, ou pourquoi ça n'a pas abouti. */
function FixAllRecap({ results, threads }: { results: CommentsFixAllOutput['results']; threads: ReviewThread[] }) {
  const ok = results.filter((r) => r.ok).length
  const failed = results.length - ok
  // Les échecs d'abord : c'est ce qui reste à reprendre.
  const sorted = [...results].sort((a, b) => Number(a.ok) - Number(b.ok))
  return (
    <details open className="group overflow-hidden rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        Récapitulatif · {plural(ok, 'commentaire traité', 'commentaires traités')}
        {failed > 0 && <Badge tone="red">{plural(failed, 'échec', 'échecs')}</Badge>}
      </summary>
      <ul className="flex flex-col border-t">
        {sorted.map((r) => {
          const t = threads.find((x) => x.id === r.threadId)
          return (
            <li key={r.threadId} className="flex flex-col gap-1 border-b px-4 py-2.5 text-sm last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={!r.ok ? 'red' : r.verdict === 'fix' ? 'green' : 'gray'}>{!r.ok ? 'Échec' : r.verdict === 'fix' ? 'Corrigé' : 'Répondu'}</Badge>
                <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">{t ? `${t.path}${t.line ? `:${t.line}` : ''}` : 'Fil introuvable'}</span>
              </div>
              {t?.comments[0] && <p className="text-muted-foreground"><span className="font-medium">{t.comments[0].author} :</span> {plain(t.comments[0].body, 160)}</p>}
              <p className={r.ok ? undefined : 'text-destructive'}>{r.detail}</p>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** Un commentaire validé, en attente dans la pile : ce qui sera fait, et mes exigences en plus pour ce commentaire. */
interface PileItem {
  threadId: string
  verdict: 'fix' | 'skip'
  /** Ce qui a été validé, affiché dans la pile (ex. « Correction proposée par l’analyse »). */
  how: string
  /** Correction : la consigne donnée à l'agent. */
  action?: string
  /** Sans correction : la réponse postée. */
  reply?: string
  /** Mes exigences en plus pour ce commentaire, ajoutées à la consigne. */
  note?: string
}

/** Consigne finale d'une correction de la pile : ce qui a été validé, puis mes exigences. */
const pileAction = (i: PileItem) =>
  [i.action ?? 'apply the comment', i.note?.trim() ? `The user's additional requirements for this comment, which win over the rest: ${i.note.trim()}` : ''].filter(Boolean).join('\n\n')

/** Pile du worktree, gardée dans ce navigateur. Les fils qui ne sont plus à traiter en sortent d'eux-mêmes. */
function usePile(project: string, wtId: string, openIds: string[]) {
  const key = `shipyard:comment-pile:${project}:${wtId}`
  const [items, setItems] = useState<PileItem[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(v) ? (v as PileItem[]) : []
    } catch {
      return []
    }
  })
  const save = (next: PileItem[]) => {
    setItems(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* stockage indisponible */ }
  }
  const shown = items.filter((i) => openIds.includes(i.threadId))
  return {
    items: shown,
    get: (id: string) => shown.find((i) => i.threadId === id),
    add: (item: PileItem) => save([...items.filter((i) => i.threadId !== item.threadId), item]),
    note: (id: string, note: string) => save(items.map((i) => (i.threadId === id ? { ...i, note } : i))),
    remove: (id: string) => save(items.filter((i) => i.threadId !== id)),
    clear: () => save([]),
  }
}

/** La pile, en bas de la liste et toujours visible : ce qui attend, puis un seul agent et un seul commit pour toutes les corrections. */
function PileBar({ items, threads, busy, onRun, onRemove, onClear }: { items: PileItem[]; threads: ReviewThread[]; busy: boolean; onRun: () => void; onRemove: (id: string) => void; onClear: () => void }) {
  const fixes = items.filter((i) => i.verdict === 'fix').length
  const replies = items.length - fixes
  const summary = [fixes && `${plural(fixes, 'correction', 'corrections')} par un seul agent, en un commit`, replies && `${plural(replies, 'réponse', 'réponses')} sans correction`].filter(Boolean).join(' · ')
  return (
    <div className="sticky bottom-[88px] z-20 flex flex-col gap-3 rounded-xl border border-primary/50 bg-card p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold"><LayersIcon className="size-4" />Pile · {plural(items.length, 'commentaire validé', 'commentaires validés')}</p>
          <p className="text-sm text-muted-foreground">{summary}. Rien n’est lancé tant que tu n’as pas traité la pile.</p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={onRun}>{busy ? <Spinner /> : <PlayIcon />}Traiter la pile ({items.length})</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>Vider</Button>
        </span>
      </div>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
        {items.map((i) => {
          const t = threads.find((x) => x.id === i.threadId)
          return (
            <li key={i.threadId} className="flex items-start gap-2 border-t pt-1.5">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-xs break-all text-muted-foreground">{t?.path}{t?.line ? `:${t.line}` : ''}</span>
                <span className="ml-2">{i.how}</span>
                {i.note?.trim() && <p className="text-xs text-muted-foreground">Exigence : {i.note.trim()}</p>}
              </div>
              <Button size="icon-sm" variant="ghost" className="size-6 shrink-0" aria-label="Retirer de la pile" onClick={() => onRemove(i.threadId)}><XIcon /></Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function isIgnored(id: string) {
  try {
    return localStorage.getItem(ignoredKey(id)) === '1'
  } catch {
    return false
  }
}

/** Suggestion GitHub du reviewer : la recopier telle quelle, sans réinterpréter. */
const APPLY_SUGGESTION = (code: string) =>
  `Apply the reviewer's suggestion as is: replace the commented lines with exactly this code, without changing anything else.\n\n\`\`\`\n${code}\n\`\`\``

/** Raccourci : passer outre l'audit et faire ce que le reviewer demande, puis répondre DONE comme d'habitude. */
const AS_ASKED = (author: string | undefined) =>
  `Do exactly what ${author ?? 'the reviewer'} asks in their comment, as they worded it, even if the audit judged it unnecessary or suggested something else: the user has decided. If the request is ambiguous, pick the most literal interpretation.`

function ThreadCard({ thread, audit, project, wtId, queued, onQueue, onNote, onUnqueue }: {
  thread: ReviewThread
  audit?: CommentAudit
  project: string
  wtId: string
  /** Ce commentaire est dans la pile : ce qui a été validé. */
  queued?: PileItem
  onQueue: (item: PileItem) => void
  onNote: (note: string) => void
  onUnqueue: () => void
}) {
  const fix = useAction<FixOutput>('comment-fix', { project, worktree: wtId, ref: thread.id }, { threadId: thread.id })
  const dismiss = useDismissInbox()
  const [reply, setReply] = useState<string | null>(null)
  const [ignored, setIgnored] = useState(() => isIgnored(thread.id))
  const setIgnoredStored = (v: boolean) => {
    setIgnored(v)
    try {
      if (v) localStorage.setItem(ignoredKey(thread.id), '1')
      else localStorage.removeItem(ignoredKey(thread.id))
    } catch { /* stockage indisponible */ }
  }
  // Refus : corriger autrement, répondre sans corriger, ou ignorer.
  const [refusing, setRefusing] = useState(false)
  const first = thread.comments[0]
  const suggestion = first ? suggestionOf(first.body) : null
  const done = fix.run?.status === 'success'
  // Correction faite mais commit refusé par un hook : elle attend une solution (voir BlockedCommit), pas une nouvelle correction.
  const blocked = !!fix.run?.blockedCommit && !fix.run.blockedCommit.resolvedBy

  // Valider met dans la pile : rien ne part avant « Traiter la pile ».
  const queueFix = (how: string, action: string) => { setRefusing(false); onQueue({ threadId: thread.id, verdict: 'fix', how, action }) }
  const queueReply = () => onQueue({ threadId: thread.id, verdict: 'skip', how: 'Réponse sans correction', reply: reply ?? audit?.reply ?? '' })
  const active = !done && !ignored && !fix.busy && !blocked && !queued

  let state: [string, 'amber' | 'green' | 'gray' | 'blue'] = ['À traiter', 'amber']
  if (fix.running) state = ['Correction en cours', 'blue']
  if (done) state = ['Corrigé · DONE posté', 'green']
  if (blocked) state = ['Commit refusé · solution à valider', 'amber']
  if (ignored) state = ['Ignoré', 'gray']
  if (queued) state = ['Dans la pile', 'blue']

  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <button type="button" className="min-w-0 text-left font-mono text-xs break-all hover:underline" onClick={() => go({ page: 'worktree', project, wt: wtId, tab: 'files' })}>
          {thread.path}{thread.line ? <span className="text-muted-foreground">:{thread.line}</span> : ''}
        </button>
        {thread.isOutdated && <Badge tone="gray">ligne modifiée depuis</Badge>}
        <Badge tone={state[1]} className="ml-auto">{state[0]}</Badge>
      </div>
      <div className="flex gap-3 px-4 py-3.5">
        <Avatar login={first?.author} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm leading-relaxed">
          <span className="font-medium">{first?.author}</span>
          {thread.comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              {c !== first && <span className="text-xs text-muted-foreground">{c.author}</span>}
              <Markdown text={c.body} code={c === first ? thread.code : undefined} />
            </div>
          ))}
        </div>
      </div>
      {/* Sans analyse : les actions se font fil par fil, directement. */}
      {!audit && active && (
        <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-4 py-2.5">
          {suggestion && (
            <Button size="sm" variant="outline" title="Met dans la pile : remplacer les lignes commentées par la suggestion" onClick={() => queueFix('Suggestion du reviewer, telle quelle', APPLY_SUGGESTION(suggestion))}>
              <CheckIcon />Appliquer la suggestion
            </Button>
          )}
          <Button size="sm" variant={suggestion ? 'ghost' : 'outline'} title="Met dans la pile : faire ce que demande le reviewer" onClick={() => queueFix('Ce que demande le reviewer', AS_ASKED(first?.author))}>
            <WrenchIcon />Corriger avec l’IA
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRefusing(!refusing)}>Répondre…</Button>
          <Button size="sm" variant="ghost" onClick={() => setIgnoredStored(true)}>Ignorer</Button>
        </div>
      )}
      {!audit && refusing && active && (
        <div className="border-t px-4 py-3">
          <RefusePanel thread={thread} project={project} wtId={wtId} initialMode="reply"
            onFix={(instruction) => queueFix('Ta consigne', instruction)}
            onReplied={() => { setRefusing(false); if (fix.id) dismiss.mutate(fix.id) }}
            onIgnore={() => { setRefusing(false); setIgnoredStored(true) }}
            onCancel={() => setRefusing(false)} />
        </div>
      )}
      {!audit && queued && <div className="border-t px-4 py-3"><QueuedNote item={queued} onNote={onNote} onUnqueue={onUnqueue} /></div>}
      {!audit && (fix.id || ignored) && (
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          {ignored && <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={() => setIgnoredStored(false)}>Annuler « Ignorer »</Button>}
          <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit, push et réponse" onStop={fix.stop} action={fix} />
          <BlockedCommit run={fix.run} />
        </div>
      )}
      {audit && (
        <div className="flex flex-col gap-3 border-t border-dashed bg-muted/30 px-4 py-4 text-sm">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Audit de l’IA</span>
            <Badge tone={audit.verdict === 'fix' ? 'red' : 'gray'}>{audit.verdict === 'fix' ? 'À corriger' : 'Pas nécessaire'}</Badge>
          </div>
          <p>{audit.audit}</p>
          <p><span className="font-medium">Action proposée : </span>{audit.action}</p>
          {audit.verdict === 'fix' && audit.linkedImpact?.trim() && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"><span className="font-medium text-amber-800 dark:text-amber-300">Projet lié : </span>{audit.linkedImpact}</p>
          )}
          {audit.verdict === 'skip' && (
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor={`r-${thread.id}`}>Réponse qui sera postée</FieldLabel>
              <Textarea id={`r-${thread.id}`} rows={3} className="bg-background" value={reply ?? audit.reply} onChange={(e) => setReply(e.target.value)} />
            </div>
          )}
          {audit.verdict === 'fix' && <p className="text-xs text-muted-foreground">Accepter met le commentaire dans la pile. Quand tu la traites, un seul agent fait toutes les corrections, puis Shipyard commite, pousse, répond « DONE » avec le lien du commit et résout chaque fil.</p>}
          {active && (
            <div className="flex flex-wrap gap-2">
              {audit.verdict === 'fix'
                ? <Button size="sm" onClick={() => queueFix('Correction proposée par l’analyse', audit.action)}><LayersIcon />Accepter : mettre dans la pile</Button>
                : <Button size="sm" onClick={queueReply}><LayersIcon />Accepter : répondre sans corriger</Button>}
              <Button variant="outline" size="sm" title="Met dans la pile : faire ce que demande le reviewer, tel qu’il l’a écrit" onClick={() => queueFix('Ce que demande le reviewer', AS_ASKED(first?.author))}>
                <WrenchIcon />{audit.verdict === 'fix' ? 'Faire ce que demande le reviewer' : 'Corriger quand même'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRefusing(!refusing)}>Refuser…</Button>
            </div>
          )}
          {queued && <QueuedNote item={queued} onNote={onNote} onUnqueue={onUnqueue} />}
          {refusing && active && (
            <RefusePanel thread={thread} project={project} wtId={wtId}
              onFix={(instruction) => queueFix('Ta consigne', instruction)}
              onReplied={() => { setRefusing(false); if (fix.id) dismiss.mutate(fix.id) }}
              onIgnore={() => { setRefusing(false); setIgnoredStored(true) }}
              onCancel={() => setRefusing(false)} />
          )}
          {ignored && <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={() => setIgnoredStored(false)}>Annuler le refus</Button>}
          <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit, push et réponse" onStop={fix.stop} action={fix} />
          <BlockedCommit run={fix.run} />
        </div>
      )}
    </article>
  )
}

/** Commentaire dans la pile : ce qui a été validé, et mes exigences en plus pour celui-ci, données à l'agent avec la correction. */
function QueuedNote({ item, onNote, onUnqueue }: { item: PileItem; onNote: (note: string) => void; onUnqueue: () => void }) {
  const id = `pile-note-${item.threadId}`
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-background p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm"><LayersIcon className="size-4 text-muted-foreground" /><span className="font-medium">Dans la pile :</span> {item.how}</p>
      {item.verdict === 'fix' ? (
        <>
          <FieldLabel htmlFor={id}>Tes exigences pour ce commentaire <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
          <Textarea id={id} rows={2} value={item.note ?? ''} onChange={(e) => onNote(e.target.value)}
            placeholder="Ex. : sans toucher au composant parent · réutilise le helper existant · ajoute le test du cas vide." />
        </>
      ) : <p className="text-sm text-muted-foreground whitespace-pre-line">{item.reply}</p>}
      <div><Button size="sm" variant="ghost" onClick={onUnqueue}>Retirer de la pile</Button></div>
    </div>
  )
}

/**
 * Refuser l'action proposée, en disant à l'IA quoi faire à la place :
 * corriger autrement (puis DONE), répondre sans corriger (réponse rédigée par l'IA à partir de mon intention), ou ignorer.
 */
function RefusePanel({ thread, project, wtId, initialMode = 'fix', onFix, onReplied, onIgnore, onCancel }: {
  thread: ReviewThread
  initialMode?: 'fix' | 'reply'
  project: string
  wtId: string
  onFix: (instruction: string) => void
  onReplied: () => void
  onIgnore: () => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'fix' | 'reply'>(initialMode)
  const [instruction, setInstruction] = useState('')
  const [intent, setIntent] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [resolve, setResolve] = useState(false)
  const writer = useAction<CommentReplyOutput>('comment-reply', { project, worktree: wtId, ref: thread.id }, { threadId: thread.id })
  const replyThread = useReplyThread(project, wtId)
  const toast = useToast()
  const text = draft ?? writer.result?.reply ?? ''
  const id = `refuse-${thread.id}`

  const post = () => replyThread.mutate({ threadId: thread.id, body: text, resolve }, {
    onSuccess: () => {
      toast(resolve ? 'Réponse postée et fil résolu' : 'Réponse postée, fil laissé ouvert pour le reviewer')
      onReplied()
    },
    onError: (e) => toast(e.message, true),
  })

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={mode === 'fix' ? 'default' : 'outline'} onClick={() => setMode('fix')}>Corriger autrement</Button>
        <Button size="sm" variant={mode === 'reply' ? 'default' : 'outline'} onClick={() => setMode('reply')}>Ne pas corriger : répondre</Button>
        <Button size="sm" variant="ghost" onClick={onIgnore}>Ignorer</Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>Annuler</Button>
      </div>

      {mode === 'fix' ? (
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={`${id}-fix`}>Ce que l’IA doit corriger</FieldLabel>
          <Textarea id={`${id}-fix`} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder="Ex. : garde le composant tel quel, mais renomme la prop en `onDone` · corrige seulement le cas vide, pas le reste." />
          <p className="text-xs text-muted-foreground">Le commentaire part dans la pile avec cette consigne : il est corrigé avec les autres quand tu la traites.</p>
          <div><Button size="sm" disabled={!instruction.trim()} onClick={() => onFix(instruction.trim())}><LayersIcon />Mettre dans la pile</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={`${id}-intent`}>Ce que tu veux répondre, en vrac</FieldLabel>
          <Textarea id={`${id}-intent`} rows={2} value={intent} onChange={(e) => setIntent(e.target.value)}
            placeholder="Ex. : volontaire, le parent gère déjà l’erreur ; on le traite dans le ticket ENG-1700." />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!intent.trim() || writer.busy} onClick={() => { setDraft(null); void writer.start({ extra: intent }) }}>
              {writer.busy ? <Spinner /> : <SparklesIcon />}Rédiger avec l’IA
            </Button>
            <Button size="sm" variant="ghost" disabled={!intent.trim()} onClick={() => setDraft(intent)}>Utiliser tel quel</Button>
          </div>
          {(text || writer.busy) && (
            <>
              <FieldLabel htmlFor={`${id}-reply`}>Réponse qui sera postée</FieldLabel>
              <Textarea id={`${id}-reply`} rows={3} value={text} disabled={writer.busy} onChange={(e) => setDraft(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={resolve} onCheckedChange={(v) => setResolve(v === true)} />Résoudre le fil (sinon il reste ouvert pour le reviewer)
              </label>
              <div><Button size="sm" disabled={!text.trim() || replyThread.isPending || writer.busy} onClick={post}>{replyThread.isPending && <Spinner />}Poster la réponse</Button></div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
