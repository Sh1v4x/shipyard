import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon, ChevronDownIcon, ClockIcon, CodeIcon, CopyIcon, EllipsisIcon, GhostIcon, GitMergeIcon, PinIcon, PinOffIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { LinkTicket } from '../components/LinkTicket.tsx'
import { LabelPicker } from '../components/LabelPicker.tsx'
import { LinkedWorktrees } from '../components/LinkedWorktrees.tsx'
import { MoveWorktree } from '../components/MoveWorktree.tsx'
import { TicketStatus } from '../components/TicketStatus.tsx'
import { PrTimeline } from '../components/PrTimeline.tsx'
import type { Project, PullRequest, Worktree } from '../../../shared/types.ts'
import { useFinishWorktree, useOpenInEditor, useRemoveWorktree, useRerequestReview, useSetGhost, useWakeGhost } from '../data/mutations.ts'
import { usePins } from '../data/pins.ts'
import { useChecks, useHealth, useLabelRules, useProjectOverview, useReviewerCandidates, useSdkStatus, useThreads, useWorktreeDetail } from '../data/queries.ts'
import { awaitsReview, labelWithRole, needsChanges, needsReviewer, needsTesting } from '../../../shared/review.ts'
import { isStale, since, waitingInfo } from '../../../shared/timeline.ts'
import { go } from '../router.ts'
import { ghostKey } from '../../../shared/queue.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Avatar, Badge, ErrorBox, Label, Spinner, plural, prReviewBadge, reviewersToRerequest, useToast, worktreeTitle } from '../ui.tsx'
import { CiTab } from './worktree/CiTab.tsx'
import { ChecksTab } from './worktree/ChecksTab.tsx'
import { LogsTab } from './worktree/LogsTab.tsx'
import { CommentsTab } from './worktree/CommentsTab.tsx'
import { ConflictsTab } from './worktree/ConflictsTab.tsx'
import { FilesTab } from './worktree/FilesTab.tsx'
import { FollowupTab } from './worktree/FollowupTab.tsx'
import { type PrState, type Section, StateDot, buildSections, lateSdks, myOpenThreads, testsDone } from './worktree/checklist.tsx'
import { ReviewTab } from './worktree/ReviewTab.tsx'
import { SdkPanel } from './worktree/SdkPanel.tsx'
import { TestsTab } from './worktree/TestsTab.tsx'
import { TicketTab } from './worktree/TicketTab.tsx'

interface NextStep { tone: 'red' | 'amber' | 'purple' | 'green' | 'gray' | 'blue'; title: string; detail: string | null; tab?: string; url?: string; label?: string }

const NEXT_TONE: Record<NextStep['tone'], string> = {
  red: 'border-red-500/35 bg-red-500/5',
  amber: 'border-amber-500/40 bg-amber-500/5',
  purple: 'border-violet-500/35 bg-violet-500/5',
  green: 'border-emerald-500/35 bg-emerald-500/5',
  blue: 'border-blue-500/30 bg-blue-500/5',
  gray: 'bg-card',
}

