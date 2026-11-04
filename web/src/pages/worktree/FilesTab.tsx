import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, FileIcon, PencilIcon, PlayIcon, WrenchIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { DiffFile, Finding, FindingsFixAllOutput, FixOutput, PrReviewOutput, ReviewComment, ReviewDecisions, ReviewOutput, ReviewThread } from '../../../../shared/types.ts'
import { Diff, DiffNotice, DiffRow, DiffStat } from '@/components/Diff'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useOpenInEditor, useSaveReviewDecisions, useSetFileViewed } from '../../data/mutations.ts'
import { useHealth, usePrFiles, useReviewDecisions } from '../../data/queries.ts'
import { PriorThread } from '../../components/Thread.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Avatar, Badge, ErrorBox, RunPanel, Spinner, plural, sevLabel, sevTone, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { BlockedCommit } from '../../components/BlockedCommit.tsx'

const EMPTY: ReviewDecisions = { approved: [], ignored: [], dropped: [], text: {}, line: {}, posted: {}, failed: {}, summary: null, published: null }

/** Auto-review de ma PR : remarques acceptées ou ignorées, gardées par run (comme le tri d'une review). */
type Decide = (ids: string | string[], choice: 'approved' | 'ignored' | null) => void

export function FilesTab({ project, detail, wtId }: TabProps) {
  const toast = useToast()
  const q = usePrFiles(project.id, wtId)
  const setViewed = useSetFileViewed(project.id, wtId)
  const openFile = useOpenInEditor(project.id, wtId)
  const mine = detail.worktree.kind === 'mine'
  const self = useAction<ReviewOutput>('self-review', { project: project.id, worktree: wtId })
  const review = useAction<PrReviewOutput>('review', { project: project.id, worktree: wtId })
  // Remarques acceptées : corrigées ensemble par un seul agent, depuis la liste en bas de l'onglet.
  const decisionsQ = useReviewDecisions(mine ? self.id : null)
  const saveDecisions = useSaveReviewDecisions(mine ? self.id : null, EMPTY)
  const decisions = { ...EMPTY, ...decisionsQ.data }
  const decide: Decide = (ids, choice) => {
    const list = Array.isArray(ids) ? ids : [ids]
    saveDecisions.update({
      approved: [...decisions.approved.filter((x) => !list.includes(x)), ...(choice === 'approved' ? list : [])],
      ignored: [...decisions.ignored.filter((x) => !list.includes(x)), ...(choice === 'ignored' ? list : [])],
    }, (e) => toast(`Choix non enregistré : ${e.message}`, true))
  }
  const fixAll = useAction<FindingsFixAllOutput>('findings-fix-all', { project: project.id, worktree: wtId, ref: self.id ?? undefined })
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement du diff…</div>
  if (!q.data) return <ErrorBox error={q.error} />
  const { files, threads, prId } = q.data
  // Un motif récurrent s'affiche à chacun de ses emplacements dans le diff.
  const findings: (Finding | ReviewComment)[] = mine
    ? self.result?.findings ?? []
    : (review.result?.comments ?? []).flatMap((c) => [c, ...(c.also ?? []).map((a, i) => ({ ...c, id: `${c.id}#${i}`, file: a.file, line: a.line, body: a.body, also: [] }))])
  const viewed = files.filter((f) => f.viewed).length
  const add = files.reduce((a, f) => a + f.additions, 0)
  const del = files.reduce((a, f) => a + f.deletions, 0)

  const toggleViewed = (f: DiffFile) => {
    const next = !f.viewed
    setOpen((o) => ({ ...o, [f.path]: !next }))
    setViewed.mutate({ prId, path: f.path, viewed: next }, { onError: (e) => toast(`GitHub : ${e.message}`, true) })
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Fichiers modifiés">
      <Card className="flex-row flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex flex-col gap-2">
          <span className="text-sm"><span className="font-medium">{viewed} / {plural(files.length, 'fichier vu', 'fichiers vus')}</span> <DiffStat add={add} del={del} /></span>
          <span className="block h-1.5 w-52 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${files.length ? (100 * viewed) / files.length : 0}%` }} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(Object.fromEntries(files.map((f) => [f.path, true])))}>Tout déplier</Button>
          <Button variant="outline" size="sm" onClick={() => setOpen(Object.fromEntries(files.map((f) => [f.path, false])))}>Tout plier</Button>
          {mine ? (
            <>
              {self.result && !self.busy && <Badge tone={findings.length ? 'amber' : 'green'}>{plural(findings.length, 'remarque de l’IA', 'remarques de l’IA')}</Badge>}
              <Button size="sm" disabled={self.busy} onClick={() => self.start()}>
                {self.busy ? <Spinner /> : <PlayIcon />}{self.result ? 'Relancer l’auto-review' : 'Analyser ma PR avec l’IA'}
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Modifier le prompt d’auto-review" onClick={() => go({ page: 'prompts', key: 'self-review' })}><PencilIcon /></Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => go({ page: 'worktree', project: project.id, wt: wtId, tab: 'review' })}>
              {review.result ? 'Suggestions affichées dans le diff · ouvrir la review' : 'Lancer la review IA'}
            </Button>
          )}
        </div>
      </Card>
      {mine && <RunPanel id={self.id} events={self.events} running={self.running} run={self.run} label="Les 4 reviewers relisent la PR" onStop={self.stop} action={self} />}
      {mine && self.result?.summary && <Card className="px-4 py-3 text-sm">{self.result.summary}</Card>}

      {files.map((f) => {
        const isOpen = open[f.path] ?? !f.viewed
        const fThreads = threads.filter((t) => t.path === f.path && !t.isResolved)
        const fFindings = findings.filter((x) => x.file === f.path)
        const notes = fThreads.length + fFindings.length
        return (
          <article key={f.path} className="overflow-hidden rounded-xl border bg-card">
            <div className={cn('flex flex-wrap items-center gap-2 py-1 pr-3 pl-2', f.viewed && 'bg-muted/50', isOpen && 'border-b')}>
              <button type="button" onClick={() => setOpen({ ...open, [f.path]: !isOpen })} aria-expanded={isOpen} className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 text-left">
                <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 font-mono text-[13px] font-medium break-all">{f.path}</span>
                <DiffStat add={f.additions} del={f.deletions} />
                {notes > 0 && <Badge tone="amber">{plural(notes, 'remarque', 'remarques')}</Badge>}
              </button>
              <Button variant="ghost" size="sm" onClick={() => openFile.mutate(f.path, { onError: (e) => toast(e.message, true) })}><ExternalLinkIcon />Ouvrir</Button>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium dark:bg-input/30">
                <Checkbox checked={f.viewed} onCheckedChange={() => toggleViewed(f)} />
                Vu
              </label>
            </div>
            {isOpen && (
              <Diff>
                {f.lines.length === 0 && <DiffNotice>Pas de diff affichable (fichier binaire, renommé ou trop gros).</DiffNotice>}
                {f.lines.map((l, i) => {
                  const lineThreads = l.n != null && l.t !== '-' ? fThreads.filter((t) => t.line === l.n) : []
                  const lineFindings = l.n != null && l.t !== '-' ? fFindings.filter((x) => x.line === l.n) : []
                  return (
                    <div key={i}>
                      <DiffRow line={l} nums={[l.o, l.n]} />
                      {(lineThreads.length > 0 || lineFindings.length > 0) && (
                        <div className="flex flex-col gap-2 border-y bg-muted/50 px-3 py-2.5 font-sans">
                          {lineThreads.map((t) => <ThreadNote key={t.id} thread={t} onOpen={() => go({ page: 'worktree', project: project.id, wt: wtId, tab: mine ? 'comments' : 'review' })} />)}
                          {lineFindings.map((x) => mine
                            ? <FindingNote key={x.id} finding={x as Finding} related={threads.find((t) => t.id === x.relatedThreadId)} project={project.id} wtId={wtId} runId={self.id} decisions={decisions} decide={decide} done={fixAll.result?.results.find((r) => r.id === x.id) ?? null} />
                            : <ProposalNote key={x.id} finding={x} related={threads.some((t) => t.id === x.relatedThreadId)} onOpen={() => go({ page: 'worktree', project: project.id, wt: wtId, tab: 'review' })} />)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {f.truncated && <DiffNotice>Diff tronqué : ouvre le fichier pour la suite.</DiffNotice>}
              </Diff>
            )}
          </article>
        )
      })}
      {mine && self.result && (self.result.findings.length > 0) && (
        <FindingsBasket findings={self.result.findings} decisions={decisions} decide={decide} fixAll={fixAll} />
      )}
    </section>
  )
}

/**
 * En bas de l'onglet : les remarques de l'auto-review que j'ai acceptées ou ignorées. Un seul bouton lance un seul agent
 * sur toutes les acceptées (au lieu d'un agent par remarque), puis un seul commit.
 */
function FindingsBasket({ findings, decisions, decide, fixAll }: { findings: Finding[]; decisions: ReviewDecisions; decide: Decide; fixAll: ReturnType<typeof useAction<FindingsFixAllOutput>> }) {
  const results = new Map((fixAll.result?.results ?? []).map((r) => [r.id, r]))
  const approved = findings.filter((f) => decisions.approved.includes(f.id))
  const toFix = approved.filter((f) => !results.get(f.id)?.ok)
  const ignored = findings.filter((f) => decisions.ignored.includes(f.id))
  const pending = findings.filter((f) => !decisions.approved.includes(f.id) && !decisions.ignored.includes(f.id))
  const row = (f: Finding, action: ReactNode) => (
    <div key={f.id} className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-sm first:border-t-0">
      <Badge tone={sevTone[f.severity]}>{sevLabel[f.severity]}</Badge>
      <span className="min-w-0 flex-1"><span className="font-medium">{f.title}</span> <span className="font-mono text-xs text-muted-foreground">{f.file}:{f.line}</span></span>
      {results.get(f.id) && <Badge tone={results.get(f.id)!.ok ? 'green' : 'red'}>{results.get(f.id)!.ok ? 'Corrigé' : results.get(f.id)!.detail}</Badge>}
      {action}
    </div>
  )
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Remarques retenues</p>
          <p className="text-sm text-muted-foreground">
            {plural(approved.length, 'acceptée', 'acceptées')} · {plural(ignored.length, 'ignorée', 'ignorées')} · {pending.length} à trier. Un seul agent corrige toutes les acceptées, puis un seul commit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => decide(pending.map((f) => f.id), 'approved')}>Accepter les {pending.length} restantes</Button>
          )}
          <Button size="sm" disabled={!toFix.length || fixAll.busy} onClick={() => void fixAll.start({ findings: toFix })}>
            {fixAll.busy ? <Spinner /> : <WrenchIcon />}Corriger {plural(toFix.length, 'remarque', 'remarques')} et pousser
          </Button>
        </div>
      </div>
      <RunPanel id={fixAll.id} events={fixAll.events} running={fixAll.running} run={fixAll.run} label="Un agent corrige les remarques acceptées, puis commit et push" onStop={fixAll.stop} action={fixAll} />
      <BlockedCommit run={fixAll.run} />
      {/* À trier : ni acceptées ni ignorées, elles comptent encore dans l'étape Self-review. */}
      {pending.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-amber-500/40">
          <p className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-medium">À trier · {pending.length}</p>
          {pending.map((f) => row(f, (
            <span className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => decide(f.id, 'approved')}>Accepter</Button>
              <Button size="sm" variant="ghost" onClick={() => decide(f.id, 'ignored')}>Ignorer</Button>
            </span>
          )))}
        </div>
      )}
      {approved.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          {approved.map((f) => row(f, !fixAll.busy && <Button size="sm" variant="ghost" onClick={() => decide(f.id, null)}>Retirer</Button>))}
        </div>
      )}
      {ignored.length > 0 && (
        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />Ignorées · {ignored.length}
          </summary>
          <div className="border-t">{ignored.map((f) => row(f, <Button size="sm" variant="ghost" onClick={() => decide(f.id, null)}>Remettre</Button>))}</div>
        </details>
      )}
    </Card>
  )
}

