import { ChevronRightIcon, ExternalLinkIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { PrReviewOutput, ReviewComment, ReviewDecisions, ReviewEvent } from '../../../../shared/types.ts'
import { Diff, DiffRow, DiffStat } from '@/components/Diff'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAddPendingComments, useDiscardPendingReview, useRemovePendingComment, useSaveReviewDecisions, useSubmitReview } from '../../data/mutations.ts'
import { useHealth, usePendingReview, usePrFiles, useReviewDecisions, useThreads } from '../../data/queries.ts'
import { PriorThread } from '../../components/Thread.tsx'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Badge, Pill, PromptMenu, RunPanel, Spinner, SuccessBox, plural, sevLabel, sevTone, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

const EMPTY: ReviewDecisions = { approved: [], ignored: [], dropped: [], text: {}, line: {}, posted: {}, failed: {}, summary: null, published: null }

/**
 * Tri de la review, enregistré par le serveur dans un JSON par run : chaque clic est instantané
 * et survit à un rechargement. Rien ne part sur GitHub avant « Ajouter à la review GitHub ».
 */
function useDecisions(runId: string | null): [ReviewDecisions, (patch: Partial<ReviewDecisions>) => void] {
  const toast = useToast()
  const q = useReviewDecisions(runId)
  const save = useSaveReviewDecisions(runId, EMPTY)
  return [{ ...EMPTY, ...q.data }, (patch) => save.update(patch, (e) => toast(`Tri non enregistré : ${e.message}`, true))]
}

/** Ordre de l'onglet « Changes » de GitHub : à chaque niveau, les dossiers puis les fichiers, sans tenir compte de la casse. */
function treeOrder(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  for (let i = 0; ; i++) {
    if (x[i] === y[i]) {
      if (x[i] === undefined) return 0
      continue
    }
    const da = i < x.length - 1
    const db = i < y.length - 1
    if (da !== db) return da ? -1 : 1
    return x[i].localeCompare(y[i], 'en', { sensitivity: 'base', numeric: true }) || (x[i] < y[i] ? -1 : 1)
  }
}

const EVENTS = [['COMMENT', 'Commenter'], ['REQUEST_CHANGES', 'Demander des modifications'], ['APPROVE', 'Approuver la PR']] as const
const FOLLOW_UP: Record<NonNullable<ReviewComment['followUp']>, string> = { partiel: 'Corrigé en partie', 'non-corrigé': 'Non corrigé', 'à-trancher': 'À trancher' }

/** Un emplacement où poster : le commentaire principal, ou un autre emplacement d'un motif récurrent. */
interface Target {
  key: string
  comment: ReviewComment
  path: string
  line: number
  body: string
  threadId: string | null
  /** Ligne recalée ou hors du diff (contrôle du serveur), tant que je ne l'ai pas corrigée. */
  warning: string | null
}

