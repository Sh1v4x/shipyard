import { BotIcon, ChartColumnIcon, EyeIcon, GitBranchIcon, GitPullRequestIcon, ChevronRightIcon, ChevronsUpDownIcon, FolderGit2Icon, HouseIcon, MenuIcon, PinIcon, PinOffIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon, SettingsIcon, ShipIcon, SquareIcon, TicketIcon, Trash2Icon, type LucideIcon } from 'lucide-react'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
import type { BrokenWorktree, Project, ProjectOverview, QueueGroup, QueueItem, QueueTone } from '../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useKillOrphan, useRefreshProject, useRepairWorktree } from './data/mutations.ts'
import { usePrefetchWorktree, useInbox, useNotes, useProjectOverview, useProjectOverviews, useProjects, usePrompts, useQueue, useRunningRuns, useAgents, useBrokenWorktrees } from './data/queries.ts'
import { usePins } from './data/pins.ts'
import { cancelRun } from './data/runs.ts'
import { runHref } from '../../shared/inbox.ts'
import { QUEUE_GROUPS, isActiveTicket, queueCount } from '../../shared/queue.ts'
import { CommandPalette, openPalette } from './components/CommandPalette.tsx'
import { ConnectionStatus } from './components/ConnectionStatus.tsx'
import { LocalTicketOrphans } from './components/LocalTicketOrphans.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { ChecklistMini } from './pages/worktree/checklist.tsx'
import { AddProjectPage } from './pages/AddProject.tsx'
import { OverviewPage } from './pages/Overview.tsx'
import { AutomationsPage, CreateWorktreePage, DailyPage, InboxPage, StatsPage, InsightsPage, NewTicketPage, NotesPage, PrecheckPage, PromptsPage, QuickTicketsPage, SettingsPage, WorktreePage, loadWorktreePage } from './pages/lazy.ts'
import { go, href, useRoute, type Route } from './router.ts'
import { ThemeToggle } from './theme.tsx'
import { Notif, Spinner, plural, worktreeTitle, useToast } from './ui.tsx'

const LAST_PROJECT = 'devpanel:lastProject'

