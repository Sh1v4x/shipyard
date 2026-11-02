import { CopyIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import type { DailyOutput, DailyPeriod } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { useAction } from '../data/runs.ts'
import { Badge, Empty, Pill, PromptMenu, RunPanel, Spinner, type Tone, useToast } from '../ui.tsx'

const STATUS: Record<DailyOutput['sections'][number]['items'][number]['status'], Tone> = { mergée: 'purple', ouverte: 'green', fermée: 'gray', reviewée: 'blue' }
const PERIODS: [DailyPeriod, string][] = [['week', 'Cette semaine'], ['last-week', 'Semaine dernière'], ['yesterday', 'Depuis hier']]

/** Jour local au format AAAA-MM-JJ (celui des champs date). */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const firstOfMonth = () => {
  const d = new Date()
  d.setDate(1)
  return isoDay(d)
}

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
  const [period, setPeriod] = useState<DailyPeriod | 'custom'>(() => (new Date().getDay() === 1 ? 'last-week' : 'week'))
  const [range, setRange] = useState({ from: firstOfMonth(), to: isoDay(new Date()) })
  const custom = period === 'custom'
  const rangeValid = !!range.from && !!range.to && range.from <= range.to
  // Un rapport par période (et par plage choisie) : chacun garde son dernier résultat, même après un rechargement.
  const daily = useAction<DailyOutput>(
    'daily',
    { project: 'all', ref: custom ? `${range.from}..${range.to}` : period },
    custom ? { since: range.from, until: range.to } : { period },
  )
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
        <Pill active={custom} onClick={() => setPeriod('custom')}>Période personnalisée</Pill>
        <Button className="ml-auto" disabled={daily.busy || (custom && !rangeValid)} onClick={() => daily.start()}>
          {daily.busy ? <Spinner /> : <SparklesIcon />}{out ? 'Régénérer' : 'Générer'}
        </Button>
        {out && (
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(toMarkdown(out)).then(() => toast('Daily copié'))}>
            <CopyIcon />Copier
          </Button>
        )}
      </div>

      {custom && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="daily-from">Du</FieldLabel>
            <Input id="daily-from" type="date" className="w-44" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="daily-to">Au</FieldLabel>
            <Input id="daily-to" type="date" className="w-44" value={range.to} min={range.from} max={isoDay(new Date())} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <p className="min-w-0 flex-1 basis-60 pb-2 text-xs text-muted-foreground">
            {rangeValid ? 'Bornes comprises. Sur une longue période, le résumé reste centré sur ce qui compte : les PR et les reviews les plus marquantes.' : 'La date de début doit précéder la date de fin.'}
          </p>
        </div>
      )}

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