export function WorktreePage({ project, wtId, tab }: { project: Project; wtId: string; tab?: string }) {
  const q = useWorktreeDetail(project.id, wtId)
  const open = useOpenInEditor(project.id, wtId)
  const toast = useToast()
  const rules = useLabelRules()
  const pins = usePins()
  const ghosts = useProjectOverview(project.id).data?.ghosts
  const setGhost = useSetGhost(project.id)
  const wake = useWakeGhost(project.id)
  const [history, setHistory] = useState(false)
  const d = q.data
  const hasPr = !!d?.pr && !d.worktree.merged
  // Fils, contrôles et SDK de la PR : l'état de chaque point de la liste et la prochaine étape.
  const threads = useThreads(project.id, wtId, hasPr)
  const checks = useChecks(project.id, wtId, hasPr)
  const sdk = useSdkStatus(project.id, wtId, !!d)
  const me = useHealth().data?.github ?? null
  // Début de détail tiré de la vue du projet : en-tête tout de suite, contenu à l'arrivée de la vraie réponse.
  const partial = q.isPlaceholderData

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement du worktree…</div>
  if (!d) return <ErrorBox error={q.error ?? 'Worktree introuvable'} />

  const { worktree: w, ticket, pr } = d
  const review = w.kind === 'review' && !!pr
  const state: PrState = { d, partial, threads: threads.data, checks: checks.data, sdk: sdk.data, rules, me }
  const sections = buildSections(state)
  const next = w.merged ? null : nextStep(state)
  const active = sections.some((s) => s.key === tab) ? tab! : next?.tab && sections.some((s) => s.key === next.tab) ? next.tab : sections[0].key
  const status = sections.filter((s) => s.group === 'status')
  const ok = status.filter((s) => s.state === 'ok').length
  const ctx = { project, detail: d, wtId }
  const pinned = pins.isPinned(project.id, wtId)
  const ghostId = ghostKey(pr?.number, wtId)
  const ghost = ghostId ? ghosts?.[ghostId] : undefined
  const toggleGhost = () => {
    if (!ghostId) return
    if (ghost) return wake.mutate(ghostId, { onSuccess: () => toast('Remis dans tes tâches en cours'), onError: (e) => toast(e.message, true) })
    const note = prompt('Mettre de côté (ghost) : pourquoi ? (facultatif)')
    if (note !== null) setGhost.mutate({ key: ghostId, note }, { onSuccess: () => toast('Mis de côté : il ne compte plus dans tes tâches'), onError: (e) => toast(e.message, true) })
  }
  const wait = pr && waitingInfo(pr, me)
  const goTo = (k: string) => go({ page: 'worktree', project: project.id, wt: wtId, tab: k })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className={cn('min-w-0 flex-1 text-xl font-semibold tracking-tight', pr || w.merged ? 'break-words' : 'font-mono break-all')} title={w.path}>{pr && !w.merged ? pr.title : worktreeTitle(w, pr)}</h1>
          <span className="flex flex-wrap items-center gap-1.5">
            {w.kind !== 'review' && !pr && !w.merged && <MoveWorktree project={project} worktree={w} hasWork={d.commitsAhead.length > 0 || d.dirtyFiles.length > 0} />}
            <Button variant="outline" size="sm" onClick={() => open.mutate(undefined, { onError: (e) => toast(e.message, true) })}>
              <CodeIcon />Ouvrir dans l’éditeur
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Plus d’actions"><EllipsisIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!w.merged && <DropdownMenuItem onSelect={toggleGhost}><GhostIcon />{ghost ? 'Réveiller : remettre dans mes tâches' : 'Mettre de côté (ghost)'}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => pins.toggle(project.id, wtId)}>{pinned ? <PinOffIcon /> : <PinIcon />}{pinned ? 'Désépingler' : 'Épingler dans la barre latérale'}</DropdownMenuItem>
                {pr && <DropdownMenuItem asChild><a href={pr.url} target="_blank" rel="noreferrer"><ArrowUpRightIcon />Ouvrir la PR sur GitHub</a></DropdownMenuItem>}
                {ticket && <DropdownMenuItem asChild><a href={ticket.url} target="_blank" rel="noreferrer"><ArrowUpRightIcon />Ouvrir {ticket.id} dans Linear</a></DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(w.path).then(() => toast('Chemin copié'))}><CopyIcon />Copier le chemin</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
          {pr && (
            <>
              <a className="font-mono text-[13px] font-medium text-foreground hover:underline" href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a>
              <Badge tone={pr.mine ? 'blue' : 'purple'}>{pr.mine ? 'Ma PR' : `Review · ${pr.author}`}</Badge>
              {ghost && <span title={ghost.note ?? "Mis de côté"}><Badge tone="gray"><GhostIcon className="size-3" />Ghost</Badge></span>}
              {pr.isDraft && <Badge tone="gray">draft</Badge>}
              <span aria-hidden>·</span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            {ticket ? <><a className="font-mono text-[13px] font-medium text-foreground hover:underline" href={ticket.url} target="_blank" rel="noreferrer">{ticket.id}</a><TicketStatus project={project} ticket={ticket} /></> : w.localTicket ? <Badge tone="gray">Ticket local</Badge> : <span>{w.ticketId ?? 'Sans ticket'}</span>}
            <LinkTicket project={project} worktree={w} hasTicket={!!w.ticketId} />
          </span>
          <span aria-hidden>·</span>
          <span className="max-w-full truncate font-mono text-xs" title={w.path}>{w.branch ?? w.head}{pr && ` → ${pr.base}`}</span>
          {pr?.labels.map((l) => <Label key={l.name} {...l} />)}
          {pr?.timeline?.length ? (
            <button type="button" className={cn('ml-auto flex items-center gap-1 text-xs hover:text-foreground', wait && isStale(wait.since) && 'font-medium text-amber-700 dark:text-amber-400')} aria-expanded={history} onClick={() => setHistory(!history)}>
              <ClockIcon className="size-3.5" />{wait ? `${wait.label} depuis ${since(wait.since)}` : 'Historique'}<ChevronDownIcon className={cn('size-3.5 transition-transform', history && 'rotate-180')} />
            </button>
          ) : null}
        </div>
        <LinkedWorktrees project={project} worktree={w} />
      </div>

      {history && pr && <PrTimeline pr={pr} />}

      {w.merged && <FinishBanner project={project} wtId={wtId} merged={w.merged} ticketId={w.ticketId} dirty={d.dirtyFiles.length} review={w.kind === 'review'} />}
      {next && (
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3', NEXT_TONE[next.tone])}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Prochaine étape</p>
            <p className="font-semibold">{next.title}</p>
            {next.detail && <p className="text-sm text-muted-foreground">{next.detail}</p>}
          </div>
          {next.url && <Button size="sm" asChild><a href={next.url} target="_blank" rel="noreferrer">{next.label}<ArrowUpRightIcon /></a></Button>}
          {!next.url && next.tab && next.label && active !== next.tab && <Button size="sm" onClick={() => goTo(next.tab!)}>{next.label}<ArrowRightIcon /></Button>}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Sections du worktree" className="flex flex-col gap-3 lg:sticky lg:top-20">
          {status.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{review ? 'Ma review' : 'Prête à merger'}</span>
                <span className="tabular-nums">{ok} / {status.length}</span>
              </div>
              <div className="h-1 bg-muted"><div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${(ok / status.length) * 100}%` }} /></div>
              {status.map((s) => <SectionButton key={s.key} s={s} active={active === s.key} onClick={() => goTo(s.key)} />)}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border bg-card">
            {sections.filter((s) => s.group === 'work').map((s) => <SectionButton key={s.key} s={s} active={active === s.key} onClick={() => goTo(s.key)} />)}
          </div>
        </nav>

        <div className="min-w-0">
          {partial && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement du worktree…</div>}
          {!partial && active === 'ticket' && <TicketTab {...ctx} />}
          {!partial && active === 'files' && <FilesTab {...ctx} />}
          {!partial && active === 'comments' && <CommentsTab {...ctx} />}
          {!partial && active === 'review' && <ReviewTab {...ctx} />}
          {!partial && active === 'followup' && <FollowupTab {...ctx} />}
          {!partial && active === 'tests' && <TestsTab {...ctx} />}
          {!partial && active === 'ci' && <CiTab {...ctx} />}
          {!partial && active === 'checks' && <ChecksTab {...ctx} />}
          {!partial && active === 'sdk' && <SdkPanel {...ctx} />}
          {!partial && active === 'logs' && <LogsTab {...ctx} />}
          {!partial && active === 'reviewers' && pr && <ReviewersBar project={project} wtId={wtId} pr={pr} />}
          {!partial && active === 'conflicts' && <ConflictsTab {...ctx} />}
        </div>
      </div>
    </div>
  )
}

function SectionButton({ s, active, onClick }: { s: Section; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 border-t px-3 py-2 text-left text-sm transition-colors first:border-t-0 hover:bg-accent', active && 'bg-accent font-medium')}
    >
      <StateDot state={s.state} />
      <span className="min-w-0 flex-1 truncate">{s.label}</span>
      {s.summary && <span className="shrink-0 text-xs font-normal text-muted-foreground">{s.summary}</span>}
    </button>
  )
}


/** Ce qui débloque le worktree, dans l'ordre : conflits, commentaires, CI, SDK, contrôles, retard sur la base, auto-review, labels, relance, tests, merge. */
function nextStep({ d, threads, checks, sdk, rules, me }: PrState): NextStep {
  const { worktree: w, pr } = d
  if (pr && w.kind === 'review') {
    const replies = myOpenThreads(threads).filter((t) => !t.awaitingReviewer)
    if (replies.length && awaitsReview(pr, rules)) return { tone: 'purple', title: `${pr.author} a répondu à ${plural(replies.length, 'de tes retours', 'de tes retours')}`, detail: 'Vérifie les correctifs avant de relancer une review complète.', tab: 'followup', label: 'Vérifier les correctifs' }
    if (awaitsReview(pr, rules) || (me && pr.requestedReviewers.includes(me))) return { tone: 'purple', title: `Review demandée par ${pr.author}`, detail: `+${pr.additions} −${pr.deletions} · ${plural(pr.changedFiles, 'fichier', 'fichiers')}`, tab: 'review', label: 'Lancer la review' }
    return { tone: 'gray', title: 'Review rendue', detail: `En attente de ${pr.author}.` }
  }
  if (pr) {
    if (d.merge?.remaining.length) return { tone: 'red', title: `Fusion de ${d.merge.base ?? pr.base} en cours : ${plural(d.merge.remaining.length, 'fichier en conflit', 'fichiers en conflit')}`, detail: d.merge.remaining.join(', '), tab: 'conflicts', label: 'Résoudre les conflits' }
    if (d.behindRemote) return { tone: 'amber', title: `${plural(d.behindRemote, 'commit poussé', 'commits poussés')} sur ta branche${d.remoteAuthors.length ? ` par ${d.remoteAuthors.join(', ')}` : ''}`, detail: 'Récupère-les avant de continuer : sinon ton prochain push sera refusé.', tab: 'conflicts', label: 'Récupérer ma branche' }
    if (pr.conflicts) return { tone: 'red', title: `Conflits avec ${pr.base}`, detail: d.behindBase ? `${pr.base} a ${plural(d.behindBase, 'commit', 'commits')} d’avance.` : null, tab: 'conflicts', label: 'Résoudre les conflits' }
    const open = threads ? threads.filter((t) => !t.isResolved && !t.awaitingReviewer && !t.isDraft) : []
    const nOpen = threads ? open.length : pr.unresolvedThreads
    const others: string[] = []
    if (pr.ci.failing) others.push(plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'))
    if (lateSdks(sdk).length) others.push('SDK à mettre à jour')
    if (nOpen) return { tone: 'amber', title: plural(nOpen, 'commentaire à traiter', 'commentaires à traiter'), detail: [open.length ? `De ${[...new Set(open.map((t) => t.comments[0]?.author))].join(', ')}.` : null, others.length ? `Ensuite : ${others.join(', ')}.` : null].filter(Boolean).join(' ') || null, tab: 'comments', label: 'Traiter les commentaires' }
    if (pr.ci.failing) return { tone: 'red', title: plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'), detail: pr.ci.jobs.filter((j) => j.state === 'fail').map((j) => j.name).join(', '), tab: 'ci', label: 'Voir les échecs' }
    const late = lateSdks(sdk)
    if (late.length) return { tone: 'amber', title: `${late[0].name} n’est pas à jour`, detail: late[0].latest && late[0].locked !== late[0].latest ? `Figé en ${late[0].locked}, dernière publiée ${late[0].latest}.` : 'Des merges du SDK ne sont pas encore publiés.', tab: 'sdk', label: 'Mettre à jour' }
    const failing = (checks ?? []).filter((r) => !r.stale && r.status !== 'pass')
    if (failing.length) return { tone: 'amber', title: `Contrôle « ${failing[0].title} » ${failing[0].status === 'fail' ? 'en échec' : 'à regarder'}`, detail: failing.length > 1 ? `Et ${plural(failing.length - 1, 'autre contrôle', 'autres contrôles')}.` : null, tab: 'checks', label: 'Analyser' }
    if (d.behindBase) return { tone: 'amber', title: `${pr.base} a ${plural(d.behindBase, 'commit', 'commits')} d’avance sur la branche`, detail: 'Récupère-les avant de demander une review ou de merger.', tab: 'conflicts', label: `Récupérer ${pr.base}` }
    if (d.selfReview?.pending) return { tone: 'amber', title: plural(d.selfReview.pending, 'remarque d’auto-review à traiter', 'remarques d’auto-review à traiter'), detail: null, tab: 'files', label: 'Voir les remarques' }
    if (needsChanges(pr, rules)) return { tone: 'amber', title: `Label « ${labelWithRole(rules, 'changes', pr.labels)?.name} » sans commentaire ouvert`, detail: 'Une modification est peut-être encore attendue, ou le label est resté.', tab: 'reviewers', label: 'Voir les reviewers' }
    const who = reviewersToRerequest(pr, rules)
    if (who.length) return { tone: 'amber', title: `Commentaires traités : relancer ${who.join(', ')}`, detail: null, tab: 'reviewers', label: 'Relancer la review' }
    if (!d.solo && needsReviewer(pr, rules)) return { tone: 'amber', title: 'Aucun reviewer sur la PR', detail: 'Personne ne la regarde tant que tu n’as pas demandé de review.', tab: 'reviewers', label: 'Demander une review' }
    if (needsTesting(pr, rules) && !testsDone(d.tests)) return { tone: 'purple', title: 'À tester avant de merger', detail: null, tab: 'tests', label: 'Tester' }
    if (pr.isDraft) return { tone: 'gray', title: 'Brouillon', detail: 'Passe-la en « prête pour review » sur GitHub quand le travail est fini.', url: pr.url, label: 'Ouvrir sur GitHub' }
    if (labelWithRole(rules, 'approved', pr.labels) || pr.reviewDecision === 'APPROVED') return { tone: 'green', title: pr.conflictsUnknown ? 'Approuvée : GitHub vérifie encore les conflits' : 'Prête à merger', detail: null, url: pr.url, label: 'Merger sur GitHub' }
    if (pr.ci.state === 'running') return { tone: 'blue', title: 'CI en cours', detail: null, tab: 'ci', label: 'Suivre la CI' }
    // Seul contributeur : personne à attendre, tout est vert.
    if (d.solo) return { tone: 'green', title: pr.conflictsUnknown ? 'GitHub vérifie encore les conflits' : 'Prête à merger', detail: null, url: pr.url, label: 'Merger sur GitHub' }
    const wait = waitingInfo(pr, me)
    return { tone: 'gray', title: pr.requestedReviewers.length ? `En attente de review de ${pr.requestedReviewers.join(', ')}` : 'En attente', detail: wait ? `${wait.label} depuis ${since(wait.since)}` : null }
  }
  if (d.dirtyFiles.length) return { tone: 'amber', title: plural(d.dirtyFiles.length, 'fichier modifié non commité', 'fichiers modifiés non commités'), detail: d.commitsAhead.length ? `${plural(d.commitsAhead.length, 'commit', 'commits')} déjà sur la branche.` : null, tab: 'ticket', label: 'Commiter' }
  if (d.commitsAhead.length) return { tone: 'blue', title: `${plural(d.commitsAhead.length, 'commit prêt', 'commits prêts')} : ouvrir la PR`, detail: null, tab: 'ticket', label: 'Préparer la PR' }
  return { tone: 'gray', title: w.localTicket || d.ticket ? 'Rien n’est encore commencé sur cette branche' : 'Branche sans ticket', detail: 'Le plan et le travail se lancent depuis le ticket.', tab: 'ticket', label: 'Ouvrir le ticket' }
}

const REVIEW_STATE: Record<string, { label: string; tone: 'green' | 'red' | 'gray' | 'amber' }> = {
  APPROVED: { label: 'a approuvé', tone: 'green' },
  CHANGES_REQUESTED: { label: 'demande des changements', tone: 'red' },
  COMMENTED: { label: 'a commenté', tone: 'gray' },
  DISMISSED: { label: 'review écartée', tone: 'gray' },
  PENDING: { label: 'en cours', tone: 'amber' },
}

/** Labels, état des reviewers, et relance des reviewers qui ont demandé des changements. */
function ReviewersBar({ project, wtId, pr }: { project: Project; wtId: string; pr: PullRequest }) {
  const toast = useToast()
  const rerequest = useRerequestReview(project.id, wtId)
  const busy = rerequest.isPending
  const humans = pr.reviews.filter((r) => !r.login.endsWith('[bot]') && r.login !== 'coderabbitai')
  // Seuls ceux qui ont demandé des changements et dont la review n'est pas déjà redemandée.
  const toRequest = reviewersToRerequest(pr, useLabelRules())
  const rb = prReviewBadge(pr)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Les labels de l'équipe font foi : le badge GitHub ne s'affiche qu'en leur absence, pour éviter les doublons. */}
          <span className="flex flex-wrap items-center gap-1.5">
            {pr.labels.length ? pr.labels.map((l) => <Label key={l.name} {...l} />) : <Badge tone={rb.tone}>{rb.label}</Badge>}
            <LabelPicker project={project.id} wtId={wtId} pr={pr} />
          </span>
          {[...humans.map((r) => r.login), ...pr.requestedReviewers.filter((r) => !humans.some((h) => h.login === r))].map((login) => {
            const review = humans.find((h) => h.login === login)
            const st = pr.requestedReviewers.includes(login) ? { label: 'review redemandée', tone: 'amber' as const } : REVIEW_STATE[review?.state ?? ''] ?? { label: review?.state ?? '', tone: 'gray' as const }
            return (
              <span key={login} className="flex items-center gap-1.5 text-sm">
                <Avatar login={login} size="sm" />
                {login} <Badge tone={st.tone}>{st.label}</Badge>
              </span>
            )
          })}
        </div>
        {pr.mine && toRequest.length > 0 && (
          <Button size="sm" className="max-w-full" disabled={busy} onClick={() => rerequest.mutate(toRequest, {
            onSuccess: (r) => {
              const labels = [r.removed.length && `retiré : ${r.removed.join(', ')}`, r.added.length && `ajouté : ${r.added.join(', ')}`].filter(Boolean).join(' · ')
              toast(`Review redemandée à ${toRequest.join(', ')}${labels ? ` · labels ${labels}` : ''}`)
            },
            onError: (e) => toast(e.message, true),
          })} title="Relance les reviewers qui ont demandé des changements et passe les labels « à corriger » en « en attente de review »">{busy ? <Spinner /> : <RotateCcwIcon />}<span className="truncate">Re-demander une review à {toRequest.join(', ')}</span></Button>
        )}
      </div>
      {pr.mine && !pr.isDraft && <RequestReview project={project.id} wtId={wtId} pr={pr} />}
    </div>
  )
}

/**
 * Demander une review à quelqu'un : les suggestions de GitHub (qui connaissent le code touché) d'abord, puis les autres
 * membres du dépôt. Mise en avant quand la PR n'a encore aucun reviewer ; repliée sinon, pour en ajouter un.
 */
function RequestReview({ project, wtId, pr }: { project: string; wtId: string; pr: PullRequest }) {
  const toast = useToast()
  const none = needsReviewer(pr, useLabelRules())
  const [open, setOpen] = useState(false)
  const candidates = useReviewerCandidates(project, wtId, none || open)
  const request = useRerequestReview(project, wtId)
  const [picked, setPicked] = useState<string[]>([])
  const taken = new Set([...pr.requestedReviewers, ...pr.reviews.map((r) => r.login)])
  const list = (candidates.data ?? []).filter((c) => !taken.has(c.login))
  if (!none && !open) {
    return <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={() => setOpen(true)}>Demander une review à quelqu’un d’autre</Button>
  }
  const toggle = (login: string) => setPicked((p) => (p.includes(login) ? p.filter((x) => x !== login) : [...p, login]))
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4', none && 'border-amber-500/40')}>
      <div>
        <p className="font-semibold">{none ? 'Aucun reviewer sur la PR' : 'Demander une review'}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Choisis qui doit la relire. Les personnes suggérées par GitHub connaissent le code touché.</p>
      </div>
      {candidates.isLoading ? <span className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des membres du dépôt…</span>
        : candidates.error ? <ErrorBox error={candidates.error} />
        : (
          <div className="flex flex-wrap gap-2">
            {list.map((c) => (
              <button key={c.login} type="button" aria-pressed={picked.includes(c.login)} onClick={() => toggle(c.login)}
                className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors hover:bg-accent', picked.includes(c.login) && 'border-primary bg-primary/10')}>
                {picked.includes(c.login) ? <CheckIcon className="size-3.5" /> : <Avatar login={c.login} size="sm" />}
                {c.name ?? c.login}{c.name && <span className="text-xs text-muted-foreground">{c.login}</span>}
                {c.suggested && <Badge tone="blue">suggéré</Badge>}
              </button>
            ))}
            {!list.length && <span className="text-sm text-muted-foreground">Personne d’autre à qui demander.</span>}
          </div>
        )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!picked.length || request.isPending} onClick={() => request.mutate(picked, {
          onSuccess: () => {
            toast(`Review demandée à ${picked.join(', ')}`)
            setPicked([])
            setOpen(false)
          },
          onError: (e) => toast(e.message, true),
        })}>{request.isPending && <Spinner />}Demander une review{picked.length > 0 && ` · ${picked.length}`}</Button>
        {!none && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>}
      </div>
    </div>
  )
}

export interface TabProps {
  project: Project
  detail: import('../../../shared/types.ts').WorktreeDetail
  wtId: string
}

/** Ma PR est mergée : « Aboutir le projet » passe le ticket en Done et supprime le worktree. */
function FinishBanner({ project, wtId, merged, ticketId, dirty, review }: { project: Project; wtId: string; merged: NonNullable<Worktree['merged']>; ticketId: string | null; dirty: number; review: boolean }) {
  const finish = useFinishWorktree(project.id)
  const remove = useRemoveWorktree(project.id)
  const toast = useToast()
  const linear = !!project.team && !!ticketId
  const closed = merged.state === 'CLOSED'
  // Review d'une PR mergée (ou fermée) : le ticket appartient à l'auteur, on supprime seulement le worktree.
  if (review) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <div className="min-w-0">
            <p className="font-medium text-violet-800 dark:text-violet-300">
              <a href={merged.url} target="_blank" rel="noreferrer" className="hover:underline">PR #{merged.number}</a> {closed ? 'fermée sans merge' : 'mergée'} : ta review n’a plus d’objet
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {dirty ? `Il reste ${plural(dirty, 'fichier non commité', 'fichiers non commités')} : annule-les avant de supprimer le worktree.` : 'Le worktree de review peut être supprimé.'}
            </p>
          </div>
        </div>
        <Button size="sm" disabled={remove.isPending || dirty > 0} onClick={() => {
          if (!confirm('Supprimer ce worktree de review ?')) return
          remove.mutate(wtId, {
            onSuccess: () => {
              toast('Worktree supprimé')
              go({ page: 'overview', project: project.id })
            },
            onError: (e) => toast(e.message, true),
          })
        }}>{remove.isPending ? <Spinner /> : <Trash2Icon />}Supprimer le worktree</Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="min-w-0">
          <p className="font-medium text-violet-800 dark:text-violet-300">
            <a href={merged.url} target="_blank" rel="noreferrer" className="hover:underline">PR #{merged.number}</a> mergée{merged.mergedAt && ` le ${new Date(merged.mergedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dirty
              ? `Il reste ${plural(dirty, 'fichier non commité', 'fichiers non commités')} : commite-les ou annule-les avant d’aboutir.`
              : `${linear ? `Le ticket ${ticketId} passe en Done et le` : 'Le'} worktree est supprimé. La branche est conservée.`}
          </p>
        </div>
      </div>
      <Button size="sm" disabled={finish.isPending || dirty > 0} onClick={() => {
        if (!confirm(linear ? `Passer ${ticketId} en Done et supprimer ce worktree ?` : 'Supprimer ce worktree ?')) return
        finish.mutate(wtId, {
          onSuccess: (r) => {
            toast(r.ticket ? `${r.ticket.id} passé en ${r.ticket.state} · worktree supprimé` : 'Worktree supprimé')
            go({ page: 'overview', project: project.id })
          },
          onError: (e) => toast(e.message, true),
        })
      }}>{finish.isPending ? <Spinner /> : <GitMergeIcon />}Aboutir le projet</Button>
    </div>
  )
}