export function App() {
  const route = useRoute()
  const projects = useProjects()
  const routeProject = 'project' in route ? route.project : undefined
  const stored = (() => {
    try {
      return localStorage.getItem(LAST_PROJECT)
    } catch {
      return null
    }
  })()
  const current = projects.data?.find((p) => p.id === routeProject) ?? projects.data?.find((p) => p.id === stored) ?? projects.data?.[0]
  const [mobileNav, setMobileNav] = useState(false)

  useEffect(() => {
    if (routeProject) try { localStorage.setItem(LAST_PROJECT, routeProject) } catch { /* stockage indisponible */ }
  }, [routeProject])

  useEffect(() => {
    if (route.page !== 'home' || !projects.data) return
    go(current ? { page: 'overview', project: current.id } : { page: 'add-project' })
  }, [route.page, projects.data, current])

  // Ferme le menu mobile à chaque navigation.
  useEffect(() => setMobileNav(false), [route])

  const overview = useProjectOverview(current?.id)
  const inbox = useInbox()

  // Titre de l'onglet : ce qui m'attend, tous projets cumulés. Même calcul que le compteur du projet (shared/queue.ts).
  const allOverviews = useProjectOverviews((projects.data ?? []).map((p) => p.id))
  const pending = allOverviews.data.reduce((a, ov) => a + queueCount(ov.queue, inbox.data, ov.project.id), 0)
  useEffect(() => {
    document.title = pending ? `(${pending}) Shipyard` : 'Shipyard'
  }, [pending])
  const todo = current ? queueCount(overview.data?.queue, inbox.data, current.id) : 0
  const sidebar = <Sidebar projects={projects.data ?? []} current={current} todo={todo} loading={overview.isLoading} />
  const sidebarWidth = useSidebarWidth()

  return (
    <div className="flex min-h-svh pb-[72px]">
      <aside className="sticky top-0 hidden h-[calc(100svh-72px)] shrink-0 border-r bg-sidebar md:block" style={{ width: sidebarWidth.width }}>
        {sidebar}
        <SidebarResizer {...sidebarWidth} />
      </aside>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar current={current} overview={overview.data} route={route} onMenu={() => setMobileNav(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-16 sm:px-8">
          <Suspense fallback={<div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement…</div>}>
          {route.page === 'overview' && current && <OverviewPage project={current} tab={route.tab} />}
          {route.page === 'worktree' && current && <WorktreePage key={route.wt} project={current} wtId={route.wt} tab={route.tab} />}
          {route.page === 'create' && current && <CreateWorktreePage project={current} ticketId={route.ticket} initialMode={route.mode} />}
          {route.page === 'automations' && <AutomationsPage />}
          {route.page === 'insights' && current && <InsightsPage key={current.id} project={current} mode={route.mode} />}
          {route.page === 'new-ticket' && current && <NewTicketPage key={current.id} project={current} />}
          {route.page === 'precheck' && current && <PrecheckPage key={`${current.id}:${route.ticket ?? ''}`} project={current} ticket={route.ticket} />}
          {route.page === 'quick' && current && <QuickTicketsPage key={current.id} project={current} />}
          {route.page === 'add-project' && <AddProjectPage />}
          {route.page === 'prompts' && <PromptsPage selected={route.key} />}
          {route.page === 'inbox' && <InboxPage />}
          {route.page === 'notes' && <NotesPage />}
          {route.page === 'daily' && <DailyPage />}
          {route.page === 'stats' && <StatsPage from={route.from} to={route.to} scope={route.scope} />}
          {route.page === 'settings' && <SettingsPage section={route.section} />}
          {projects.data?.length === 0 && route.page !== 'add-project' && route.page !== 'prompts' && <AddProjectPage first />}
          </Suspense>
        </main>
      </div>
      <StatusBar project={current} route={route} />
      <CommandPalette projects={projects.data ?? []} current={current} overview={overview.data} />
    </div>
  )
}

// ---------- Barre du haut ----------

const PAGE_TITLES: Record<Route['page'], string> = {
  home: 'Accueil',
  overview: 'Accueil',
  worktree: 'Worktree',
  create: 'Nouveau worktree',
  automations: 'Automatisations',
  insights: 'Features & optimisations',
  'new-ticket': 'Nouveau ticket',
  precheck: 'Pre-check',
  quick: 'Tickets rapides',
  'add-project': 'Ajouter un projet',
  prompts: 'Prompts',
  inbox: 'À valider',
  notes: 'Notes',
  daily: 'Daily',
  stats: 'Stats',
  settings: 'Réglages',
}

/** Nom lisible d'un worktree pour le fil d'Ariane : titre de sa PR, sinon sa branche ou son commit (comme l'en-tête de la page). */
function worktreeName(overview: ProjectOverview | undefined, id: string) {
  const w = overview?.worktrees.find((x) => x.id === id)
  const pr = w && !w.merged ? [...(overview?.myPrs ?? []), ...(overview?.reviewPrs ?? [])].find((p) => p.number === w.prNumber) : undefined
  return w ? (pr?.title ?? worktreeTitle(w)) : PAGE_TITLES.worktree
}

function TopBar({ current, overview, route, onMenu }: { current?: Project; overview?: ProjectOverview; route: Route; onMenu: () => void }) {
  const refresh = useRefreshProject()
  const toast = useToast()
  const refreshing = refresh.isPending
  // Pages globales (tous projets) : pas de projet dans le fil d'Ariane.
  const showProject = current && !['prompts', 'add-project', 'inbox', 'notes', 'daily', 'stats', 'settings', 'automations', 'new-ticket'].includes(route.page)
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onMenu} aria-label="Ouvrir la navigation">
        <MenuIcon />
      </Button>
      <nav aria-label="Fil d’Ariane" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {showProject && (
          <>
            <a href={href({ page: 'overview', project: current.id })} className="hidden truncate hover:text-foreground sm:inline">{current.name}</a>
            <span className="hidden sm:inline" aria-hidden="true">/</span>
          </>
        )}
        <span className="truncate font-medium text-foreground">
          {route.page === 'worktree' ? worktreeName(overview, route.wt) : PAGE_TITLES[route.page]}
        </span>
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <RunningIndicator />
        <LocalTicketOrphans />
        <ConnectionStatus />
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          title="Relit chaque PR sur GitHub (CI, commentaires, contrôles, SDK) et les tickets Linear"
          onClick={() => refresh.mutate(current?.id, {
            onSuccess: () => toast('Toutes les PR sont à jour : CI, commentaires, contrôles et SDK.'),
            onError: (e) => toast(e.message, true),
          })}
        >
          {refreshing ? <Spinner /> : <RefreshCwIcon />}
          <span className="hidden sm:inline">Tout actualiser</span>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  )
}

