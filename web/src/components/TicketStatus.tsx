import type { Project, Ticket } from '../../../shared/types.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSetTicketState } from '../data/mutations.ts'
import { useTicketStates } from '../data/queries.ts'
import { Dot, Spinner, useToast } from '../ui.tsx'

/**
 * Statut Linear d'un ticket, modifiable sur place. Les statuts proposés sont ceux du workflow de l'équipe.
 * Le changement est optimiste : la vue du projet et le worktree l'affichent avant la réponse de Linear.
 */
export function TicketStatus({ project, ticket }: { project: Project; ticket: Pick<Ticket, 'id' | 'status'> }) {
  const states = useTicketStates(project.id)
  const setState = useSetTicketState(project.id)
  const toast = useToast()
  const busy = setState.isPending
  const optimistic = setState.isPending ? setState.variables?.state.name ?? null : null
  const current = states.data?.find((s) => s.name === (optimistic ?? ticket.status))
  const color = current?.color ?? '#95a2b3'

  const change = (stateId: string) => {
    const next = states.data?.find((s) => s.id === stateId)
    if (!next || next.name === ticket.status) return
    setState.mutate({ ticket: ticket.id, state: next }, {
      onSuccess: () => toast(`${ticket.id} → ${next.name}`),
      onError: (e) => toast(e.message, true),
    })
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Select value={current?.id ?? ''} onValueChange={change} disabled={busy || !states.data?.length}>
        <SelectTrigger size="sm" aria-label={`Statut de ${ticket.id}`} className="h-6 max-w-[180px] gap-1.5 rounded-full px-2.5 text-xs font-medium data-[size=sm]:h-6">
          {/* La valeur affichée reprend la pastille de l'option choisie ; seule la valeur provisoire a besoin de la sienne. */}
          {!current && <Dot color={color} />}
          <SelectValue placeholder={optimistic ?? ticket.status} />
        </SelectTrigger>
        <SelectContent>
          {states.data?.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              <Dot color={s.color} />
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <Spinner className="size-3.5 text-muted-foreground" />}
    </span>
  )
}
