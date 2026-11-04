import { CheckCheckIcon, CheckIcon, ChevronRightIcon, FileIcon, Link2Icon, PlayIcon, SparklesIcon, WrenchIcon } from 'lucide-react'
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
      {general.data && general.data.length > 0 && <GeneralComments comments={general.data} />}
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
      <BlockedCommit run={fixAll.run} />

      {open.length === 0 && <SuccessBox><span className="font-medium">Aucun commentaire à traiter sur cette PR.</span></SuccessBox>}
      {open.map((t) => <ThreadCard key={t.id} thread={t} audit={audits.get(t.id)} project={project.id} wtId={wtId} />)}

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
function GeneralComments({ comments }: { comments: GeneralComment[] }) {
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
        </div>
      ))}
    </details>
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

function ThreadCard({ thread, audit, project, wtId }: { thread: ReviewThread; audit?: CommentAudit; project: string; wtId: string }) {
  const fix = useAction<FixOutput>('comment-fix', { project, worktree: wtId, ref: thread.id }, { threadId: thread.id })
  const replyThread = useReplyThread(project, wtId)
  const dismiss = useDismissInbox()
  const toast = useToast()
  const [reply, setReply] = useState<string | null>(null)
  const posting = replyThread.isPending
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

  const postReply = () => replyThread.mutate({ threadId: thread.id, body: reply ?? audit?.reply ?? '', resolve: true }, {
    onSuccess: () => {
      toast('Réponse postée et fil résolu')
      if (fix.id) dismiss.mutate(fix.id)
    },
    onError: (e) => toast(e.message, true),
  })

  let state: [string, 'amber' | 'green' | 'gray' | 'blue'] = ['À traiter', 'amber']
  if (fix.running) state = ['Correction en cours', 'blue']
  if (done) state = ['Corrigé · DONE posté', 'green']
  if (blocked) state = ['Commit refusé · solution à valider', 'amber']
  if (ignored) state = ['Ignoré', 'gray']

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
      {!audit && !done && !ignored && !fix.busy && !blocked && (
        <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-4 py-2.5">
          {suggestion && (
            <Button size="sm" variant="outline" title="Remplace les lignes commentées par la suggestion, puis commite, pousse et répond DONE" onClick={() => fix.start({ action: APPLY_SUGGESTION(suggestion) })}>
              <CheckIcon />Appliquer la suggestion
            </Button>
          )}
          <Button size="sm" variant={suggestion ? 'ghost' : 'outline'} title="Fait ce que demande le reviewer, puis commite, pousse et répond DONE" onClick={() => fix.start({ action: AS_ASKED(first?.author) })}>
            <WrenchIcon />Corriger avec l’IA
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRefusing(!refusing)}>Répondre…</Button>
          <Button size="sm" variant="ghost" onClick={() => setIgnoredStored(true)}>Ignorer</Button>
        </div>
      )}
      {!audit && refusing && !done && !ignored && !fix.busy && (
        <div className="border-t px-4 py-3">
          <RefusePanel thread={thread} project={project} wtId={wtId} initialMode="reply"
            onFix={(instruction) => { setRefusing(false); void fix.start({ action: instruction }) }}
            onReplied={() => { setRefusing(false); if (fix.id) dismiss.mutate(fix.id) }}
            onIgnore={() => { setRefusing(false); setIgnoredStored(true) }}
            onCancel={() => setRefusing(false)} />
        </div>
      )}
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
          {audit.verdict === 'fix' && <p className="text-xs text-muted-foreground">Une fois corrigé, Shipyard commite, pousse, répond « DONE » avec le lien du commit et résout le fil.</p>}
          {!done && !ignored && !fix.busy && !blocked && (
            <div className="flex flex-wrap gap-2">
              {audit.verdict === 'fix'
                ? <Button size="sm" onClick={() => fix.start({ action: audit.action })}>Accepter : corriger et répondre DONE</Button>
                : <Button size="sm" disabled={posting} onClick={postReply}>{posting && <Spinner />}Accepter : répondre sans corriger</Button>}
              <Button variant="outline" size="sm" title="Fait ce que demande le reviewer, puis commite, pousse et répond DONE" onClick={() => fix.start({ action: AS_ASKED(first?.author) })}>
                <WrenchIcon />{audit.verdict === 'fix' ? 'Faire ce que demande le reviewer' : 'Corriger quand même'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRefusing(!refusing)}>Refuser…</Button>
            </div>
          )}
          {refusing && !done && !ignored && !fix.busy && (
            <RefusePanel thread={thread} project={project} wtId={wtId}
              onFix={(instruction) => { setRefusing(false); void fix.start({ action: instruction }) }}
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
          <p className="text-xs text-muted-foreground">Shipyard commite, pousse, répond « DONE » avec le lien du commit et résout le fil.</p>
          <div><Button size="sm" disabled={!instruction.trim()} onClick={() => onFix(instruction.trim())}>Corriger et répondre DONE</Button></div>
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