function RunningIndicator() {
  const running = useRunningRuns()
  const agents = useAgents()
  const kill = useKillOrphan()
  const broken = useBrokenWorktrees().data ?? []
  const repair = useRepairWorktree()
  const toast = useToast()
  const list = running.data ?? []
  const orphans = agents.data?.orphans ?? []
  if (!list.length && !orphans.length && !broken.length) return null
  const fix = (b: BrokenWorktree, action: 'restore' | 'remove') => {
    if (action === 'remove' && !confirm(`Supprimer le worktree ${b.path} ?${b.untracked ? ` ${plural(b.untracked, 'fichier non suivi sera perdu', 'fichiers non suivis seront perdus')}.` : ''} La branche est conservée.`)) return
    repair.mutate({ project: b.project, id: b.id, action }, {
      onSuccess: () => toast(action === 'restore' ? 'Fichiers restaurés : le worktree est de nouveau utilisable' : 'Worktree supprimé'),
      onError: (e) => toast(e.message, true),
    })
  }
  const memOf = (id: string) => agents.data?.runs.find((r) => r.runId === id)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(orphans.length || broken.length
          ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400'
          : 'border-blue-500/30 bg-blue-500/5 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-400')}>
          {list.length > 0 && <Spinner />}
          {list.length > 0 ? plural(list.length, 'agent en cours', 'agents en cours') : orphans.length ? plural(orphans.length, 'agent orphelin', 'agents orphelins') : plural(broken.length, 'worktree abîmé', 'worktrees abîmés')}
          {list.length + orphans.length > 0 && broken.length > 0 && <span className="text-xs">· {plural(broken.length, 'worktree abîmé', 'worktrees abîmés')}</span>}
          {!!agents.data?.totalMb && <span className="text-xs opacity-70 tabular-nums">· {agents.data.totalMb} Mo</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)] p-1">
        {list.map((r) => {
          const mem = memOf(r.id)
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
              <a className="min-w-0 flex-1" href={runHref(r.kind, r.scope)}>
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="text-xs text-muted-foreground">
                  {r.scope.project} · lancé à {new Date(r.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  {mem && ` · ${mem.rssMb} Mo, ${plural(mem.processes.length, 'processus', 'processus')}`}
                </span>
              </a>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => cancelRun(r.id)}>
                <SquareIcon className="size-3 fill-current" />Arrêter
              </Button>
            </div>
          )
        })}
        {orphans.length > 0 && (
          <div className="mt-1 border-t pt-1">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Agents sans run (serveur redémarré, arrêt raté) : ils tournent encore et occupent de la mémoire.</p>
            {orphans.map((o) => (
              <div key={o.pgid} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Agent orphelin · groupe {o.pgid}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={o.processes.map((p) => p.command).join('\n')}>
                    {o.rssMb} Mo · {plural(o.processes.length, 'processus', 'processus')} · depuis {o.processes[0]?.elapsed}
                  </span>
                </span>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={kill.isPending}
                  onClick={() => kill.mutate(o.pgid, { onSuccess: () => toast('Agent orphelin arrêté'), onError: (e) => toast(e.message, true) })}>
                  <SquareIcon className="size-3 fill-current" />Tuer
                </Button>
              </div>
            ))}
          </div>
        )}
        {broken.length > 0 && (
          <div className={cn(list.length + orphans.length > 0 && 'mt-1 border-t pt-1')}>
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Worktrees abîmés : dossier disparu, ou à moitié effacé par une suppression interrompue. « Aboutir » et les commits y sont bloqués.</p>
            {broken.map((b) => (
              <div key={`${b.project}:${b.id}`} className="flex flex-col gap-1.5 rounded-md p-2 hover:bg-accent">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" title={b.path}>{b.projectName} · {b.branch ?? b.path.split('/').pop()}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.reason === 'missing' ? 'Dossier disparu, encore enregistré dans git' : `${plural(b.deleted, 'fichier suivi supprimé', 'fichiers suivis supprimés')}`}
                    {b.untracked > 0 && ` · ${plural(b.untracked, 'fichier non suivi', 'fichiers non suivis')} (${b.untrackedSample.join(', ')})`}
                  </span>
                  {b.holders.length > 0 && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400" title={b.holders.map((h) => `${h.pid} ${h.command}`).join('\n')}>
                      Encore utilisé : {[...new Set(b.holders.map((h) => h.command.replace(/^-/, '').split(' ')[0].split('/').pop()))].join(', ')}
                    </span>
                  )}
                </span>
                <span className="flex gap-1">
                  {b.reason === 'half-deleted' && (
                    <Button variant="outline" size="sm" disabled={repair.isPending} onClick={() => fix(b, 'restore')} title="git remet les fichiers suivis : le worktree redevient utilisable, « Aboutir » aussi">
                      <RotateCcwIcon />Restaurer
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={repair.isPending || b.holders.length > 0}
                    title={b.holders.length ? 'Ferme d’abord les processus qui tournent dedans' : 'Supprime le worktree (la branche reste)'} onClick={() => fix(b, 'remove')}>
                    <Trash2Icon />Supprimer
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ---------- Sélecteur de projet ----------

function ProjectSelector({ projects, current, todo }: { projects: Project[]; current?: Project; todo: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent dark:bg-input/30" aria-haspopup="menu">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FolderGit2Icon className="size-4" />
          </div>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{current?.name ?? 'Aucun projet'}</span>
            <span className="truncate text-xs text-muted-foreground">{current ? `${current.team ? `Équipe ${current.team} · ` : ''}${current.baseBranch}` : 'Choisir un projet'}</span>
          </span>
          <Notif n={todo} />
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] max-w-[calc(100vw-2rem)] p-1" role="menu">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Projets</div>
        {projects.map((p) => <ProjectMenuItem key={p.id} project={p} active={p.id === current?.id} onPick={() => setOpen(false)} />)}
        <Separator className="my-1" />
        <a role="menuitem" href={href({ page: 'add-project' })} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent" onClick={() => setOpen(false)}>
          <PlusIcon className="size-4 text-muted-foreground" />Ajouter un projet depuis GitHub
        </a>
      </PopoverContent>
    </Popover>
  )
}

const KIND_LABEL: Record<QueueItem['kind'], [string, string]> = {
  mine: ['PR à moi', 'PR à moi'], review: ['review', 'reviews'], agent: ['agent', 'agents'], branch: ['branche', 'branches'], ticket: ['ticket', 'tickets'],
}

function ProjectMenuItem({ project, active, onPick }: { project: Project; active: boolean; onPick: () => void }) {
  const { items, count, overview } = useQueue(project.id)
  const me = (items ?? []).filter((q) => q.group === 'me')
  const kinds = [...new Set(me.map((q) => q.kind))].map((k) => plural(me.filter((q) => q.kind === k).length, ...KIND_LABEL[k]))
  return (
    <a role="menuitem" href={href({ page: 'overview', project: project.id })} className={cn('flex flex-col gap-1 rounded-md px-2 py-2 hover:bg-accent', active && 'bg-accent')} onClick={onPick}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-medium">{project.name}</span>
        {overview.isLoading ? <Spinner className="size-3.5 text-muted-foreground" /> : <Notif n={count} />}
      </span>
      <span className="text-xs text-muted-foreground">{items ? (kinds.length ? kinds.join(' · ') : 'Rien ne t’attend') : project.repo}</span>
    </a>
  )
}

// ---------- Barre latérale ----------

const SIDEBAR_WIDTH = 'shipyard:sidebarWidth'
const SIDEBAR = { min: 220, max: 520, initial: 288, step: 16 }
const clampSidebar = (w: number) => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(w)))

/** Largeur de la barre latérale (écran large), réglable et mémorisée dans ce navigateur. */
function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(SIDEBAR_WIDTH))
      return v ? clampSidebar(v) : SIDEBAR.initial
    } catch {
      return SIDEBAR.initial
    }
  })
  const set = (w: number) => {
    const next = clampSidebar(w)
    setWidth(next)
    try { localStorage.setItem(SIDEBAR_WIDTH, String(next)) } catch { /* stockage indisponible */ }
  }
  return { width, set }
}

