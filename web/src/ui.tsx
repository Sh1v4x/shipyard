import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  CodeIcon,
  ExternalLinkIcon,
  HistoryIcon,
  FolderIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import type { CheckState, RunEvent, RunSummary, Severity, TicketStatusType } from '../../shared/types.ts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge as UiBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { go } from './router.ts'

export type Tone = 'amber' | 'green' | 'red' | 'gray' | 'blue' | 'purple'

export const Badge = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <UiBadge variant={tone} className={className}>{children}</UiBadge>
)

export const Notif = ({ n }: { n: number }) =>
  n > 0 ? (
    <span data-slot="notif" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
      {n}
      <span className="sr-only"> à faire</span>
    </span>
  ) : null

export const Spinner = ({ className }: { className?: string }) => <Loader2Icon className={cn('size-4 shrink-0 animate-spin', className)} aria-hidden="true" />

export function Status({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
      <Spinner />
      {children}
    </div>
  )
}

export function Empty({ title, children, action, icon: IconCmp }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      {IconCmp && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconCmp className="size-5" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export const ErrorBox = ({ error }: { error: unknown }) =>
  error ? (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription className="whitespace-pre-wrap break-words">{error instanceof Error ? error.message : String(error)}</AlertDescription>
    </Alert>
  ) : null

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <Alert variant="success">
      <CheckCircle2Icon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`
  if (s < 172800) return 'hier'
  return `il y a ${Math.round(s / 86400)} j`
}

// ---------- Icônes ----------

const icons = {
  plus: PlusIcon,
  play: PlayIcon,
  pencil: PencilIcon,
  check: CheckIcon,
  refresh: RefreshCwIcon,
  chevron: ChevronRightIcon,
  down: ChevronDownIcon,
  code: CodeIcon,
  folder: FolderIcon,
  grid: LayoutDashboardIcon,
  stop: SquareIcon,
  ext: ExternalLinkIcon,
  branch: GitBranchIcon,
  x: XIcon,
} as const

/** Raccourci vers les icônes Lucide les plus courantes du panel. Pour les autres, importer directement depuis lucide-react. */
export function Icon({ name, size = 16, className }: { name: keyof typeof icons; size?: number; className?: string }) {
  const Cmp = icons[name]
  return <Cmp aria-hidden="true" className={cn('shrink-0', className)} style={{ width: size, height: size }} />
}

/** « ⋯ » d'un en-tête, toujours en fin de rangée : les prompts utilisés par les actions de la zone, à modifier dans la page Prompts. */
export function PromptMenu({ items }: { items: [key: string, label: string][] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="order-last" aria-label="Plus d’options"><EllipsisIcon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Modifier le prompt</DropdownMenuLabel>
        {items.map(([k, label]) => (
          <DropdownMenuItem key={k} onSelect={() => go({ page: 'prompts', key: k })}><PencilIcon />{label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Label GitHub : contour neutre et pastille de sa couleur. La couleur pleine reste réservée aux états
 * (CI, conflits, commentaires), pour que l'urgence se lise au premier coup d'œil.
 */
export function Label({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-full border bg-background px-2 text-[11px] font-medium leading-4 whitespace-nowrap text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full" style={{ background: `#${color}` }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  )
}

export { awaitsReview, labelWithRole, needsChanges, needsTesting, reviewersToRerequest } from '../../shared/review.ts'

/** État de review d'une PR, comme le badge GitHub. */
/** Nom d'un worktree : le titre de la PR pour une review (la branche review/pr-N ne dit rien), sinon la branche. */
export const worktreeTitle = (w: { kind?: string | null; branch: string | null; head: string; merged?: { title: string } | null }, pr?: { title: string } | null) =>
  (w.kind === 'review' && (pr?.title || w.merged?.title)) || w.branch || w.head.slice(0, 7)

export function prReviewBadge(pr: { isDraft: boolean; reviewDecision: string | null }): { label: string; tone: Tone } {
  if (pr.isDraft) return { label: 'Draft', tone: 'gray' }
  if (pr.reviewDecision === 'APPROVED') return { label: 'Approuvée', tone: 'green' }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { label: 'Changements demandés', tone: 'red' }
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return { label: 'Review requise', tone: 'amber' }
  return { label: 'Ouverte', tone: 'blue' }
}

// ---------- Correspondances d'états ----------

export const ticketTone = (t: TicketStatusType): Tone => (t === 'started' ? 'amber' : t === 'completed' ? 'green' : 'gray')
/** Couleur de la pastille d'un statut de ticket, lisible en clair comme en sombre. */
export const ticketDot = (t: TicketStatusType) =>
  ({ started: '#f59e0b', completed: '#10b981', unstarted: '#a1a1aa', backlog: '#71717a', triage: '#71717a', canceled: '#52525b' })[t]
export const ciTone = (s: CheckState | 'none'): Tone => (s === 'pass' ? 'green' : s === 'fail' ? 'red' : s === 'running' || s === 'pending' ? 'amber' : 'gray')
export const ciLabel: Record<CheckState, string> = { pass: 'Réussi', fail: 'Échec', running: 'En cours', pending: 'En attente', skipped: 'Ignoré' }
export const sevTone: Record<Severity, Tone> = { bloquant: 'red', important: 'amber', suggestion: 'blue' }
export const sevLabel: Record<Severity, string> = { bloquant: 'Bloquant', important: 'Important', suggestion: 'Suggestion' }

/** Pastille de couleur ronde (statut, état d'un worktree…). */
export const Dot = ({ color, className }: { color: string; className?: string }) => (
  <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} aria-hidden="true" />
)

