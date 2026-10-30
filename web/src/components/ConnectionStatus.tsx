import type { ActionsBlock, Credentials } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useActionsStatus, useCredentials } from '../data/queries.ts'
import { href } from '../router.ts'

// État des trois connexions dont Shipyard dépend (GitHub, Linear, Claude Code), en une pastille dans la barre du haut.

interface Check { name: string; ok: boolean; detail: string }

function checksOf(c: Credentials): Check[] {
  return [
    {
      name: 'GitHub',
      ok: !!c.github.login,
      detail: c.github.login ? `${c.github.login} · ${c.github.source === 'token' ? `jeton ${c.github.hint ?? ''}` : 'gh auth'}` : 'Non connecté : jeton invalide ou gh auth login à refaire',
    },
    {
      name: 'Linear',
      ok: c.linear.configured && !!c.linear.user,
      detail: !c.linear.configured ? 'Clé API absente' : c.linear.user ? `${c.linear.user} · clé ${c.linear.hint ?? ''}` : 'Clé API refusée par Linear',
    },
    {
      name: 'Claude',
      ok: c.claude.installed && c.claude.loggedIn,
      detail: !c.claude.installed ? 'Claude Code introuvable' : c.claude.loggedIn
        ? [c.claude.email, c.claude.plan && `forfait ${c.claude.plan}`, c.claude.version].filter(Boolean).join(' · ')
        : `Non connecté${c.claude.version ? ` · ${c.claude.version}` : ''}`,
    },
  ]
}

/** GitHub CI : ne s'affiche que quand Actions refuse de lancer les jobs (facturation…), avec la raison donnée par GitHub. */
const actionsChecks = (blocks: ActionsBlock[]): Check[] =>
  blocks.map((b) => ({ name: `GitHub CI · ${b.owner}`, ok: false, detail: `Jobs non lancés (constaté sur ${b.repo}) : ${b.reason}` }))

/** Pastille « Status » : verte si GitHub, Linear et Claude répondent, rouge sinon. Le détail s'affiche au survol. */
export function ConnectionStatus() {
  const creds = useCredentials()
  const actions = useActionsStatus()
  const checks = [...(creds.data ? checksOf(creds.data) : []), ...actionsChecks(actions.data ?? [])]
  const down = checks.filter((c) => !c.ok)
  const state = creds.isLoading ? 'loading' : creds.error || down.length ? 'down' : 'ok'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="outline" size="sm" className={cn(state === 'down' && 'border-red-500/40 bg-red-500/5 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400')}>
          <a
            href={href({ page: 'settings' })}
            aria-label={state === 'ok' ? 'Connexions : tout est bon' : state === 'down' ? `Connexions : problème avec ${down.map((c) => c.name).join(', ') || 'le serveur'}` : 'Connexions : vérification'}
          >
            <span className={cn('size-2 rounded-full', state === 'ok' ? 'bg-emerald-500' : state === 'down' ? 'bg-red-500' : 'animate-pulse bg-muted-foreground/50')} aria-hidden />
            <span className="hidden sm:inline">Status</span>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="w-72 p-0">
        <div className="flex flex-col gap-2 p-3">
          {creds.error && <span className="text-xs">Serveur Shipyard injoignable : {creds.error.message}</span>}
          {checks.map((c) => (
            <div key={c.name} className="flex items-start gap-2">
              <span className={cn('mt-1 size-2 shrink-0 rounded-full', c.ok ? 'bg-emerald-500' : 'bg-red-500')} aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{c.name} · {c.ok ? 'connecté' : 'problème'}</span>
                <span className="block text-xs break-words opacity-80">{c.detail}</span>
              </span>
            </div>
          ))}
          {creds.isLoading && <span className="text-xs">Vérification des connexions…</span>}
          <span className="border-t border-current/20 pt-2 text-[11px] opacity-70">Clic : Réglages › Connexions</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