/**
 * Poignée sur le bord droit de la barre latérale : on la tire pour réduire ou agrandir, un double-clic revient à la
 * largeur d'origine, et les flèches gauche / droite la règlent au clavier.
 */
function SidebarResizer({ width, set }: { width: number; set: (w: number) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    // biome-ignore lint/a11y/useSemanticElements: un séparateur réglable n'a pas d'élément HTML dédié.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Largeur de la barre latérale"
      aria-valuemin={SIDEBAR.min}
      aria-valuemax={SIDEBAR.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Tire pour réduire ou agrandir · double-clic pour revenir à la largeur d’origine"
      className={cn('absolute top-0 -right-1 z-40 h-full w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60 focus-visible:after:opacity-60', dragging && 'after:opacity-100')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        // La barre est collée au bord gauche de la fenêtre : la position du pointeur est sa largeur.
        if (dragging) set(e.clientX)
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => set(SIDEBAR.initial)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') set(width - SIDEBAR.step)
        else if (e.key === 'ArrowRight') set(width + SIDEBAR.step)
        else if (e.key === 'Home') set(SIDEBAR.initial)
        else return
        e.preventDefault()
      }}
    />
  )
}


const DOT: Record<QueueTone, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', purple: 'bg-violet-500', blue: 'bg-blue-500', green: 'bg-emerald-500', gray: 'bg-muted-foreground/40',
}