export function ReviewTab({ project, detail, wtId }: TabProps) {
  const pr = detail.pr!
  const review = useAction<PrReviewOutput>('review', { project: project.id, worktree: wtId })
  const files = usePrFiles(project.id, wtId)
  const threads = useThreads(project.id, wtId)
  const me = useHealth().data?.github
  const threadById = (id: string | null | undefined) => (id ? threads.data?.find((t) => t.id === id) : undefined)
  const pending = usePendingReview(project.id, wtId, !!review.result)
  const [s, set] = useDecisions(review.run?.status === 'success' ? review.id : null)
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [removing, setRemoving] = useState<string | null>(null)
  const addPending = useAddPendingComments(project.id, wtId)
  const removePending = useRemovePendingComment(project.id, wtId)
  const discard = useDiscardPendingReview(project.id, wtId)
  const submitReview = useSubmitReview(project.id, wtId)
  // Action en cours : 'post', 'submit' ou la clé de l'emplacement retiré.
  const busy = addPending.isPending ? 'post' : submitReview.isPending ? 'submit' : removePending.isPending ? removing : null
  const toast = useToast()

  const out = review.result
  // CI rouge ou en cours : l'approbation reste possible mais signalée ; par défaut, la PR part en « Demander des modifications ».
  const ciOk = pr.ci.state === 'pass' || pr.ci.state === 'none'
  const failingJobs = pr.ci.jobs.filter((j) => j.state === 'fail').map((j) => j.name)
  const ciNote = pr.ci.state === 'fail' ? `La CI ne passe pas (${failingJobs.join(', ')}) : à corriger.` : null
  const defaultSummary = out ? [ciNote, out.summary].filter(Boolean).join('\n\n') : ''
  useEffect(() => {
    if (out) setEvent(pr.ci.state === 'fail' ? 'REQUEST_CHANGES' : out.verdict === 'APPROVE' && !ciOk ? 'COMMENT' : out.verdict ?? 'COMMENT')
  }, [review.id, pr.ci.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const comments = [...(out?.comments ?? []), ...(s.extra ?? [])].sort((a, b) => treeOrder(a.file, b.file) || a.line - b.line)
  const targetsOf = (c: ReviewComment): Target[] => [
    { key: c.id, comment: c, path: c.file, line: s.line[c.id] ?? c.line, body: s.text[c.id] ?? c.body, threadId: c.threadId, warning: s.line[c.id] ? null : c.lineWarning ?? null },
    ...(c.also ?? []).map((a, i) => {
      const key = `${c.id}#${i}`
      return { key, comment: c, path: a.file, line: s.line[key] ?? a.line, body: s.text[key] ?? a.body, threadId: null, warning: s.line[key] ? null : a.lineWarning ?? null }
    }),
  ]

  // GitHub fait foi : un commentaire retiré de la review en attente depuis GitHub n'est plus compté comme posté.
  const pendingIds = new Set(pending.data?.comments.map((c) => c.id) ?? [])
  const isPosted = (key: string) => !!s.posted[key] && (pending.data === undefined || pendingIds.has(s.posted[key]))
  const approvedTargets = comments.filter((c) => s.approved.includes(c.id)).flatMap(targetsOf).filter((t) => !s.dropped.includes(t.key))
  const posted = comments.flatMap(targetsOf).filter((t) => isPosted(t.key))
  const failed = approvedTargets.filter((t) => !isPosted(t.key) && s.failed[t.key])
  const waiting = approvedTargets.filter((t) => !isPosted(t.key) && !s.failed[t.key])
  const waitingComments = comments.filter((c) => waiting.some((t) => t.comment === c))
  const todo = comments.filter((c) => !s.ignored.includes(c.id) && !s.approved.includes(c.id))
  const ignored = comments.filter((c) => s.ignored.includes(c.id))
  /** Commentaires de ma review en attente ajoutés à la main sur GitHub, hors Shipyard. */
  const githubOnly = (pending.data?.comments.length ?? 0) - posted.length
  const pendingTotal = pending.data?.comments.length ?? 0

  const setText = (key: string, value: string) => set({ text: { ...s.text, [key]: value } })
  const decide = (c: ReviewComment, to: 'approved' | 'ignored' | null) => set({
    approved: to === 'approved' ? [...s.approved, c.id] : s.approved.filter((x) => x !== c.id),
    ignored: to === 'ignored' ? [...s.ignored, c.id] : s.ignored.filter((x) => x !== c.id),
  })

  /** Ajoute des emplacements à ma review en attente sur GitHub, sans l'envoyer. */
  const post = (targets: Target[]) => addPending.mutate(targets.map(({ key, path, line, body, threadId }) => ({ key, path, line, body, threadId })), {
    onSuccess: ({ results }) => {
      const nextPosted = { ...s.posted }
      const nextFailed = { ...s.failed }
      for (const r of results) {
        if (r.commentId) {
          nextPosted[r.key] = r.commentId
          delete nextFailed[r.key]
        } else nextFailed[r.key] = r.error ?? 'refusé par GitHub'
      }
      set({ posted: nextPosted, failed: nextFailed })
      const ko = results.filter((r) => !r.commentId).length
      toast(ko ? `${plural(results.length - ko, 'commentaire ajouté', 'commentaires ajoutés')}, ${ko} refusé(s) : voir « Non passés »` : `${plural(results.length, 'commentaire ajouté', 'commentaires ajoutés')} à la review en attente`, ko > 0)
    },
    onError: (e) => toast(e.message, true),
  })

  /** Retire un emplacement de ma review en attente : il redevient modifiable dans « Approuvés ». */
  const unpost = (t: Target) => {
    setRemoving(t.key)
    removePending.mutate(s.posted[t.key], {
      onSuccess: () => {
        const next = { ...s.posted }
        delete next[t.key]
        set({ posted: next })
      },
      onError: (e) => toast(e.message, true),
    })
  }

  const submit = () => submitReview.mutate({ event, body: s.summary ?? defaultSummary }, {
    onSuccess: (res) => {
      set({ published: res.url })
      const l = res.labels
      const labels = [l?.added.length && `ajouté : ${l.added.join(', ')}`, l?.removed.length && `retiré : ${l.removed.join(', ')}`].filter(Boolean).join(' · ')
      toast(`Review envoyée sur GitHub${labels ? ` · labels ${labels}` : ''}`)
    },
    onError: (e) => toast(e.message, true),
  })

  const discardPending = () => {
    if (!confirm(`Supprimer ta review en attente sur GitHub et ses ${pendingTotal} commentaire(s) ?`)) return
    discard.mutate(undefined, { onSuccess: () => set({ posted: {} }), onError: (e) => toast(e.message, true) })
  }

  // Extrait de code autour de la ligne commentée.
  const snippet = (c: ReviewComment) => {
    const lines = (files.data?.files.find((f) => f.path === c.file)?.lines ?? []).filter((l) => l.t !== '@')
    const at = lines.findIndex((l) => l.n === c.line)
    return at < 0 ? [] : lines.slice(Math.max(0, at - 3), at + 2)
  }

  const location = (c: ReviewComment) => (
    <button type="button" className="min-w-0 text-left font-mono text-xs break-all hover:underline" onClick={() => go({ page: 'worktree', project: project.id, wt: wtId, tab: 'files' })}>{c.file}:{c.line}</button>
  )

  const isDropped = (key: string) => s.dropped.includes(key)
  const toggleDrop = (key: string) => set({ dropped: isDropped(key) ? s.dropped.filter((k) => k !== key) : [...s.dropped, key] })

  /** Fichier et ligne d'un emplacement ; la ligne devient modifiable quand elle pose problème. Avec drop, l'emplacement peut être ignoré seul. */
  const lineRow = (t: Target, opts: { line?: boolean; drop?: boolean } = {}) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs break-all text-muted-foreground">{t.path}:</span>
      {opts.line || t.warning || s.line[t.key]
        ? <Input aria-label={`Ligne pour ${t.path}`} className="h-7 w-24 font-mono text-xs" type="number" min={1} value={t.line} onChange={(e) => set({ line: { ...s.line, [t.key]: Number(e.target.value) } })} />
        : <span className="-ml-2 font-mono text-xs text-muted-foreground">{t.line}</span>}
      {t.warning && <Badge tone={t.warning.startsWith('Ligne recalée') ? 'gray' : 'amber'}>{t.warning}</Badge>}
      {opts.drop && isDropped(t.key) && <Badge tone="gray">Ignoré</Badge>}
      {opts.drop && (
        <Button variant="link" size="sm" className="ml-auto h-7 px-0" onClick={() => toggleDrop(t.key)}>
          {isDropped(t.key) ? 'Réintégrer' : 'Ignorer cet emplacement'}
        </Button>
      )}
    </div>
  )

  /** Emplacement modifiable : texte, et ligne quand elle pose problème. */
  const editor = (t: Target, opts: { line?: boolean; drop?: boolean } = {}) => (
    <div key={t.key} className={cn('flex flex-col gap-1.5', opts.drop && isDropped(t.key) && 'opacity-50')}>
      {lineRow(t, opts)}
      {!(opts.drop && isDropped(t.key)) && (
        <Textarea aria-label={`Commentaire sur ${t.path}:${t.line}`} rows={2} className="bg-background" value={t.body} onChange={(e) => setText(t.key, e.target.value)} />
      )}
    </div>
  )

  return (
    <section className="flex flex-col gap-4" aria-label="Review">
      <Card className="flex-row flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 basis-80">
          <p className="font-semibold">{pr.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            par {pr.author} · <DiffStat add={pr.additions} del={pr.deletions} /> · {plural(pr.changedFiles, 'fichier', 'fichiers')}
          </p>
          {!out && <p className="mt-2 text-sm text-muted-foreground">Claude relit le diff avec les règles du dépôt. Si tu as déjà commenté la PR, il fait une re-review : suivi de tes commentaires et seuls les fichiers modifiés depuis. Tu tries les commentaires sans attente, tu les ajoutes à ta review en attente sur GitHub, puis tu l’envoies quand tout est passé.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PromptMenu items={[['review', 'Review d’une PR']]} />
          <Button size="sm" disabled={review.busy} onClick={() => review.start()}>
            {review.busy ? <Spinner /> : <PlayIcon />}{out ? 'Relancer la review' : 'Lancer la review'}
          </Button>
        </div>
      </Card>
      <RunPanel id={review.id} events={review.events} running={review.running} run={review.run} label="Review du diff" onStop={review.stop} action={review} />

      {s.published && (
        <SuccessBox>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Review envoyée sur GitHub.</span>
            <a href={s.published} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">Voir sur GitHub<ExternalLinkIcon className="size-3.5" /></a>
          </span>
        </SuccessBox>
      )}

      {out && !s.published && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="purple">{out.mode === 're-review' ? 'Re-review' : 'Review'}</Badge>
            {out.mode === 're-review' && <Badge tone="green">{plural(out.fixedThreads?.length ?? 0, 'commentaire précédent corrigé', 'commentaires précédents corrigés')}</Badge>}
            <span className="text-sm text-muted-foreground">
              {todo.length} à trier · {plural(s.approved.length, 'approuvé', 'approuvés')} · {plural(ignored.length, 'ignoré', 'ignorés')} · {posted.length} sur GitHub{failed.length ? ` · ${failed.length} non passé(s)` : ''}
            </span>
          </div>

          {comments.length === 0 && <SuccessBox>Aucun commentaire : la PR semble prête.</SuccessBox>}

          {todo.map((c) => {
            const lines = snippet(c)
            const [main, ...others] = targetsOf(c)
            const kept = [main, ...others].filter((t) => !isDropped(t.key)).length
            return (
              <article key={c.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                  {location(c)}
                  <Badge tone={sevTone[c.severity]}>{sevLabel[c.severity]}</Badge>
                  {c.followUp && <Badge tone="gray">Réponse · {FOLLOW_UP[c.followUp]}</Badge>}
                  {c.pattern && <Badge tone="purple">Motif récurrent · {c.pattern} · {plural(others.length + 1, 'emplacement', 'emplacements')}</Badge>}
                  {threadById(c.relatedThreadId) && <Badge tone="amber">Déjà discuté</Badge>}
                </div>
                <div className="flex flex-col gap-3 px-4 py-3.5">
                  {lines.length > 0 && (
                    <Diff className="overflow-hidden rounded-lg border py-1">
                      {lines.map((l, i) => <DiffRow key={i} line={l} nums={[l.n ?? l.o]} highlight={l.n === c.line} />)}
                    </Diff>
                  )}
                  {threadById(c.threadId) && <PriorThread thread={threadById(c.threadId)!} me={me} title="Ton commentaire précédent et la réponse de l’auteur" />}
                  {threadById(c.relatedThreadId) && <PriorThread thread={threadById(c.relatedThreadId)!} me={me} title="Déjà discuté : relis l’échange avant d’approuver" />}
                  {(main.warning || s.line[c.id] || others.length > 0) && lineRow(main, { drop: others.length > 0 })}
                  {!isDropped(main.key) && <Textarea aria-label={`Commentaire sur ${c.file}:${c.line}`} rows={3} value={main.body} onChange={(e) => setText(c.id, e.target.value)} />}
                  {others.length > 0 && (
                    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
                      <span className="text-sm font-medium">
                        Même problème à {plural(others.length, 'autre endroit', 'autres endroits')} : un commentaire sera posté sur chacun, sauf ceux que tu ignores
                      </span>
                      {others.map((t) => editor(t, { drop: true }))}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => decide(c, 'ignored')}>Ignorer</Button>
                    <Button size="sm" disabled={kept === 0 || (!isDropped(main.key) && !main.body.trim())} onClick={() => decide(c, 'approved')}>{others.length ? `Approuver les ${kept}` : 'Approuver'}</Button>
                  </div>
                </div>
              </article>
            )
          })}

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Approuvés, à ajouter</CardTitle>
              <CardDescription>
                {waiting.length ? `${plural(waiting.length, 'emplacement', 'emplacements')} prêts. Tu peux encore les modifier : ils ne partent sur GitHub que dans ta review en attente, invisible pour l’auteur.` : 'Rien en attente d’ajout.'}
              </CardDescription>
            </CardHeader>
            {(waitingComments.length > 0 || waiting.length > 0) && (
              <CardContent className="flex flex-col gap-4">
                {waitingComments.map((c) => (
                  <div key={c.id} className="flex flex-col gap-2.5 border-t pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={sevTone[c.severity]}>{sevLabel[c.severity]}</Badge>
                        {c.pattern && <span className="text-sm text-violet-700 dark:text-violet-400">{c.pattern}</span>}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => decide(c, null)}>Remettre à trier</Button>
                    </div>
                    {waiting.filter((t) => t.comment === c).map((t) => editor(t, { drop: t.comment.also.length > 0 }))}
                  </div>
                ))}
                {waiting.length > 0 && (
                  <div>
                    <Button size="sm" disabled={busy != null} onClick={() => post(waiting)}>
                      {busy === 'post' && <Spinner />}{busy === 'post' ? 'Ajout en cours…' : `Ajouter ${plural(waiting.length, 'commentaire', 'commentaires')} à la review GitHub`}
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {ignored.length > 0 && (
            <Fold title={`Ignorés (${ignored.length})`}>
              <div className="flex flex-col gap-4">
                {ignored.map((c) => (
                  <div key={c.id} className="flex flex-col gap-2.5 border-t pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={sevTone[c.severity]}>{sevLabel[c.severity]}</Badge>
                        {c.pattern && <span className="text-sm text-violet-700 dark:text-violet-400">{c.pattern}</span>}
                      </span>
                      <span className="flex gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => decide(c, null)}>Remettre à trier</Button>
                        <Button size="sm" onClick={() => decide(c, 'approved')}>Approuver</Button>
                      </span>
                    </div>
                    {targetsOf(c).map((t) => editor(t))}
                  </div>
                ))}
              </div>
            </Fold>
          )}

          {failed.length > 0 && (
            <Card className="gap-4 border-red-500/40">
              <CardHeader>
                <CardTitle>Non passés</CardTitle>
                <CardDescription>GitHub a refusé ces emplacements, souvent parce que la ligne n’est pas dans le diff. Corrige la ligne ou le texte, puis renvoie-les.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {failed.map((t) => (
                  <div key={t.key} className="flex flex-col gap-2 border-t pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-red-700 dark:text-red-400">{s.failed[t.key]}</span>
                      <Button variant="outline" size="sm" onClick={() => set({ dropped: [...s.dropped, t.key] })}>Abandonner</Button>
                    </div>
                    {editor(t, { line: true })}
                  </div>
                ))}
                <div>
                  <Button size="sm" disabled={busy != null} onClick={() => post(failed)}>
                    {busy === 'post' && <Spinner />}Renvoyer {plural(failed.length, 'commentaire', 'commentaires')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="gap-4">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Review en attente sur GitHub</CardTitle>
                <CardDescription>
                  {pendingTotal ? `${plural(pendingTotal, 'commentaire', 'commentaires')}, visibles par toi seul tant que la review n’est pas envoyée.` : 'Aucun commentaire ajouté pour l’instant.'}
                  {githubOnly > 0 && ` Dont ${githubOnly} ajouté(s) directement sur GitHub.`}
                </CardDescription>
              </div>
              {pendingTotal > 0 && <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={discardPending}>Tout supprimer</Button>}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {posted.map((t) => (
                <div key={t.key} className="flex items-start justify-between gap-3 border-t pt-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs break-all text-muted-foreground">{t.path}:{t.line}</span>
                    <p className="text-sm break-words whitespace-pre-wrap">{t.body}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy != null} title="Le retire de GitHub ; il redevient modifiable dans « Approuvés »" onClick={() => unpost(t)}>{busy === t.key && <Spinner />}Retirer</Button>
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="r-summary">Message de la review (modifiable)</FieldLabel>
                <Textarea id="r-summary" rows={3} value={s.summary ?? defaultSummary} onChange={(e) => set({ summary: e.target.value })} />
              </div>
              <div className="flex flex-wrap gap-2">
                {EVENTS.map(([k, label]) => (
                  <Pill key={k} active={event === k} title={k === 'APPROVE' && !ciOk ? (pr.ci.state === 'fail' ? 'Attention : la CI ne passe pas' : 'Attention : la CI est encore en cours') : undefined} onClick={() => setEvent(k)}>
                    {k === 'APPROVE' && !ciOk && <TriangleAlertIcon className={cn('size-3.5', event !== k && 'text-amber-600 dark:text-amber-400')} />}
                    {label}
                  </Pill>
                ))}
              </div>
              {!ciOk && (
                <p className={cn('flex items-start gap-1.5 text-xs', event === 'APPROVE' ? 'rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 font-medium text-amber-800 dark:text-amber-300' : 'text-amber-700 dark:text-amber-400')}>
                  <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
                  {pr.ci.state === 'fail' ? `La CI ne passe pas (${failingJobs.join(', ')})` : 'La CI est encore en cours'}
                  {event === 'APPROVE' ? ' : tu t’apprêtes à approuver quand même.' : '.'}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={busy != null || (pendingTotal === 0 && event === 'COMMENT')} onClick={submit}>
                  {busy === 'submit' && <Spinner />}Envoyer la review{pendingTotal ? ` (${plural(pendingTotal, 'commentaire', 'commentaires')})` : ''}
                </Button>
                {(waiting.length > 0 || failed.length > 0 || todo.length > 0) && (
                  <span className="text-sm text-muted-foreground">
                    {[todo.length && `${todo.length} à trier`, waiting.length && `${waiting.length} approuvé(s) pas encore ajouté(s)`, failed.length && `${failed.length} non passé(s)`].filter(Boolean).join(' · ')} : ils ne partiront pas.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}

/** Section repliable. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border bg-card px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
