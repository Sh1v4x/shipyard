import { CheckIcon, TagIcon } from 'lucide-react'
import { useState } from 'react'
import type { PullRequest } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useEditPrLabels } from '../data/mutations.ts'
import { useRepoLabelDetails } from '../data/queries.ts'
import { Spinner, useToast } from '../ui.tsx'

/** Sélecteur des labels d'une PR : un clic ajoute ou retire le label sur GitHub. */
export function LabelPicker({ project, wtId, pr }: { project: string; wtId: string; pr: PullRequest }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const labels = useRepoLabelDetails(project, open)
  const edit = useEditPrLabels(project, wtId)
  const toast = useToast()

  const current = new Set(pr.labels.map((l) => l.name))
  const q = filter.trim().toLowerCase()
  const list = (labels.data ?? []).filter((l) => !q || l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q))
    // Les labels posés d'abord, puis l'ordre du dépôt.
    .sort((a, b) => Number(current.has(b.name)) - Number(current.has(a.name)))

  const toggle = (name: string) => {
    const on = current.has(name)
    setPending(name)
    edit.mutate(on ? { remove: [name] } : { add: [name] }, {
      onSuccess: () => toast(on ? `Label « ${name} » retiré` : `Label « ${name} » ajouté`),
      onError: (e) => toast(e.message, true),
      onSettled: () => setPending(null),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" aria-label="Modifier les labels de la PR">
          <TagIcon className="size-3" />{pr.labels.length ? '' : 'Labels'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] max-w-[calc(100vw-2rem)] p-2">
        <Input autoFocus placeholder="Rechercher un label" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
        <div className="mt-2 flex max-h-80 flex-col overflow-y-auto">
          {labels.isLoading && <span className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner className="size-3.5" />Chargement des labels…</span>}
          {labels.error && <p className="px-2 py-3 text-sm text-destructive">{labels.error.message}</p>}
          {list.map((l) => {
            const on = current.has(l.name)
            return (
              <button
                key={l.name}
                type="button"
                disabled={edit.isPending}
                onClick={() => toggle(l.name)}
                aria-pressed={on}
                className={cn('flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:cursor-wait', on && 'bg-accent/60')}
              >
                <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                  {pending === l.name ? <Spinner className="size-3" /> : on && <CheckIcon className="size-3" />}
                </span>
                <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: `#${l.color}` }} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm">{l.name}</span>
                  {l.description && <span className="block truncate text-xs text-muted-foreground">{l.description}</span>}
                </span>
              </button>
            )
          })}
          {labels.data && !list.length && <p className="px-2 py-3 text-sm text-muted-foreground">Aucun label ne correspond.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