/** Même couleur d'état que la pastille, pour l'icône d'une PR (la mienne ou une review). */
const ICON_TONE: Record<QueueTone, string> = {
  red: 'text-red-500', amber: 'text-amber-500', purple: 'text-violet-500', blue: 'text-blue-500', green: 'text-emerald-500', gray: 'text-muted-foreground',
}

/** Couleur de chaque catégorie de la file, dans la barre latérale : le libellé et le filet qui longe ses worktrees. */
const RAIL: Record<QueueGroup, { text: string; line: string }> = {
  me: { text: 'text-amber-600 dark:text-amber-400', line: 'border-amber-500/50' },
  testing: { text: 'text-fuchsia-600 dark:text-fuchsia-400', line: 'border-fuchsia-500/50' },
  start: { text: 'text-sky-600 dark:text-sky-400', line: 'border-sky-500/50' },
  progress: { text: 'text-emerald-600 dark:text-emerald-400', line: 'border-emerald-500/50' },
  others: { text: 'text-indigo-600 dark:text-indigo-400', line: 'border-indigo-500/50' },
  clean: { text: 'text-teal-600 dark:text-teal-400', line: 'border-teal-500/50' },
  ghost: { text: 'text-muted-foreground', line: 'border-muted-foreground/40' },
}

/** Worktrees d'une même catégorie : libellé de sa couleur, et un filet de la même couleur le long des lignes qui en font partie. */
function RailGroup({ group, label, count, nested = false, children }: { group: QueueGroup; label: string; count: number; /** Sous un menu : un trait relie le libellé au filet du menu. */ nested?: boolean; children: ReactNode }) {
  const c = RAIL[group]
  return (
    <div className="flex shrink-0 flex-col">
      <span className={cn('relative px-2.5 pt-2 pb-1 text-[11px] font-medium', nested && 'pl-3.5 after:absolute after:bottom-[11px] after:left-0 after:h-px after:w-2.5 after:bg-border', c.text)}>{label} <span className="font-normal opacity-70">· {count}</span></span>
      <div className={cn('ml-3 flex flex-col gap-0.5 border-l-2 pl-0.5', c.line)}>{children}</div>
    </div>
  )
}

