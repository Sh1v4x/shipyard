import { TriangleAlertIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDeleteOrphanLocalTickets } from '../data/mutations.ts'
import { useLocalTicketOrphans, useProjects } from '../data/queries.ts'
import { plural, useToast } from '../ui.tsx'

/** Barre du haut : tickets locaux dont le worktree n'existe plus (supprimé hors de Shipyard), à supprimer. */
export function LocalTicketOrphans() {
  const orphans = useLocalTicketOrphans().data ?? []
  const projects = useProjects().data ?? []
  const del = useDeleteOrphanLocalTickets()
  const toast = useToast()
  if (!orphans.length) return null
  const remove = (paths: string[]) =>
    del.mutate(paths, { onSuccess: () => toast(plural(paths.length, 'ticket local supprimé', 'tickets locaux supprimés')), onError: (e) => toast(e.message, true) })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400">
          <TriangleAlertIcon />
          <span className="hidden sm:inline">{plural(orphans.length, 'ticket local orphelin', 'tickets locaux orphelins')}</span>
          <span className="sm:hidden">{orphans.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)] p-1">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Leur worktree n’existe plus (supprimé hors de Shipyard, ou projet retiré) : ils ne servent plus à rien.</p>
        {orphans.map((t) => (
          <div key={t.path} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground" title={t.path}>{projects.find((p) => p.id === t.project)?.name ?? t.project} · {t.branch}</span>
            </span>
            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Supprimer le ticket local « ${t.title} »`} disabled={del.isPending} onClick={() => remove([t.path])}>
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {orphans.length > 1 && (
          <div className="mt-1 border-t p-1">
            <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive" disabled={del.isPending} onClick={() => remove(orphans.map((t) => t.path))}>
              <Trash2Icon />Tout supprimer
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
