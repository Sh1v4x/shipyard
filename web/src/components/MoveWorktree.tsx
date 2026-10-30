import { FolderInputIcon } from 'lucide-react'
import { useState } from 'react'
import type { Project, Worktree } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMoveWorktree } from '../data/mutations.ts'
import { useProjects } from '../data/queries.ts'
import { go } from '../router.ts'
import { Spinner, useToast } from '../ui.tsx'

/**
 * Worktree créé dans le mauvais projet : le recrée dans le bon (même branche, même ticket) et supprime l'original.
 * Possible tant qu'aucun travail n'y est fait (ni commit, ni fichier modifié).
 */
export function MoveWorktree({ project, worktree, hasWork }: { project: Project; worktree: Worktree; hasWork: boolean }) {
  const [open, setOpen] = useState(false)
  const others = (useProjects().data ?? []).filter((p) => p.id !== project.id)
  const move = useMoveWorktree(project.id, worktree.id)
  const toast = useToast()
  if (!others.length) return null

  const pick = (target: Project) => {
    if (!confirm(`Recréer ce worktree dans ${target.name} (branche ${worktree.branch}${worktree.ticketId ? `, ticket ${worktree.ticketId}` : ''}) et supprimer celui de ${project.name} ?`)) return
    move.mutate(target.id, {
      onSuccess: (r) => {
        setOpen(false)
        toast(`Worktree recréé dans ${target.name}`)
        go({ page: 'worktree', project: target.id, wt: r.id })
      },
      onError: (e) => toast(e.message, true),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><FolderInputIcon />Changer de projet</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
          {hasWork
            ? 'Ce worktree contient déjà du travail (commits ou fichiers modifiés) : il appartient à ce dépôt et ne peut pas être déplacé.'
            : 'Créé dans le mauvais projet ? Il est recréé dans le projet choisi, avec la même branche et le même ticket, puis celui-ci est supprimé.'}
        </p>
        <div className="flex flex-col">
          {others.map((p) => (
            <button key={p.id} type="button" disabled={hasWork || move.isPending} onClick={() => pick(p)} className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50">
              <span className="flex items-center gap-2 text-sm font-medium">{move.isPending && move.variables === p.id && <Spinner className="size-3" />}{p.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{p.repo}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