/** Un worktree sur une ligne : état (couleur de la file), titre, numéro. Épingler au survol. */
function WorktreeRow({ item, projectId, pinned }: { item: QueueItem; projectId: string; pinned: boolean }) {
  const prefetch = usePrefetchWorktree()
  const pins = usePins()
  const route = useRoute()
  const wt = item.worktree!
  const active = route.page === 'worktree' && route.wt === wt
  const warm = () => { void loadWorktreePage(); void prefetch(projectId, wt) }
  // Liste « Prête à merger » dépliable sous la ligne d'une PR : son état en direct, chaque point mène à son onglet.
  const key = `${CHECKLIST_OPEN}:${wt}`
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(key, o ? '0' : '1') } catch { /* stockage indisponible */ }
    return !o
  })
  return (
    <div className="flex flex-col">
      <div className={cn('group/row flex h-8 shrink-0 items-center gap-1 rounded-md pr-1 pl-1 text-[13px] transition-colors hover:bg-accent', active && 'bg-accent font-medium')}>
        {item.prNumber && item.group !== 'clean' ? (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Replier la liste « Prête à merger »' : 'Déplier la liste « Prête à merger »'}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="size-5 shrink-0" aria-hidden />}
        <a href={href({ page: 'worktree', project: projectId, wt })} onMouseEnter={warm} onFocus={warm} aria-current={active ? 'page' : undefined}
          title={[item.kind === 'mine' ? 'Ma PR' : item.kind === 'review' ? 'Review' : null, item.title, ...item.reasons.map((r) => r.label)].filter(Boolean).join(' · ')} className="flex min-w-0 flex-1 items-center gap-2">
          {/* La forme dit ce que c'est (ma PR, une review), la couleur garde l'état de la ligne. */}
          {item.kind === 'mine' ? <GitPullRequestIcon className={cn('size-3.5 shrink-0', ICON_TONE[item.tone])} aria-label="Ma PR" />
            : item.kind === 'review' ? <EyeIcon className={cn('size-3.5 shrink-0', ICON_TONE[item.tone])} aria-label="Review" />
            : <span className={cn('mx-[3px] size-2 shrink-0 rounded-full', DOT[item.tone])} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.ref && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.ref}</span>}
        </a>
        <button
          type="button"
          onClick={() => pins.toggle(projectId, wt)}
          aria-label={pinned ? 'Désépingler' : 'Épingler'}
          className={cn('flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground', !pinned && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}
        >
          {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
        </button>
      </div>
    {open && item.prNumber && item.group !== 'clean' && <div className="mb-1 ml-[22px] border-l pl-1"><ChecklistMini project={projectId} wt={wt} /></div>}
    </div>
  )
}

const WT_OPEN = 'shipyard:sidebarWorktrees'
const FINISHED_OPEN = 'shipyard:sidebarFinished'

/**
 * À aboutir : les worktrees terminés de tous les projets (PR mergée ou fermée, ticket clos), à passer en Done et à supprimer.
 * Une section à part pour les voir d'un coup d'œil, sans les mêler au travail en cours.
 */
function FinishedSection({ projects, current }: { projects: Project[]; current?: string }) {
  const overviews = useProjectOverviews(projects.map((p) => p.id))
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(FINISHED_OPEN) !== '0' } catch { return true }
  })
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(FINISHED_OPEN, o ? '0' : '1') } catch { /* stockage indisponible */ }
    return !o
  })
  const groups = overviews.data
    .map((ov) => ({ project: ov.project, rows: (ov.queue ?? []).filter((q) => q.group === 'clean' && q.worktree) }))
    .filter((g) => g.rows.length)
    // Le projet courant d'abord.
    .sort((a, b) => Number(b.project.id === current) - Number(a.project.id === current))
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (!total) return null
  return (
    <div className="mt-5 flex flex-col gap-0.5">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        À aboutir · {total}
      </button>
      {open && groups.map((g) => (
        <RailGroup key={g.project.id} group="clean" label={g.project.name} count={g.rows.length}>
          {g.rows.map((q) => <WorktreeRow key={q.key} item={q} projectId={g.project.id} pinned={false} />)}
        </RailGroup>
      ))}
    </div>
  )
}
const CHECKLIST_OPEN = 'shipyard:sidebarChecklist'