/** Note insérée sous une ligne du diff. */
function Note({ children }: { children: ReactNode }) {
  return <div className="flex max-w-3xl flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm">{children}</div>
}

function ThreadNote({ thread, onOpen }: { thread: ReviewThread; onOpen: () => void }) {
  const first = thread.comments[0]
  return (
    <Note>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar login={first?.author} size="sm" />
        <span className="font-medium">{first?.author}</span>
        <Badge tone="gray">Commentaire</Badge>
        {thread.comments.length > 1 && <span className="text-xs text-muted-foreground">+{thread.comments.length - 1} réponse(s)</span>}
      </div>
      <Markdown text={first?.body ?? ''} code={thread.code} />
      <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={onOpen}>Traiter ce commentaire →</Button>
    </Note>
  )
}

function FindingNote({ finding, related, project, wtId, runId, decisions, decide, done }: {
  finding: Finding; related?: ReviewThread; project: string; wtId: string; runId: string | null
  decisions: ReviewDecisions; decide: Decide; done: { ok: boolean; detail: string } | null
}) {
  const me = useHealth().data?.github
  // Correction lancée remarque par remarque (avant la liste commune) : son résultat reste affiché.
  const fix = useAction<FixOutput>('finding-fix', { project, worktree: wtId, ref: `${runId}:${finding.id}` }, { finding })
  const approved = decisions.approved.includes(finding.id)
  const ignored = decisions.ignored.includes(finding.id)
  const fixed = fix.run?.status === 'success' || !!done?.ok
  return (
    <Note>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar ai size="sm" />
        <span className="font-medium">Auto-review</span>
        <Badge tone={sevTone[finding.severity]}>{sevLabel[finding.severity]}</Badge>
        {fixed && <Badge tone="green">Corrigé</Badge>}
        {!fixed && approved && <Badge tone="blue">Acceptée · dans la liste en bas</Badge>}
        {ignored && <Badge tone="gray">Ignorée</Badge>}
      </div>
      <p><span className="font-medium">{finding.title}.</span> {finding.body}</p>
      <p className="text-muted-foreground"><span className="font-medium text-foreground">Correctif : </span>{finding.fix}</p>
      {related && <PriorThread thread={related} me={me} title="Déjà relevé par un reviewer : relis l’échange" />}
      {!fixed && !fix.busy && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" variant={approved ? 'default' : 'outline'} aria-pressed={approved} onClick={() => decide(finding.id, approved ? null : 'approved')}><CheckIcon />Accepter</Button>
          <Button size="sm" variant={ignored ? 'secondary' : 'outline'} aria-pressed={ignored} onClick={() => decide(finding.id, ignored ? null : 'ignored')}><XIcon />Ignorer</Button>
        </div>
      )}
      {fix.id && <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit et push" onStop={fix.stop} action={fix} />}
      <BlockedCommit run={fix.run} />
      {fix.result && <p className="text-xs text-muted-foreground">{fix.result.summary}</p>}
      {done && !done.ok && <p className="text-xs text-red-600 dark:text-red-400">{done.detail}</p>}
    </Note>
  )
}

function ProposalNote({ finding, related, onOpen }: { finding: Pick<ReviewComment, 'severity' | 'body'>; related: boolean; onOpen: () => void }) {
  return (
    <Note>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar ai size="sm" />
        <span className="font-medium">Review IA</span>
        <Badge tone={sevTone[finding.severity]}>{sevLabel[finding.severity]}</Badge>
        {related && <Badge tone="amber">Déjà discuté</Badge>}
      </div>
      <p className="whitespace-pre-wrap">{finding.body}</p>
      <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={onOpen}>Approuver ou ignorer dans la review →</Button>
    </Note>
  )
}
