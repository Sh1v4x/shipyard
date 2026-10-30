import { CopyIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import type { DailyOutput, DailyPeriod } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { useAction } from '../data/runs.ts'
import { Badge, Empty, Pill, PromptMenu, RunPanel, Spinner, type Tone, useToast } from '../ui.tsx'

const STATUS: Record<DailyOutput['sections'][number]['items'][number]['status'], Tone> = { mergée: 'purple', ouverte: 'green', fermée: 'gray', reviewée: 'blue' }
const PERIODS: [DailyPeriod, string][] = [['week', 'Cette semaine'], ['last-week', 'Semaine dernière'], ['yesterday', 'Depuis hier']]

/** Version texte, à coller dans Slack ou dans des notes. */
function toMarkdown(out: DailyOutput): string {
  return [
    ...out.sections.map((s) => [
      `*${s.project}*`,
      ...s.items.map((i) => [`- ${i.title}${i.pr ? ` (#${i.pr}, ${i.status})` : ''}`, ...i.points.map((p) => `  - ${p}`)].join('\n')),
    ].join('\n')),
    out.next.length ? `*En cours*\n${out.next.map((n) => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export function DailyPage() {
  // Le lundi, la semaine en cours est encore vide : on part de la semaine dernière.
  const [period, setPeriod] = useState<DailyPeriod>(() => (new Date().getDay() === 1 ? 'last-week' : 'week'))
  // Un rapport par période : chacun garde son dernier résultat, même après un rechargement.
  const daily = useAction<DailyOutput>('daily', { project: 'all', ref: period }, { period })
  const toast = useToast()
  const out = daily.result

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily</h1>
          <p className="mt-1 text-sm text-muted-foreground">Aide-mémoire de ce que tu as fait, tous projets confondus : tes PR mergées, fermées ou ouvertes, tes commits sur la période, et les PR que tu as reviewées. De quoi savoir quoi citer, avec quelques détails techniques.</p>
        </div>
        <PromptMenu items={[['daily', 'Rapport Daily']]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(([k, label]) => <Pill key={k} active={period === k} onClick={() => setPeriod(k)}>{label}</Pill>)}
        <Button className="ml-auto" disabled={daily.busy} onClick={() => daily.start()}>
          {daily.busy ? <Spinner /> : <SparklesIcon />}{out ? 'Régénérer' : 'Générer'}
        </Button>
        {out && (
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(toMarkdown(out)).then(() => toast('Daily copié'))}>
            <CopyIcon />Copier
          </Button>
        )}
      </div>

      <RunPanel id={daily.id} events={daily.events} running={daily.running} run={daily.run} label="Préparation du Daily" onStop={daily.stop} action={daily} />

      {!daily.id && !daily.loading && <Empty title="Pas encore de Daily">Clique sur « Générer » : le panel lit ton activité GitHub sur la période, puis la résume en liste.</Empty>}
      {out && !out.sections.length && <Empty title="Aucune activité sur la période">Pas de PR mergée, fermée, avec un commit de ta part, ni de review.</Empty>}

      {out?.sections.map((s) => (
        <section key={s.project} className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="font-mono text-sm font-semibold">{s.project}</h2>
          <ul className="flex flex-col gap-3">
            {s.items.map((i, n) => (
              <li key={n} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {i.title}
                  {i.pr && (i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground hover:underline">#{i.pr}</a> : <span className="font-mono text-xs text-muted-foreground">#{i.pr}</span>)}
                  <Badge tone={STATUS[i.status]}>{i.status}</Badge>
                </span>
                {i.points.length > 0 && (
                  <ul className="ml-4 list-disc text-sm text-muted-foreground marker:text-muted-foreground/60">
                    {i.points.map((p, k) => <li key={k}>{p}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {out && out.next.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="text-sm font-semibold">En cours</h2>
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {out.next.map((n, k) => <li key={k}>{n}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