function Sidebar({ projects, current, todo, loading }: { projects: Project[]; current?: Project; todo: number; loading: boolean }) {
  const route = useRoute()
  const prompts = usePrompts()
  const modified = prompts.data?.filter((p) => p.modified).length ?? 0
  const notes = useNotes()
  const openNotes = notes.data?.filter((n) => !n.done).length ?? 0
  const { items: queue, overview } = useQueue(current?.id)
  const ov = overview.data
  // Lignes de chaque vue, comme les onglets de la page (seule la file a le compteur noir).
  const homeCounts: Record<string, number | undefined> = { tickets: ov?.tickets.filter(isActiveTicket).length, mypr: ov?.myPrs.length, reviews: ov?.reviewPrs.length, ci: ov && [...ov.myPrs, ...ov.reviewPrs].filter((p) => p.ci.failing).length }
  const pins = usePins()
  const [wtOpen, setWtOpen] = useState(() => {
    try { return localStorage.getItem(WT_OPEN) !== '0' } catch { return true }
  })
  const toggleWt = () => setWtOpen((o) => {
    try { localStorage.setItem(WT_OPEN, o ? '0' : '1') } catch { /* stockage indisponible */ }
    return !o
  })
  const rows = (queue ?? []).filter((q) => q.worktree && q.kind !== 'agent')
  // Les terminés ont leur section, « À aboutir » (tous projets).
  const active = rows.filter((r) => r.group !== 'clean')
  const pinnedIds = current ? pins.of(current.id) : []
  const pinned = pinnedIds.map((id) => rows.find((r) => r.worktree === id)).filter((r): r is QueueItem => !!r)
  const groups = useNavGroups(GROUP_OF[route.page] ?? null)
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 p-3">
        <a href="#/" className="flex items-center gap-2.5 px-1.5 pt-1">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShipIcon className="size-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Shipyard</span>
        </a>
        <ProjectSelector projects={projects} current={current} todo={todo} />
        <button type="button" onClick={openPalette} className="flex h-8 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent">
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Aller à…</span>
          <kbd className="rounded border bg-background px-1.5 font-mono text-[11px]">⌘K</kbd>
        </button>
      </div>

      <nav aria-label="Navigation" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {current && (
          <>
            <NavGroup {...groups.of('home')} icon={HouseIcon} label="Accueil" aside={<Notif n={todo} />}>
              {HOME_TABS.map(([tab, label]) => (
                <SubLink key={label} to={href({ page: 'overview', project: current.id, tab })} active={route.page === 'overview' && route.tab === tab} aside={tab ? <span className="text-xs text-muted-foreground tabular-nums">{homeCounts[tab]}</span> : <Notif n={todo} />}>
                  {label}
                </SubLink>
              ))}
            </NavGroup>
            <NavGroup {...groups.of('ticket')} icon={TicketIcon} label="Ticket">
              <SubLink to={href({ page: 'new-ticket', project: current.id })} active={route.page === 'new-ticket'}>Nouveau ticket</SubLink>
              <SubLink to={href({ page: 'precheck', project: current.id })} active={route.page === 'precheck'}>Pre-check</SubLink>
              <SubLink to={href({ page: 'quick', project: current.id })} active={route.page === 'quick'}>Tickets rapides</SubLink>
              <SubLink to={href({ page: 'insights', project: current.id })} active={route.page === 'insights'}>Features & optimisations</SubLink>
            </NavGroup>
          </>
        )}
        <NavGroup {...groups.of('follow')} icon={ChartColumnIcon} label="Suivi" aside={openNotes > 0 && <span className="text-xs text-muted-foreground tabular-nums">{openNotes}</span>}>
          <SubLink to={href({ page: 'notes' })} active={route.page === 'notes'} aside={openNotes > 0 && <span className="text-xs text-muted-foreground tabular-nums">{openNotes}</span>}>Notes</SubLink>
          <SubLink to={href({ page: 'daily' })} active={route.page === 'daily'}>Daily</SubLink>
          <SubLink to={href({ page: 'stats' })} active={route.page === 'stats'}>Stats</SubLink>
        </NavGroup>
        <NavGroup {...groups.of('agents')} icon={BotIcon} label="Agents">
          <SubLink to={href({ page: 'automations' })} active={route.page === 'automations'}>Automatisations</SubLink>
          <SubLink to={href({ page: 'prompts' })} active={route.page === 'prompts'} aside={modified > 0 && <span className="text-xs text-muted-foreground">{plural(modified, 'modifié', 'modifiés')}</span>}>Prompts</SubLink>
        </NavGroup>
        <NavGroup {...groups.of('settings')} icon={SettingsIcon} label="Réglages">
          {SETTINGS_LINKS.map(([section, label]) => (
            <SubLink key={section} to={href({ page: 'settings', section })} active={route.page === 'settings' && route.section === section}>{label}</SubLink>
          ))}
        </NavGroup>

        {current && pinned.length > 0 && (
          <div className="mt-5 flex flex-col gap-0.5">
            <span className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Épinglés</span>
            {pinned.map((q) => <WorktreeRow key={q.key} item={q} projectId={current.id} pinned />)}
          </div>
        )}

        {current && (
          <NavGroup bare className={cn(pinned.length > 0 && 'mt-5')} icon={GitBranchIcon} label={<>Worktrees <span className="font-normal text-muted-foreground">· {active.length}</span></>}
            open={wtOpen} onToggle={toggleWt} current={route.page === 'worktree' || route.page === 'create'}>
            {/* Même filet que les sous-liens des autres menus : on voit que les catégories appartiennent à « Worktrees ». */}
            <div className="ml-[17px] flex shrink-0 flex-col border-l pb-1">
            {loading && <span className="flex items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground"><Spinner className="size-3.5" />Chargement…</span>}
            {QUEUE_GROUPS.filter((g) => g.key !== 'clean').map((g) => {
              const list = rows.filter((r) => r.group === g.key && !pinnedIds.includes(r.worktree!))
              if (!list.length) return null
              return (
                <RailGroup key={g.key} nested group={g.key} label={g.label} count={list.length}>
                  {list.map((q) => <WorktreeRow key={q.key} item={q} projectId={current.id} pinned={false} />)}
                </RailGroup>
              )
            })}
            {queue && !active.length && <p className="px-2.5 py-1 text-xs text-muted-foreground">Aucun worktree pour ce projet.</p>}
            </div>
          </NavGroup>
        )}

        <FinishedSection projects={projects} current={current?.id} />
      </nav>
    </div>
  )
}

