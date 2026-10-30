import { CalendarDaysIcon, FileTextIcon, FolderGit2Icon, GitBranchIcon, GitPullRequestIcon, InboxIcon, LayoutDashboardIcon, LightbulbIcon, PlusIcon, SearchIcon, SettingsIcon, StickyNoteIcon, TicketIcon, ZapIcon, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectOverview } from '../../../shared/types.ts'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { go, href, type Route } from '../router.ts'
import { useTheme } from '../theme.tsx'
import { worktreeTitle } from '../ui.tsx'
import { isActiveTicket } from '../../../shared/queue.ts'

// ⌘K : aller à n'importe quel worktree, PR, ticket, projet ou page, au clavier.

interface Entry { id: string; label: string; hint: string; group: string; icon: LucideIcon; to: Route | string; keywords: string }

/** Type de cible dans la console : étiquette et couleur. */
const TAG: Record<string, [string, string]> = {
  Worktrees: ['WT', 'text-[#00e5ff]'],
  'Tickets sans worktree': ['TK', 'text-[#ffb020]'],
  Pages: ['GO', 'text-[#3dff9a]'],
  Projets: ['PJ', 'text-[#ff2bd6]'],
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function entries(projects: Project[], current: Project | undefined, ov: ProjectOverview | undefined): Entry[] {
  const out: Entry[] = []
  if (current && ov) {
    for (const w of ov.worktrees) {
      const pr = [...ov.myPrs, ...ov.reviewPrs].find((p) => p.number === w.prNumber)
      out.push({
        id: `wt:${w.id}`, label: pr && !w.merged ? pr.title : worktreeTitle(w, pr), hint: [pr && `#${pr.number}`, w.ticketId, w.branch].filter(Boolean).join(' · '), group: 'Worktrees',
        icon: pr ? GitPullRequestIcon : GitBranchIcon, to: { page: 'worktree', project: current.id, wt: w.id }, keywords: [w.branch, w.ticketId, ov.tickets.find((t) => t.id === w.ticketId)?.title, w.localTicket?.title, pr?.title, pr && `#${pr.number}`, pr?.author].join(' '),
      })
    }
    for (const t of ov.tickets.filter((t) => isActiveTicket(t) && !ov.worktrees.some((w) => w.ticketId === t.id))) {
      out.push({ id: `t:${t.id}`, label: t.title, hint: `${t.id} · ${t.status}`, group: 'Tickets sans worktree', icon: TicketIcon, to: { page: 'create', project: current.id, ticket: t.id }, keywords: t.id })
    }
  }
  const pages: [string, LucideIcon, Route][] = current
    ? [['Accueil · file d’attente', LayoutDashboardIcon, { page: 'overview', project: current.id }], ['Accueil · tickets', TicketIcon, { page: 'overview', project: current.id, tab: 'tickets' }], ['Accueil · mes PR', TicketIcon, { page: 'overview', project: current.id, tab: 'mypr' }], ['Accueil · reviews', TicketIcon, { page: 'overview', project: current.id, tab: 'reviews' }], ['Accueil · CI', TicketIcon, { page: 'overview', project: current.id, tab: 'ci' }], ['Nouveau worktree', PlusIcon, { page: 'create', project: current.id }], ['Features & optimisations', LightbulbIcon, { page: 'insights', project: current.id }]]
    : []
  if (current) pages.push(['Nouveau ticket', PlusIcon, { page: 'new-ticket', project: current.id }])
  pages.push(['Automatisations', ZapIcon, { page: 'automations' }], ['À valider · tous projets', InboxIcon, { page: 'inbox' }], ['Notes', StickyNoteIcon, { page: 'notes' }], ['Daily', CalendarDaysIcon, { page: 'daily' }], ['Prompts', FileTextIcon, { page: 'prompts' }], ['Réglages', SettingsIcon, { page: 'settings' }])
  for (const [label, icon, to] of pages) out.push({ id: `page:${label}`, label, hint: '', group: 'Pages', icon, to, keywords: '' })
  for (const p of projects) out.push({ id: `p:${p.id}`, label: p.name, hint: p.repo, group: 'Projets', icon: FolderGit2Icon, to: { page: 'overview', project: p.id }, keywords: p.repo })
  return out
}

export function CommandPalette({ projects, current, overview }: { projects: Project[]; current?: Project; overview?: ProjectOverview }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const { cyber } = useTheme()
  // Console (thème cyber) : lignes de démarrage qui s'affichent une à une, puis la commande lancée au choix d'une entrée.
  const [boot, setBoot] = useState(0)
  const [launching, setLaunching] = useState<Entry | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('shipyard:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('shipyard:palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQ('')
    setIndex(0)
    setLaunching(null)
    if (!cyber) return
    setBoot(0)
    const timers = [1, 2, 3].map((i) => setTimeout(() => setBoot(i), i * 120))
    return () => timers.forEach(clearTimeout)
  }, [open, cyber])

  const all = useMemo(() => entries(projects, current, overview), [projects, current, overview])
  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    return all.filter((e) => words.every((w) => norm(`${e.label} ${e.hint} ${e.keywords}`).includes(w))).slice(0, 40)
  }, [all, q])

  useEffect(() => setIndex(0), [q])
  useEffect(() => list.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' }), [index])

  const pick = (e: Entry | undefined) => {
    if (!e || launching) return
    const run = () => {
      setOpen(false)
      if (typeof e.to === 'string') location.hash = e.to
      else go(e.to)
    }
    if (!cyber) return run()
    // La console affiche la commande un instant avant de l'exécuter.
    setLaunching(e)
    setTimeout(run, 260)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(shown.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); pick(shown[index]) }
  }

  if (cyber) {
    const counts = { wt: overview?.worktrees.length ?? 0, tickets: overview?.tickets.filter(isActiveTicket).length ?? 0 }
    const lines = [
      'session ouverte · liaison GitHub, Linear et Claude',
      `index chargé : ${counts.wt} worktrees · ${counts.tickets} tickets en cours · ${projects.length} projets`,
      'prêt. tape pour filtrer, entrée pour ouvrir.',
    ]
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="cyber-crt top-[12%] translate-y-0 gap-0 overflow-hidden rounded-none border-[#00e5ff]/60 bg-[#020207] p-0 font-mono text-[13px] text-[#c8f7ff] shadow-[0_0_48px_-8px_rgba(0,229,255,0.6)] sm:max-w-2xl">
          <DialogTitle className="sr-only">Console Shipyard</DialogTitle>
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.035)_0_1px,transparent_1px_3px)]" />
          <div className="flex h-8 items-center gap-3 border-b border-[#00e5ff]/25 bg-[#00e5ff]/5 px-3 text-[11px] tracking-[0.14em] text-[#00e5ff]/80">
            <span className="flex gap-1.5" aria-hidden><span className="size-2 bg-[#ff2bd6]" /><span className="size-2 bg-[#ffb020]" /><span className="size-2 bg-[#00e5ff]" /></span>
            <span>{'SHIPYARD//TERMINAL'}</span>
            <span className="text-[#00e5ff]/45">tty0 · {current?.name ?? 'global'}</span>
            <span className="ml-auto text-[#00e5ff]/45">ESC</span>
          </div>
          <div className="flex flex-col gap-0.5 px-3 pt-2.5 text-[12px] text-[#00e5ff]/55">
            {lines.slice(0, boot).map((l) => <p key={l} className="cyber-line"><span className="text-[#3dff9a]">[ ok ]</span> {l}</p>)}
          </div>
          <label className="flex items-center gap-2 px-3 py-2.5">
            <span className="shrink-0 text-[#ff2bd6]">shipyard@{current?.id ?? 'local'}</span>
            <span className="shrink-0 text-[#00e5ff]/60">:~$</span>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="open …"
              aria-label="Rechercher"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[#eaffff] caret-[#00e5ff] outline-none placeholder:text-[#00e5ff]/30"
            />
          </label>
          <div ref={list} role="listbox" className="max-h-[min(380px,55vh)] overflow-y-auto border-t border-[#00e5ff]/15 py-1">
            {!shown.length && <p className="px-3 py-4 text-[#ff3d6e]">erreur : aucune cible ne correspond à « {q} »</p>}
            {shown.map((e, i) => {
              const tag = TAG[e.group] ?? ['··', 'text-[#8390b8]']
              const on = i === index
              return (
                <a
                  key={e.id}
                  role="option"
                  aria-selected={on}
                  data-i={i}
                  href={typeof e.to === 'string' ? e.to : href(e.to)}
                  onMouseMove={() => setIndex(i)}
                  onClick={(ev) => { ev.preventDefault(); pick(e) }}
                  className={cn('grid grid-cols-[14px_28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5', on ? 'bg-[#00e5ff] text-[#020207]' : 'text-[#c8f7ff]')}
                >
                  <span aria-hidden>{on ? '▶' : ''}</span>
                  <span className={cn('text-[11px] font-semibold', on ? 'text-[#020207]' : tag[1])}>{tag[0]}</span>
                  <span className="truncate">{e.label}</span>
                  {e.hint && <span className={cn('max-w-[240px] truncate text-[11px]', on ? 'text-[#020207]/70' : 'text-[#00e5ff]/40')}>{e.hint}</span>}
                </a>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#00e5ff]/20 px-3 py-2 text-[11px] text-[#00e5ff]/50">
            {launching
              ? <span className="text-[#eaffff]">&gt; exec open « {launching.label} » <span className="cyber-caret" aria-hidden /></span>
              : <><span>{shown.length} cible{shown.length > 1 ? 's' : ''}</span><span>↑↓ naviguer</span><span>⏎ ouvrir</span><span>esc quitter</span><span className="ml-auto cyber-caret" aria-hidden /></>}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Aller à</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Worktree, PR, ticket, page…"
            aria-label="Rechercher"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">esc</kbd>
        </div>
        <div ref={list} role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          {!shown.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun résultat</p>}
          {shown.map((e, i) => (
            <div key={e.id}>
              {(i === 0 || shown[i - 1].group !== e.group) && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{e.group}</div>}
              <a
                role="option"
                aria-selected={i === index}
                data-i={i}
                href={typeof e.to === 'string' ? e.to : href(e.to)}
                onMouseMove={() => setIndex(i)}
                onClick={(ev) => { ev.preventDefault(); pick(e) }}
                className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm', i === index && 'bg-accent')}
              >
                <e.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.hint && <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted-foreground">{e.hint}</span>}
              </a>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Ouvre la palette depuis un bouton (barre latérale). */
export const openPalette = () => window.dispatchEvent(new Event('shipyard:palette'))
