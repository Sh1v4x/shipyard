import { CopyIcon, DownloadIcon, FileTextIcon, GitBranchPlusIcon, LightbulbIcon, PlayIcon, TicketPlusIcon, WrenchIcon } from 'lucide-react'
import { useState } from 'react'
import type { InsightItem, InsightsMode, InsightsOutput, Project } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreateLocalTicketWorktree } from '../data/mutations.ts'
import { useDigest } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go } from '../router.ts'
import { Badge, Empty, Pill, PromptMenu, RunPanel, Spinner, plural, useToast, type Tone } from '../ui.tsx'

const MODES: { key: InsightsMode; label: string; icon: typeof LightbulbIcon; help: string; start: string }[] = [
  { key: 'features', label: 'Nouvelles features', icon: LightbulbIcon, help: 'Ce qui manque aux utilisateurs, ce que les données et les écrans existants permettraient presque déjà, les parcours incomplets.', start: 'Proposer des features' },
  { key: 'improve', label: 'Axes d’amélioration', icon: WrenchIcon, help: 'Performance, sécurité, dette technique, tests, accessibilité, UX, expérience de développement, architecture : constats précis dans le code.', start: 'Trouver des axes d’amélioration' },
]

const IMPACT: Record<InsightItem['impact'], Tone> = { fort: 'green', moyen: 'amber', faible: 'gray' }
const CATEGORY: Record<string, Tone> = { feature: 'blue', performance: 'amber', sécurité: 'red', dette: 'purple', tests: 'purple', accessibilité: 'blue', ux: 'blue', dx: 'gray', architecture: 'purple' }

/** Texte d'une proposition, repris tel quel comme feature à rédiger en ticket ou comme consigne. */
const asText = (i: InsightItem) => [i.title, '', i.why, '', i.proposal, i.files.length ? `\nFichiers : ${i.files.join(', ')}` : '', i.risk ? `\nRisque : ${i.risk}` : ''].filter((x) => x !== '').join('\n')

/** Features & optimisations : un agent lit le digest du dépôt (façon gitingest) et le code, puis propose. */
export function InsightsPage({ project, mode: routeMode }: { project: Project; mode?: string }) {
  const mode: InsightsMode = routeMode === 'improve' ? 'improve' : 'features'
  const m = MODES.find((x) => x.key === mode)!
  const action = useAction<InsightsOutput>('insights', { project: project.id, ref: mode }, { insights: mode })
  const [extra, setExtra] = useState('')
  const result = action.result

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Features & optimisations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Un agent lit le digest du dépôt {project.repo} puis le code, et propose. Rien n’est modifié : tu choisis ce que tu transformes en ticket.</p>
        </div>
        <PromptMenu items={[['insights', 'Analyse']]} />
      </div>

      <DigestCard project={project} />

      <div className="flex flex-wrap gap-2">
        {MODES.map((x) => (
          <Pill key={x.key} active={x.key === mode} onClick={() => go({ page: 'insights', project: project.id, mode: x.key })}>
            <x.icon className="size-3.5" />{x.label}
          </Pill>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{m.help}</p>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="insights-extra">Consigne <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
          <Textarea id="insights-extra" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)}
            placeholder={mode === 'features' ? 'Ex. : côté mobile uniquement, autour du panier, pour les clients professionnels…' : 'Ex. : seulement la perf de l’API, la sécurité des routes publiques…'} />
        </div>
        <div>
          <Button disabled={action.busy} onClick={() => action.start({ extra })}>{action.busy ? <Spinner /> : <PlayIcon />}{m.start}</Button>
        </div>
        <RunPanel id={action.id} events={action.events} running={action.running} run={action.run} label="L’agent lit le digest et explore le code" onStop={action.stop} action={action} />
      </section>

      {result && !action.busy && <Results project={project} result={result} />}
    </div>
  )
}