/** Cartes de la page Réglages : chaque entrée y mène et la déplie (#/settings/<carte>). */
const SETTINGS_LINKS: [string, string][] = [['appearance', 'Apparence'], ['languages', 'Langues'], ['credentials', 'Connexions'], ['projects', 'Projets suivis'], ['groups', 'Projets liés'], ['labels', 'Labels reconnus'], ['notifications', 'Notifications']]

type NavGroupKey = 'home' | 'ticket' | 'follow' | 'agents' | 'settings'
/** Groupe du menu qui contient chaque page. */
const GROUP_OF: Partial<Record<Route['page'], NavGroupKey>> = {
  overview: 'home',
  'new-ticket': 'ticket', precheck: 'ticket', quick: 'ticket', insights: 'ticket',
  notes: 'follow', daily: 'follow', stats: 'follow',
  automations: 'agents', prompts: 'agents',
  settings: 'settings',
}
const NAV_OPEN = 'shipyard:sidebarMenus'

/**
 * Groupes dépliés du menu : tous pliés par défaut (seul « Worktrees », géré à part, est ouvert), mémorisés dans ce navigateur.
 * Un groupe ne s'ouvre que sur un clic ; plié, celui de la page affichée a son titre en évidence.
 */
function useNavGroups(current: NavGroupKey | null) {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(NAV_OPEN) ?? '[]')
      return Array.isArray(v) ? v.map(String) : []
    } catch {
      return []
    }
  })
  const save = (next: string[]) => {
    try { localStorage.setItem(NAV_OPEN, JSON.stringify(next)) } catch { /* stockage indisponible */ }
    return next
  }
  return {
    of: (key: NavGroupKey) => ({
      open: open.includes(key),
      current: current === key,
      onToggle: () => setOpen((o) => save(o.includes(key) ? o.filter((k) => k !== key) : [...o, key])),
    }),
  }
}

/** Grand titre du menu : un clic plie ou déplie ses entrées, sans changer de page. */
function NavGroup({ icon: IconCmp, label, open, current, onToggle, aside, bare = false, className, children }: {
  icon: LucideIcon
  label: ReactNode
  open: boolean
  current: boolean
  onToggle: () => void
  aside?: ReactNode
  /** Contenu sans le filet des sous-liens : il apporte sa propre mise en page (catégories de worktrees). */
  bare?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex shrink-0 flex-col gap-0.5', className)}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={cn('flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground', current && !open && 'font-medium text-foreground')}>
        <IconCmp className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        {!open && aside}
        <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (bare ? children : <div className="ml-[17px] flex shrink-0 flex-col gap-0.5 border-l pl-2">{children}</div>)}
    </div>
  )
}

/** Vues de l'Accueil d'un projet : les onglets de la page, aussi dans la barre latérale. */
const HOME_TABS: [string | undefined, string][] = [[undefined, 'File d’attente'], ['tickets', 'Tickets'], ['mypr', 'Mes PR'], ['reviews', 'Reviews'], ['ci', 'CI']]

function SubLink({ to, active, children, aside }: { to: string; active: boolean; children: ReactNode; aside?: ReactNode }) {
  return (
    <a href={to} aria-current={active ? 'page' : undefined}
      className={cn('flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground', active && 'bg-accent font-medium text-accent-foreground')}>
      <span className="flex-1 truncate">{children}</span>
      {aside}
    </a>
  )
}
