import { LinkIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import type { Project, Ticket, Worktree } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { coversTicket, worktreeTicketIds } from '../../../shared/text.ts'
import { useAddTicket, useLinkTicket } from '../data/mutations.ts'
import { useProjectOverview } from '../data/queries.ts'
import { Dot, Spinner, ticketDot, useToast, worktreeTitle } from '../ui.tsx'

const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/i

/**
 * Lie un ticket Linear à un worktree dont la branche ne le nomme pas (ou en change).
 * Le lien est gardé par Shipyard ; « Délier » revient au ticket déduit de la branche.
 * `add` : associe un ticket de plus au worktree (deux tickets liés, faits dans la même branche et la même PR), sans
 * toucher au ticket principal.
 */
export function LinkTicket({ project, worktree, hasTicket, add = false }: { project: Project; worktree: Worktree; hasTicket: boolean; add?: boolean }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ov = useProjectOverview(project.id)
  const replace = useLinkTicket(project.id)
  const append = useAddTicket(project.id)
  const link = add ? append : replace
  const toast = useToast()

  const q = filter.trim().toLowerCase()
  const tickets = (ov.data?.tickets ?? [])
    .filter((t) => t.statusType !== 'canceled' && (!q || t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)))
    .slice(0, 30)
  const usedBy = (id: string) => ov.data?.worktrees.find((w) => coversTicket(w, id) && w.id !== worktree.id)
  // Un identifiant tapé à la main (ticket hors de la liste : assigné à quelqu'un d'autre, ancien…).
  const typed = TICKET_ID.test(filter.trim()) && !tickets.some((t) => t.id.toLowerCase() === q) ? filter.trim().toUpperCase() : null

  const done = (message: string) => {
    setOpen(false)
    setFilter('')
    toast(message)
  }
  const pick = (ticketId: string | null) => {
    if (add && ticketId) return append.mutate({ wt: worktree.id, ticketId }, { onSuccess: () => done(`${ticketId} associé à ce worktree`), onError: (e) => toast(e.message, true) })
    replace.mutate({ wt: worktree.id, ticketId }, { onSuccess: () => done(ticketId ? `Worktree lié à ${ticketId}` : 'Lien retiré : ticket déduit de la branche'), onError: (e) => toast(e.message, true) })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {add
          ? <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" title="Un autre ticket fait dans ce même worktree et sa PR"><PlusIcon className="size-3" />Ticket</Button>
          : hasTicket
          ? <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Changer le ticket lié"><PencilIcon className="size-3" /></Button>
          : <Button variant="outline" size="sm" className="h-6 px-2 text-xs"><LinkIcon className="size-3" />Lier un ticket</Button>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] max-w-[calc(100vw-2rem)] p-2">
        <form onSubmit={(e) => { e.preventDefault(); if (typed) pick(typed) }}>
          <Input autoFocus placeholder="Rechercher, ou taper un identifiant (ENG-1604)" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
        </form>
        <div className="mt-2 flex max-h-72 flex-col overflow-y-auto">
          {typed && (
            <button type="button" disabled={link.isPending} onClick={() => pick(typed)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
              <LinkIcon className="size-3.5 text-muted-foreground" />{add ? 'Associer' : 'Lier'} <span className="font-mono">{typed}</span>
            </button>
          )}
          {tickets.map((t) => {
            const other = usedBy(t.id)
            const current = add ? coversTicket(worktree, t.id) : t.id === worktree.ticketId
            return (
              <button
                key={t.id}
                type="button"
                disabled={link.isPending || current}
                onClick={() => pick(t.id)}
                className={cn('flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60', current && 'bg-accent')}
              >
                <span className="flex items-center gap-2 text-sm">
                  <Dot color={ticketDot(t.statusType)} />
                  <span className="font-mono text-xs">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </span>
                <span className="pl-4 text-xs text-muted-foreground">{t.status}{current ? ' · lié' : other ? ` · déjà lié à ${other.branch ?? 'un autre worktree'}` : ''}</span>
              </button>
            )
          })}
          {!tickets.length && !typed && <p className="px-2 py-3 text-sm text-muted-foreground">{ov.isLoading ? 'Chargement des tickets…' : 'Aucun ticket : tape son identifiant.'}</p>}
        </div>
        {((worktree.ticketLinked && !add) || link.isPending) && (
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            {link.isPending ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />Enregistrement…</span> : <span />}
            {worktree.ticketLinked && !add && <Button variant="ghost" size="sm" disabled={link.isPending} onClick={() => pick(null)}>Délier</Button>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * L'inverse : depuis un ticket sans worktree, choisit un worktree existant à lui lier
 * (sa branche ne nomme pas le ticket). Les worktrees sans ticket sont proposés en premier.
 */
export function LinkWorktree({ project, ticket }: { project: Project; ticket: Ticket }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ov = useProjectOverview(project.id)
  const link = useAddTicket(project.id)
  const toast = useToast()

  const q = filter.trim().toLowerCase()
  const prOf = (w: Worktree) => [...(ov.data?.myPrs ?? []), ...(ov.data?.reviewPrs ?? [])].find((p) => p.number === w.prNumber)
  const worktrees = (ov.data?.worktrees ?? [])
    .filter((w) => !q || worktreeTitle(w, prOf(w)).toLowerCase().includes(q) || (w.branch ?? '').toLowerCase().includes(q))
    .sort((a, b) => Number(!!a.ticketId) - Number(!!b.ticketId))

  const pick = (w: Worktree) =>
    link.mutate({ wt: w.id, ticketId: ticket.id }, {
      onSuccess: () => {
        setOpen(false)
        setFilter('')
        toast(w.ticketId ? `${ticket.id} associé à ${w.ticketId} dans ${w.branch ?? 'ce worktree'}` : `${ticket.id} lié à ${w.branch ?? 'ce worktree'}`)
      },
      onError: (e) => toast(e.message, true),
    })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground"><LinkIcon />Lier</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-2">
        <Input autoFocus placeholder="Rechercher un worktree" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
        <div className="mt-2 flex max-h-72 flex-col overflow-y-auto">
          {worktrees.map((w) => {
            const pr = prOf(w)
            return (
              <button
                key={w.id}
                type="button"
                disabled={link.isPending}
                onClick={() => pick(w)}
                className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
              >
                <span className={cn('truncate text-sm', !(w.kind === 'review' && pr) && 'font-mono text-xs')}>{worktreeTitle(w, pr)}</span>
                <span className="text-xs text-muted-foreground">
                  {pr ? `#${pr.number}` : 'Pas de PR'}
                  {w.ticketId ? ` · s’ajoute à ${worktreeTicketIds(w).join(', ')}` : ' · sans ticket'}
                </span>
              </button>
            )
          })}
          {!worktrees.length && <p className="px-2 py-3 text-sm text-muted-foreground">{ov.isLoading ? 'Chargement des worktrees…' : 'Aucun worktree.'}</p>}
        </div>
        {link.isPending && <span className="mt-2 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground"><Spinner className="size-3" />Enregistrement…</span>}
      </PopoverContent>
    </Popover>
  )
}
