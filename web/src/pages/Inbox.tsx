import { ArrowRightIcon, InboxIcon, XIcon } from 'lucide-react'
import type { InboxItem } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { runHref } from '../../../shared/inbox.ts'
import { useDismissInbox } from '../data/mutations.ts'
import { useInbox, useRunningRuns } from '../data/queries.ts'
import { Empty, Spinner, ago, useToast } from '../ui.tsx'

const DOT: Record<InboxItem['tone'], string> = {
  amber: 'bg-amber-500', red: 'bg-red-500', purple: 'bg-violet-500', green: 'bg-emerald-500', blue: 'bg-blue-500',
}

/**
 * « À valider » : une ligne par agent qui a fini et attend quelque chose de moi, rangée par projet,
 * avec un bouton vers l'endroit où agir. Les agents encore en cours sont rappelés en tête.
 */
export function InboxPage() {
  const inbox = useInbox()
  const running = useRunningRuns()
  const dismiss = useDismissInbox()
  const toast = useToast()
  const items = inbox.data ?? []
  const projects = [...new Set(items.map((i) => i.projectName))]
  const live = running.data ?? []

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">À valider</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ce que tes agents attendent de toi, tous projets confondus. Un résultat à lire disparaît dès que tu l’ouvres, une décision dès qu’elle est prise. Tu peux aussi l’écarter.</p>
      </div>

      {live.length > 0 && (
        <section className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 shadow-xs">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Spinner className="size-3.5" />{live.length} agent(s) en cours</span>
          {live.map((r) => (
            <a key={r.id} href={runHref(r.kind, r.scope)} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="text-xs text-muted-foreground">{r.scope.project === 'all' ? 'tous les projets' : r.scope.project} · {ago(r.startedAt)}</span>
            </a>
          ))}
        </section>
      )}

      {inbox.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement…</div>}
      {inbox.data && !items.length && <Empty icon={InboxIcon} title="Rien à valider">Quand un agent aura fini et attendra quelque chose de toi, il apparaîtra ici.</Empty>}

      {projects.map((name) => (
        <section key={name} className="flex flex-col gap-2">
          <h2 className="font-mono text-sm font-semibold">{name}</h2>
          <ul className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
            {items.filter((i) => i.projectName === name).map((i) => (
              <li key={i.runId} className="group flex items-center gap-3 border-t px-4 py-3 first:border-t-0">
                <span className={cn('size-2 shrink-0 rounded-full', DOT[i.tone])} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{i.label}</span>{i.detail && ` · ${i.detail}`} · {ago(i.at)} · {i.until}
                  </p>
                </div>
                <Button size="sm" asChild><a href={i.href} onClick={() => { if (i.clearsOnOpen) dismiss.mutate(i.runId) }}>Ouvrir<ArrowRightIcon /></a></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Écarter" title="Écarter" className="text-muted-foreground"
                  onClick={() => dismiss.mutate(i.runId, { onError: (e) => toast(e.message, true) })}>
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
