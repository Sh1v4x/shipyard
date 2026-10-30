import { useMemo, useState } from 'react'
import type { BranchDeleteResult, BranchInfo, Project, WorktreeCleanupInfo } from '../../../shared/types.ts'
import { ChevronRightIcon, FolderIcon, GitBranchIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useCleanupWorktrees, useDeleteBranches, useRefreshMyBranches } from '../data/mutations.ts'
import { useMyBranches, useProjects, useWorktreeCleanup } from '../data/queries.ts'
import { Badge, ErrorBox, Spinner, ago, plural, useToast, type Tone } from '../ui.tsx'

const SUGGESTION: Record<BranchInfo['suggestion'], { label: string; tone: Tone }> = {
  'delete-merged': { label: 'Mergée', tone: 'green' },
  'delete-closed': { label: 'PR fermée', tone: 'gray' },
  stale: { label: 'Inactive > 1 mois', tone: 'amber' },
  keep: { label: 'À garder', tone: 'blue' },
}

type Filter = 'all' | BranchInfo['suggestion']

const TONE_TEXT: Record<Tone, string> = {
  green: 'text-emerald-600 dark:text-emerald-400',
  gray: 'text-muted-foreground',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  red: 'text-red-600 dark:text-red-400',
  purple: 'text-violet-600 dark:text-violet-400',
}

export function AutomationsPage() {
  const projects = useProjects().data ?? []
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automatisations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Scripts de maintenance de tous les projets : worktrees et branches à nettoyer. Chaque action affiche ce qu’elle va faire avant de le faire.</p>
      </div>
      {projects.map((project) => (
        <section key={project.id} className="flex flex-col gap-3" aria-label={project.name}>
          <h2 className="flex items-baseline gap-2 text-base font-semibold">{project.name}<span className="font-mono text-xs font-normal text-muted-foreground">{project.repo}</span></h2>
          <Section id={`${project.id}:worktrees`} icon={FolderIcon} title="Nettoyage des worktrees" summary="Worktrees dont le ticket est terminé, la PR mergée ou fermée, la review envoyée, ou inactifs depuis un mois.">
            <WorktreeCleanup project={project} />
          </Section>
          <Section id={`${project.id}:branches`} icon={GitBranchIcon} title="Nettoyage des branches" summary="Tes branches mergées, fermées ou inactives, en local et sur GitHub.">
            <BranchCleanup project={project} />
          </Section>
        </section>
      ))}
    </div>
  )
}

