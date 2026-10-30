import { Link2Icon, Link2OffIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import type { Project, ProjectOverview, Worktree } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useLinkWorktree, useUnlinkWorktree } from '../data/mutations.ts'
import { useProjectOverviews, useProjects } from '../data/queries.ts'
import { href } from '../router.ts'
import { Spinner, useToast, worktreeTitle } from '../ui.tsx'

// Worktrees associés entre projets d'un même groupe : les actions IA (plan, travail, review) les prennent en compte.

const prOf = (ov: ProjectOverview | undefined, w: Worktree) => (w.prNumber ? [...(ov?.myPrs ?? []), ...(ov?.reviewPrs ?? [])].find((p) => p.number === w.prNumber) : undefined)

/** Pastille « Lié à » de la page d'un worktree : ses worktrees associés, et de quoi en associer un autre. */
export function LinkedWorktrees({ project, worktree }: { project: Project; worktree: Worktree }) {
  const projects = useProjects().data ?? []
  const grouped = project.group ? projects.filter((p) => p.id !== project.id && p.group === project.group) : []
  const links = worktree.links ?? []
  const ids = [...new Set([...grouped.map((p) => p.id), ...links.map((l) => l.project)])]
  const overviews = useProjectOverviews(ids)
  const unlink = useUnlinkWorktree(project.id, worktree.id)
  const toast = useToast()
  if (!grouped.length && !links.length) return null

  const ovOf = (id: string) => overviews.data.find((o) => o.project.id === id)
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border bg-card px-2.5 text-xs">
      <span className="flex items-center gap-1 text-muted-foreground"><Link2Icon className="size-3" />Lié à</span>
      {!links.length && <span className="text-muted-foreground">aucun</span>}
      {links.map((l) => {
        const ov = ovOf(l.project)
        const w = ov?.worktrees.find((x) => x.id === l.id)
        const name = projects.find((p) => p.id === l.project)?.name ?? l.project
        return (
          <a key={l.id} href={href({ page: 'worktree', project: l.project, wt: l.id })} className="flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 hover:bg-accent" title={l.path}>
            <span className="font-medium">{name}</span>
            <span className="max-w-[220px] truncate text-muted-foreground">{w ? worktreeTitle(w, prOf(ov, w)) : l.path.split('/').pop()}</span>
          </a>
        )
      })}
      {grouped.length > 0 && <AddLink project={project} worktree={worktree} grouped={grouped} overviews={overviews.data} loading={overviews.loading} />}
      {links.length > 0 && (
        <Button
          variant="ghost" size="icon-sm" className="size-6" aria-label="Délier ce worktree" disabled={unlink.isPending}
          onClick={() => {
            if (!confirm('Retirer ce worktree de ses associations ?')) return
            unlink.mutate(links.map((l) => l.project), { onSuccess: () => toast('Worktree délié'), onError: (e) => toast(e.message, true) })
          }}
        >{unlink.isPending ? <Spinner className="size-3" /> : <Link2OffIcon className="size-3" />}</Button>
      )}
    </span>
  )
}

function AddLink({ project, worktree, grouped, overviews, loading }: { project: Project; worktree: Worktree; grouped: Project[]; overviews: ProjectOverview[]; loading: boolean }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const link = useLinkWorktree(project.id, worktree.id)
  const toast = useToast()
  const q = filter.trim().toLowerCase()
  const linked = new Set((worktree.links ?? []).map((l) => l.id))
  const isReview = worktree.kind === 'review'

  const pick = (p: Project, w: Worktree) =>
    link.mutate({ project: p.id, wt: w.id }, {
      onSuccess: () => {
        setOpen(false)
        setFilter('')
        toast(`Associé à ${p.name} · ${w.branch ?? 'worktree'}`)
      },
      onError: (e) => toast(e.message, true),
    })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Associer un worktree d’un autre projet"><PlusIcon className="size-3" /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[400px] max-w-[calc(100vw-2rem)] p-2">
        <Input autoFocus placeholder={isReview ? 'Rechercher une review' : 'Rechercher une de mes PR'} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
        <div className="mt-2 flex max-h-80 flex-col gap-2 overflow-y-auto">
          {grouped.map((p) => {
            const ov = overviews.find((o) => o.project.id === p.id)
            // Même nature que le worktree d'origine : une review s'associe à des reviews, ma PR à mes PR (ou branches sans PR).
            const list = (ov?.worktrees ?? []).filter((w) => !linked.has(w.id) && (w.kind === 'review') === isReview && (!q || worktreeTitle(w, prOf(ov, w)).toLowerCase().includes(q) || (w.branch ?? '').toLowerCase().includes(q)))
            return (
              <div key={p.id} className="flex flex-col">
                <span className="px-2 py-1 text-xs font-medium text-muted-foreground">{p.name}</span>
                {list.map((w) => {
                  const pr = prOf(ov, w)
                  return (
                    <button key={w.id} type="button" disabled={link.isPending} onClick={() => pick(p, w)} className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60">
                      <span className={cn('truncate text-sm', !(w.kind === 'review' && pr) && 'font-mono text-xs')}>{worktreeTitle(w, pr)}</span>
                      <span className="text-xs text-muted-foreground">
                        {pr ? `#${pr.number}${w.kind === 'review' ? ` · review de ${pr.author}` : ''}` : 'Pas de PR'}
                        {w.links?.length ? ` · déjà associé à ${w.links.length}` : ''}
                      </span>
                    </button>
                  )
                })}
                {!list.length && <p className="px-2 py-1 text-xs text-muted-foreground">{!ov && loading ? 'Chargement…' : isReview ? 'Aucune review en cours dans ce projet.' : 'Aucune de tes PR dans ce projet.'}</p>}
              </div>
            )
          })}
        </div>
        {link.isPending && <span className="mt-2 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground"><Spinner className="size-3" />Association…</span>}
      </PopoverContent>
    </Popover>
  )
}