function DigestCard({ project }: { project: Project }) {
  const digest = useDigest(project.id)
  const d = digest.data
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">Digest du dépôt {d && <Badge tone={d.mode === 'full' ? 'green' : 'amber'}>{d.mode === 'full' ? 'complet' : 'carte'}</Badge>}</p>
          {digest.isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-3" />Calcul du digest…</p>}
          {digest.error && <p className="text-destructive">{digest.error.message}</p>}
          {d && (
            <p className="text-muted-foreground">
              {plural(d.files, 'fichier analysé', 'fichiers analysés')} ({d.excluded} exclus) · ~{Math.round(d.totalTokens / 1000)}k tokens au total · branche {d.branch}, commit {d.sha}
              <br />
              {d.mode === 'full'
                ? `Contenu complet de chaque fichier (~${Math.round(d.digestTokens / 1000)}k tokens).`
                : `Trop gros pour un digest complet : arborescence et fichiers structurants (~${Math.round(d.digestTokens / 1000)}k tokens), l’agent lit le reste du code lui-même.`}
            </p>
          )}
        </div>
      </div>
      {d && (
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/projects/${project.id}/digest?download=1`}><DownloadIcon />Télécharger</a>
        </Button>
      )}
    </div>
  )
}

function Results({ project, result }: { project: Project; result: InsightsOutput }) {
  const toast = useToast()
  const [filter, setFilter] = useState<string | null>(null)
  const categories = [...new Set(result.items.map((i) => i.category))]
  const items = result.items.filter((i) => !filter || i.category === filter)

  // Rédiger le ticket : la proposition devient la feature de « Nouveau ticket » (brouillon stocké par projet).
  const toTicket = (i: InsightItem) => {
    try { localStorage.setItem(`devpanel:ticket-draft:feature:${project.id}`, JSON.stringify(asText(i))) } catch { /* stockage indisponible */ }
    go({ page: 'new-ticket', project: project.id })
  }
  const copy = async (i: InsightItem) => {
    await navigator.clipboard.writeText(asText(i)).then(() => toast('Proposition copiée'), () => toast('Copie impossible', true))
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Propositions">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm leading-relaxed">{result.summary}</p>
      </div>
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Pill active={!filter} onClick={() => setFilter(null)}>Toutes · {result.items.length}</Pill>
          {categories.map((c) => <Pill key={c} active={filter === c} onClick={() => setFilter(c)}>{c} · {result.items.filter((i) => i.category === c).length}</Pill>)}
        </div>
      )}
      {!items.length && <Empty title="Aucune proposition" />}
      {items.map((i, n) => (
        <article key={n} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-semibold">{i.title}</h3>
            <span className="flex flex-wrap gap-1">
              <Badge tone={CATEGORY[i.category] ?? 'gray'}>{i.category}</Badge>
              <Badge tone={IMPACT[i.impact]}>impact {i.impact}</Badge>
              <Badge tone="gray">effort {i.effort}</Badge>
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{i.why}</p>
          <p className="text-sm leading-relaxed whitespace-pre-line">{i.proposal}</p>
          {i.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{i.files.join(', ')}</p>}
          {i.risk && <p className={cn('text-sm text-amber-700 dark:text-amber-400')}>Risque : {i.risk}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!project.team} title={project.team ? undefined : 'Aucune équipe Linear liée à ce projet'} onClick={() => toTicket(i)}><TicketPlusIcon />Rédiger le ticket Linear</Button>
            <Button size="sm" variant="outline" onClick={() => void copy(i)}><CopyIcon />Copier</Button>
          </div>
          <LocalStart project={project} item={i} />
        </article>
      ))}
    </section>
  )
}

const PREFIX: Record<string, string> = { feature: 'feat', performance: 'perf', sécurité: 'fix', tests: 'test', dette: 'refactor', architecture: 'refactor', accessibilité: 'fix', ux: 'feat', dx: 'chore' }

/** Nom de branche tiré du titre : préfixe selon la catégorie, puis le titre en kebab-case, sans accents. */
const branchFor = (i: InsightItem) => {
  const slug = i.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 7).join('-')
  return `${PREFIX[i.category] ?? 'feat'}/${slug}`
}

/** Démarrer sans ticket Linear : branche et worktree créés, la proposition y est gardée comme ticket local. */
function LocalStart({ project, item }: { project: Project; item: InsightItem }) {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState(() => branchFor(item))
  const create = useCreateLocalTicketWorktree(project.id)
  const toast = useToast()
  if (!open) {
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}><GitBranchPlusIcon />Créer la branche et le worktree</Button>
      </div>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ branch: branch.trim(), item }, {
          onSuccess: (r) => {
            toast('Worktree créé : la proposition y est gardée comme ticket local')
            go({ page: 'worktree', project: project.id, wt: r.id })
          },
          onError: (e) => toast(e.message, true),
        })
      }}
    >
      <Input aria-label="Nom de la branche" value={branch} onChange={(e) => setBranch(e.target.value)} className="h-8 min-w-60 flex-1 font-mono text-xs" />
      <Button size="sm" type="submit" disabled={create.isPending || !/^[\w./-]+$/.test(branch.trim())}>{create.isPending && <Spinner />}Créer depuis {project.baseBranch}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
      <p className="w-full text-xs text-muted-foreground">Sans ticket Linear : la proposition est gardée avec le worktree (ticket local) et sert de description au plan et au travail. Tu pourras en faire un ticket Linear plus tard.</p>
    </form>
  )
}