/** Carte repliable, pliée par défaut. Son contenu (et donc ses requêtes) n'est chargé qu'à l'ouverture. */
function Section({ id, icon: IconCmp, title, summary, children }: { id: string; icon: LucideIcon; title: string; summary: string; children: React.ReactNode }) {
  const key = `devpanel:automation:${id}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setOpen(!open)
    try { localStorage.setItem(key, open ? '0' : '1') } catch { /* stockage indisponible */ }
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-label={title}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-accent/50">
        <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconCmp className="size-4" />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="text-sm text-muted-foreground">{summary}</span>
        </span>
      </button>
      {open && <div className="border-t">{children}</div>}
    </section>
  )
}

function BranchCleanup({ project }: { project: Project }) {
  const q = useMyBranches(project.id)
  const reload = useRefreshMyBranches(project.id)
  const del = useDeleteBranches(project.id)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [local, setLocal] = useState(true)
  const [remote, setRemote] = useState(true)
  const busy = del.isPending
  const [results, setResults] = useState<BranchDeleteResult[] | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  const toast = useToast()

  const all = q.data ?? []
  const branches = all.filter((b) => b.mine)
  const others = all.filter((b) => !b.mine)
  const deletable = (b: BranchInfo) => b.mine && !b.protected && b.pr?.state !== 'OPEN'
  const counts = useMemo(() => {
    const c = { 'delete-merged': 0, 'delete-closed': 0, stale: 0, keep: 0 } as Record<BranchInfo['suggestion'], number>
    for (const b of branches) c[b.suggestion]++
    return c
  }, [branches])
  const shown = [...branches.filter((b) => filter === 'all' || b.suggestion === filter), ...(showOthers && filter === 'all' ? others : [])]
  const unpushedSelected = branches.filter((b) => selected.has(b.name) && b.unpushed > 0)
  const dirtySelected = branches.filter((b) => selected.has(b.name) && b.dirty > 0)
  const lostCommits = unpushedSelected.reduce((a, b) => a + b.unpushed, 0)
  const lostFiles = dirtySelected.reduce((a, b) => a + b.dirty, 0)

  const toggle = (name: string) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(name)) n.delete(name)
    else n.add(name)
    return n
  })
  const selectBy = (fn: (b: BranchInfo) => boolean) => setSelected(new Set(branches.filter((b) => deletable(b) && fn(b)).map((b) => b.name)))

  const remove = async () => {
    const names = [...selected]
    const what = [local && 'locales', remote && 'distantes (GitHub)'].filter(Boolean).join(' et ')
    const losses = [lostCommits && plural(lostCommits, 'commit non poussé', 'commits non poussés'), lostFiles && plural(lostFiles, 'fichier non commité', 'fichiers non commités')].filter(Boolean).join(' et ')
    if (!confirm(`Supprimer ${plural(names.length, 'branche', 'branches')} ${what} ?${losses ? `\n\n⚠ ${losses} seront définitivement perdus.` : ''}`)) return
    // discard : l'avertissement ci-dessus et la confirmation valent accord pour abandonner le travail non sauvegardé.
    del.mutate({ names, local, remote, discard: true }, {
      onSuccess: (r) => {
        setResults(r)
        setSelected(new Set())
        toast(`${r.filter((x) => x.ok).length} supprimée(s), ${r.filter((x) => !x.ok).length} en échec`)
      },
      onError: (e) => toast(e.message, true),
    })
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Uniquement tes branches : celles dont tu as écrit le premier commit (avec ton compte GitHub ou tes adresses git), ou qui portent une de tes PR. Les branches de base, celles avec une PR ouverte et celle du clone principal sont protégées.
        </p>
        <Button variant="outline" size="sm" disabled={q.isFetching || reload.isPending} onClick={() => reload.mutate(undefined, { onError: (e) => toast(e.message, true) })}>
          {q.isFetching || reload.isPending ? <Spinner /> : <RefreshCwIcon />}git fetch et actualiser
        </Button>
      </div>

      {q.isLoading && <div className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground"><Spinner />Analyse des branches…</div>}
      {q.error && <div className="px-4 pb-4"><ErrorBox error={q.error} /></div>}

      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
            {(['delete-merged', 'delete-closed', 'stale', 'keep'] as const).map((k) => (
              <button type="button"
                key={k}
                aria-pressed={filter === k}
                onClick={() => setFilter(filter === k ? 'all' : k)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/50 dark:bg-input/20',
                  filter === k && 'border-primary ring-1 ring-primary',
                )}
              >
                <span className={cn('text-2xl font-semibold tabular-nums', counts[k] ? TONE_TEXT[SUGGESTION[k].tone] : 'text-muted-foreground/60')}>{counts[k]}</span>
                <span className="text-sm font-medium">{SUGGESTION[k].label}</span>
                <span className="text-xs text-muted-foreground">{k === 'delete-merged' ? 'PR mergée ou contenue dans la base' : k === 'delete-closed' ? 'PR fermée sans merge' : k === 'stale' ? 'Aucun commit depuis 30 jours' : 'Active ou protégée'}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-y bg-muted/40 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Sélectionner :</span>
              <Button variant="outline" size="sm" onClick={() => selectBy((b) => b.suggestion === 'delete-merged')}>Mergées</Button>
              <Button variant="outline" size="sm" onClick={() => selectBy((b) => b.suggestion === 'delete-merged' || b.suggestion === 'delete-closed')}>Mergées + fermées</Button>
              <Button variant="outline" size="sm" onClick={() => selectBy((b) => b.suggestion !== 'keep')}>Tout ce qui est suggéré</Button>
              {selected.size > 0 && <Button variant="link" size="sm" onClick={() => setSelected(new Set())}>Tout désélectionner</Button>}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <FieldLabel className="font-normal"><Checkbox checked={local} onCheckedChange={(v) => setLocal(v === true)} />Locales</FieldLabel>
              <FieldLabel className="font-normal"><Checkbox checked={remote} onCheckedChange={(v) => setRemote(v === true)} />Distantes</FieldLabel>
              <Button variant="destructive" size="sm" disabled={busy || selected.size === 0 || (!local && !remote)} onClick={remove}>
                {busy ? <Spinner /> : <Trash2Icon />}Supprimer {selected.size ? plural(selected.size, 'branche', 'branches') : 'la sélection'}
              </Button>
            </div>
          </div>
          {(unpushedSelected.length > 0 || dirtySelected.length > 0) && (
            <div className="px-4 pt-3">
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Du travail non sauvegardé sera perdu à la suppression.</AlertTitle>
                <AlertDescription>
                  {unpushedSelected.length > 0 && (
                    <div>
                      {plural(lostCommits, 'commit jamais poussé sera abandonné', 'commits jamais poussés seront abandonnés')} :
                      {unpushedSelected.map((b) => <div key={b.name} className="font-mono text-xs">· {b.name} ({b.unpushed})</div>)}
                    </div>
                  )}
                  {dirtySelected.length > 0 && (
                    <div>
                      {plural(lostFiles, 'fichier non commité sera abandonné', 'fichiers non commités seront abandonnés')} dans les worktrees :
                      {dirtySelected.map((b) => <div key={b.name} className="font-mono text-xs">· {b.name} ({b.dirty})</div>)}
                    </div>
                  )}
                  <div className="text-xs">Pour garder ce travail, pousse ou commite d’abord, ou retire ces branches de la sélection.</div>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {results?.some((r) => !r.ok) && (
            <div className="flex flex-col gap-1 px-4 pt-3">
              {results.filter((r) => !r.ok).map((r) => <div key={r.name} className="text-xs text-red-600 dark:text-red-400">✗ {r.name} : {r.error}</div>)}
            </div>
          )}

          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10"><span className="sr-only">Sélection</span></TableHead>
                <TableHead>Branche</TableHead><TableHead>Créée par</TableHead><TableHead>Suggestion</TableHead><TableHead>PR</TableHead><TableHead>Dernier commit</TableHead><TableHead>Écart avec {project.baseBranch}</TableHead><TableHead>Où</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((b) => {
                const s = SUGGESTION[b.suggestion]
                const can = deletable(b)
                return (
                  <TableRow key={b.name} data-state={selected.has(b.name) ? 'selected' : undefined} className={cn(!b.mine && 'opacity-60')}>
                    <TableCell><Checkbox aria-label={`Sélectionner ${b.name}`} disabled={!can} checked={selected.has(b.name)} onCheckedChange={() => toggle(b.name)} /></TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono text-xs font-medium break-all">{b.name}</span>
                      <span className="block text-xs text-muted-foreground">{b.lastCommitSubject.slice(0, 80)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{b.mine ? <strong className="font-semibold">{b.creator}</strong> : b.creator}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {b.mine ? <Badge tone={s.tone}>{s.label}</Badge> : <Badge tone="gray">Pas à toi</Badge>}
                        {b.protected && <Badge tone="gray">Protégée</Badge>}
                        {b.unpushed > 0 && <Badge tone="red">{plural(b.unpushed, 'commit non poussé', 'commits non poussés')}</Badge>}
                        {b.dirty > 0 && <Badge tone="red">{plural(b.dirty, 'fichier non commité', 'fichiers non commités')}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {b.pr ? <a className="hover:underline" href={b.pr.url} target="_blank" rel="noreferrer">#{b.pr.number} · {b.pr.state === 'OPEN' ? 'ouverte' : b.pr.state === 'MERGED' ? `mergée ${b.pr.mergedAt ? ago(b.pr.mergedAt) : ''}` : 'fermée'}</a> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ago(b.lastCommitAt)}</TableCell>
                    <TableCell className="font-mono text-xs"><span className="text-emerald-600 dark:text-emerald-400">↑{b.ahead}</span> <span className="text-muted-foreground">↓{b.behind}</span></TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {b.local && <Badge tone="gray">locale</Badge>}
                        {b.remote && <Badge tone="gray">GitHub</Badge>}
                        {b.worktree && <Badge tone="purple">worktree</Badge>}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {others.length > 0 && (
            <div className="border-t px-4 pt-2">
              <Button variant="link" size="sm" className="px-0" onClick={() => setShowOthers(!showOthers)}>
                {showOthers ? 'Masquer' : 'Afficher'} les {others.length} branches créées par d’autres personnes (lecture seule)
              </Button>
            </div>
          )}
          <p className="px-4 pt-2 pb-4 text-xs text-muted-foreground">
            ↑ commits absents de {project.baseBranch} · ↓ commits de {project.baseBranch} absents de la branche. Une branche squash-mergée garde des ↑ : c’est la PR mergée qui fait foi.
          </p>
        </>
      )}
    </div>
  )
}

const WT_SUGGESTION: Record<WorktreeCleanupInfo['suggestion'], { label: string; tone: Tone }> = {
  'pr-merged': { label: 'PR mergée', tone: 'green' },
  'pr-closed': { label: 'PR fermée', tone: 'gray' },
  'ticket-done': { label: 'Ticket terminé', tone: 'green' },
  'review-done': { label: 'Review envoyée', tone: 'purple' },
  stale: { label: 'Inactif > 1 mois', tone: 'amber' },
  keep: { label: 'À garder', tone: 'blue' },
}

function WorktreeCleanup({ project }: { project: Project }) {
  const q = useWorktreeCleanup(project.id)
  const cleanup = useCleanupWorktrees(project.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteBranch, setDeleteBranch] = useState(false)
  const busy = cleanup.isPending
  const [results, setResults] = useState<BranchDeleteResult[] | null>(null)
  const toast = useToast()

  const list = q.data ?? []
  const suggested = list.filter((w) => w.suggestion !== 'keep')
  const chosen = list.filter((w) => selected.has(w.path))
  const lostFiles = chosen.reduce((a, w) => a + w.dirty, 0)
  const lostCommits = deleteBranch ? chosen.reduce((a, w) => a + w.unpushed, 0) : 0
  const openPrs = chosen.filter((w) => w.pr?.state === 'OPEN' && w.pr.mine)

  const toggle = (path: string) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(path)) n.delete(path)
    else n.add(path)
    return n
  })

  const remove = async () => {
    const losses = [lostFiles && plural(lostFiles, 'fichier non commité', 'fichiers non commités'), lostCommits && plural(lostCommits, 'commit non poussé', 'commits non poussés')].filter(Boolean).join(' et ')
    if (!confirm(`Supprimer ${plural(chosen.length, 'worktree', 'worktrees')}${deleteBranch ? ' et leur branche locale' : ''} ?${losses ? `\n\n⚠ ${losses} seront définitivement perdus.` : ''}`)) return
    cleanup.mutate({ paths: [...selected], discard: true, deleteBranch }, {
      onSuccess: (r) => {
        setResults(r)
        setSelected(new Set())
        toast(`${r.filter((x) => x.ok).length} supprimé(s), ${r.filter((x) => !x.ok).length} en échec`)
      },
      onError: (e) => toast(e.message, true),
    })
  }

  if (q.isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner />Analyse des worktrees…</div>
  if (!q.data) return <div className="p-4"><ErrorBox error={q.error} /></div>

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b bg-muted/40 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{plural(list.length, 'worktree', 'worktrees')} · {suggested.length} à nettoyer</span>
          <Button variant="outline" size="sm" disabled={!suggested.length} onClick={() => setSelected(new Set(suggested.map((w) => w.path)))}>Sélectionner les suggestions</Button>
          {selected.size > 0 && <Button variant="link" size="sm" onClick={() => setSelected(new Set())}>Tout désélectionner</Button>}
          <Button variant="outline" size="sm" disabled={q.isFetching} onClick={() => q.refetch()}>{q.isFetching ? <Spinner /> : <RefreshCwIcon />}Actualiser</Button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <FieldLabel className="font-normal"><Checkbox checked={deleteBranch} onCheckedChange={(v) => setDeleteBranch(v === true)} />Supprimer aussi la branche locale</FieldLabel>
          <Button variant="destructive" size="sm" disabled={busy || selected.size === 0} onClick={remove}>
            {busy ? <Spinner /> : <Trash2Icon />}Supprimer {selected.size ? plural(selected.size, 'worktree', 'worktrees') : 'la sélection'}
          </Button>
        </div>
      </div>

      {(lostFiles > 0 || lostCommits > 0 || openPrs.length > 0) && (
        <div className="px-4 pt-3">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            {(lostFiles > 0 || lostCommits > 0) && <AlertTitle>Du travail non sauvegardé sera perdu à la suppression.</AlertTitle>}
            <AlertDescription>
              {chosen.filter((w) => w.dirty).map((w) => <div key={w.path} className="font-mono text-xs">· {w.branch} : {plural(w.dirty, 'fichier non commité', 'fichiers non commités')}</div>)}
              {deleteBranch && chosen.filter((w) => w.unpushed).map((w) => <div key={`${w.path}-unpushed`} className="font-mono text-xs">· {w.branch} : {plural(w.unpushed, 'commit non poussé', 'commits non poussés')}</div>)}
              {openPrs.length > 0 && <div className="text-xs">{openPrs.map((w) => `#${w.pr!.number}`).join(', ')} : PR encore ouverte. Le worktree peut être recréé plus tard depuis la vue d’ensemble.</div>}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {results?.some((r) => !r.ok) && (
        <div className="flex flex-col gap-1 px-4 pt-3">
          {results.filter((r) => !r.ok).map((r) => <div key={r.name} className="text-xs text-red-600 dark:text-red-400">✗ {r.name} : {r.error}</div>)}
        </div>
      )}

      {list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucun worktree en dehors du clone principal.</p> : (
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10"><span className="sr-only">Sélection</span></TableHead><TableHead>Worktree</TableHead><TableHead>Suggestion</TableHead><TableHead>Ticket</TableHead><TableHead>PR</TableHead><TableHead>Dernier commit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((w) => {
              const s = WT_SUGGESTION[w.suggestion]
              return (
                <TableRow key={w.path} data-state={selected.has(w.path) ? 'selected' : undefined}>
                  <TableCell><Checkbox aria-label={`Sélectionner ${w.branch ?? w.path}`} checked={selected.has(w.path)} onCheckedChange={() => toggle(w.path)} /></TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-mono text-xs font-medium break-all">{w.branch ?? '(détaché)'}</span>
                    <span className="block font-mono text-[11px] break-all text-muted-foreground">{w.path}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {w.dirty > 0 && <Badge tone="red">{plural(w.dirty, 'fichier non commité', 'fichiers non commités')}</Badge>}
                      {w.unpushed > 0 && <Badge tone="red">{plural(w.unpushed, 'commit non poussé', 'commits non poussés')}</Badge>}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{w.reason}</span>
                  </TableCell>
                  <TableCell className="text-xs">{w.ticket ? <>{w.ticket.id} <span className="text-muted-foreground">· {w.ticket.status}</span></> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs">{w.pr ? <a className="hover:underline" href={w.pr.url} target="_blank" rel="noreferrer">#{w.pr.number} · {w.pr.state === 'OPEN' ? 'ouverte' : w.pr.state === 'MERGED' ? 'mergée' : 'fermée'}{w.pr.mine ? '' : ' (review)'}</a> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{w.lastCommitAt ? ago(w.lastCommitAt) : '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <p className="border-t px-4 pt-3 pb-4 text-xs text-muted-foreground">La suppression retire le dossier du worktree. La branche distante n’est jamais touchée ici : utilise le nettoyage des branches pour ça.</p>
    </div>
  )
}