/** Titre de section en petites capitales discrètes. */
export const SectionLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn('mb-2 block text-xs font-medium text-muted-foreground', className)}>{children}</span>
)

/** Initiales d'un auteur GitHub dans un rond ; `ai` pour une note de l'agent. */
export function Avatar({ login, ai, size = 'md' }: { login?: string; ai?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-[11px]',
        ai ? 'bg-primary text-primary-foreground' : 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
      )}
      aria-hidden="true"
    >
      {ai ? 'IA' : login?.slice(0, 2).toUpperCase()}
    </span>
  )
}

/** Bouton de filtre arrondi (choix exclusif dans une rangée). */
export function Pill({ active, children, className, ...props }: { active: boolean; children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:bg-input/30',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// ---------- Journal d'un run ----------

/**
 * Journal d'un run. Suit les nouvelles lignes tant qu'on est en bas ; si on remonte pour lire, il ne bouge plus
 * et propose de revenir en bas quand de nouvelles lignes arrivent.
 */
export function RunLog({ events, max = 400 }: { events: RunEvent[]; max?: number }) {
  const shown = events.slice(-max)
  const box = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [behind, setBehind] = useState(false)
  const toBottom = () => {
    const el = box.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    follow.current = true
    setBehind(false)
  }
  // Avant l'affichage : la nouvelle ligne apparaît déjà en bas, sans saut visible.
  useLayoutEffect(() => {
    if (follow.current) toBottom()
    else setBehind(true)
  }, [events.length])
  const onScroll = () => {
    const el = box.current
    if (!el) return
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (follow.current) setBehind(false)
  }
  return (
    <div className="relative">
      <div ref={box} onScroll={onScroll} className="max-h-[360px] overflow-auto rounded-lg bg-terminal px-4 py-3 font-mono text-xs leading-relaxed text-terminal-foreground" aria-live="polite">
        {shown.map((e, i) => {
          const sub = 'sub' in e && e.sub ? <span className="text-sky-300">[{e.sub}] </span> : null
          if (e.t === 'tool') return <div key={i}>{sub}<span className="text-amber-300">› {e.name}</span> <span className="text-zinc-400">{e.summary}</span></div>
          if (e.t === 'error') return <div key={i} className="text-red-400">✗ {e.text}</div>
          if (e.t === 'info') return <div key={i} className="text-emerald-400">✓ {e.text}</div>
          if (e.t === 'progress') return null
          return <div key={i} className="whitespace-pre-wrap">{sub}{e.text}</div>
        })}
        {shown.length === 0 && <div className="text-zinc-400">En attente de la sortie de claude…</div>}
      </div>
      {behind && (
        <button type="button" onClick={toBottom} className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-md border border-white/15 bg-zinc-800/90 px-2.5 py-1 font-sans text-xs text-zinc-100 shadow-md hover:bg-zinc-700">
          <ChevronDownIcon className="size-3.5" />Nouvelles lignes
        </button>
      )}
    </div>
  )
}

/** État d'un run : en cours (avec Arrêter), terminé, échoué. Le journal se déplie à la demande. */
/** Ce que useLatestRun / useAction donnent au panneau : versions précédentes et relance. */
export interface RunPanelAction {
  history: RunSummary[]
  setId: (id: string | null) => void
  retry?: () => Promise<void>
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: 'En cours', tone: 'blue' },
  success: { label: 'Terminé', tone: 'green' },
  cancelled: { label: 'Arrêté', tone: 'gray' },
  error: { label: 'Échec', tone: 'red' },
}

const runDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function RunPanel({ id, events, running, run, label, defaultOpen = false, onStop, action }: {
  id: string | null
  events: RunEvent[]
  running: boolean
  run: { status: string; costUsd: number | null; startedAt: string } | null
  label: string
  defaultOpen?: boolean
  onStop: (id: string) => void
  /** Historique et relance : passer l'objet renvoyé par useAction / useLatestRun. */
  action?: RunPanelAction
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [retrying, setRetrying] = useState(false)
  if (!id) return null
  const status = running ? 'running' : run?.status
  const history = action?.history ?? []
  const index = history.findIndex((r) => r.id === id)
  const older = index > 0
  // Échec ou interruption : la dernière version réussie reste consultable (ex. plan d'avant le redémarrage).
  const lastGood = status && status !== 'success' && !running ? history.slice(Math.max(index, 0) + 1).find((r) => r.status === 'success') : undefined
  // Avancement (ex. commentaires corrigés) : compteur, et temps restant estimé au rythme actuel.
  const progress = events.findLast((e) => e.t === 'progress')
  const startAt = events.find((e) => e.t === 'progress')?.at
  const left = running && progress && progress.done > 0 && startAt && progress.done < progress.total
    ? Math.ceil(((Date.now() - startAt) / progress.done) * (progress.total - progress.done) / 60_000)
    : null
  const retry = action?.retry && (async () => {
    setRetrying(true)
    try { await action.retry!() } finally { setRetrying(false) }
  })
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          {running ? <span className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400"><Spinner />{label}…</span>
            : status === 'success' ? <Badge tone="green"><CheckIcon />Terminé</Badge>
            : status === 'cancelled' ? <Badge tone="gray">Arrêté</Badge>
            : <Badge tone="red">Échec</Badge>}
          {run?.costUsd != null && <span className="text-xs text-muted-foreground">≈ {run.costUsd.toFixed(2)} $ en équivalent API · {ago(run.startedAt)}</span>}
          {older && <Badge tone="amber">Ancienne version · {runDate(history[index].startedAt)}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {history.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm"><HistoryIcon />Versions · {history.length}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Afficher une version précédente</DropdownMenuLabel>
                {history.map((r, i) => (
                  <DropdownMenuItem key={r.id} onSelect={() => action!.setId(i === 0 ? null : r.id)} className={cn('flex items-center gap-2', r.id === id && 'bg-accent')}>
                    <span className="flex-1 truncate text-xs">{runDate(r.startedAt)}{i === 0 && ' · dernière'}</span>
                    <Badge tone={RUN_STATUS[r.status]?.tone ?? 'gray'}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {older && <Button variant="ghost" size="sm" onClick={() => action!.setId(null)}>Revenir à la dernière</Button>}
          {!running && retry && (
            <Button variant={status === 'success' ? 'ghost' : 'outline'} size="sm" disabled={retrying} onClick={retry} title="Relance la même action avec les mêmes paramètres">
              {retrying ? <Spinner /> : <RotateCcwIcon />}Relancer
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            <ChevronRightIcon className={cn('transition-transform', open && 'rotate-90')} />
            {open ? 'Masquer le journal' : 'Voir le journal'}
          </Button>
          {running && <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onStop(id)}><SquareIcon className="size-3 fill-current" />Arrêter</Button>}
        </div>
      </div>
      {progress && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{progress.done} / {progress.total}</span>
          <span>{progress.label}</span>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {left != null && <span>≈ {left} min restantes</span>}
        </div>
      )}
      {lastGood && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm">
          <span className="flex-1">La version réussie du {runDate(lastGood.startedAt)} est toujours disponible.</span>
          <Button variant="outline" size="sm" onClick={() => action!.setId(lastGood.id)}><HistoryIcon />L’afficher</Button>
        </div>
      )}
      {(open || (status === 'error' && !running)) && <RunLog events={events} />}
    </div>
  )
}

// ---------- Toasts ----------

const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null)
  const show = useCallback((msg: string, err = false) => setT({ msg, err }), [])
  useEffect(() => {
    if (!t) return
    const id = setTimeout(() => setT(null), t.err ? 9000 : 5000)
    return () => clearTimeout(id)
  }, [t])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div
          role="status"
          className={cn(
            'fixed right-4 bottom-4 z-[60] flex max-w-[min(420px,calc(100vw-2rem))] animate-in items-start gap-3 rounded-lg border bg-popover py-3 pr-2 pl-4 text-sm text-popover-foreground shadow-lg fade-in-0 slide-in-from-bottom-2',
            t.err && 'border-red-500/40',
          )}
        >
          {t.err ? <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
          <span className="break-words">{t.msg}</span>
          <Button variant="ghost" size="icon-sm" className="-my-1 size-7" onClick={() => setT(null)} aria-label="Fermer"><XIcon /></Button>
        </div>
      )}
    </ToastCtx.Provider>
  )
}
