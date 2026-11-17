import { ArrowUpRightIcon, ClipboardCheckIcon, GitBranchPlusIcon, PlayIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project, QuickAssignee, QuickPick, QuickTicketsOutput, QuickUrgency } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLinearMeta, useProjects } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Badge, Empty, ErrorBox, Pill, PromptMenu, RunPanel, Spinner, plural, type Tone } from '../ui.tsx'

const ANY_LABEL = '__any__'

const URGENCY: { key: QuickUrgency; label: string }[] = [
  { key: 'any', label: 'Peu importe' },
  { key: 'high', label: 'Haute et urgente' },
  { key: 'urgent', label: 'Urgente seulement' },
]

const SIZE: Record<QuickPick['size'], { label: string; tone: Tone }> = {
  XS: { label: 'XS · moins d’une heure', tone: 'green' },
  S: { label: 'S · une à trois heures', tone: 'green' },
  M: { label: 'M · une demi-journée', tone: 'amber' },
  L: { label: 'L · un à deux jours', tone: 'red' },
  XL: { label: 'XL · plus de deux jours', tone: 'red' },
}
const CONFIDENCE: Record<QuickPick['confidence'], Tone> = { forte: 'green', moyenne: 'amber', faible: 'gray' }

/**
 * Tickets rapides : je choisis un projet, un label et une priorité ; un agent examine tous les tickets à démarrer
 * qui correspondent, vérifie les meilleurs candidats dans le code et rend les plus simples à faire.
 */
export function QuickTicketsPage({ project }: { project: Project }) {
  const projects = useProjects()
  const meta = useLinearMeta(project.id, !!project.team)
  const action = useAction<QuickTicketsOutput>('quick-tickets', { project: project.id })
  const [label, setLabel] = useState(ANY_LABEL)
  const [urgency, setUrgency] = useState<QuickUrgency>('any')
  const [assignee, setAssignee] = useState<QuickAssignee>('free')
  const [extra, setExtra] = useState('')

  // Critères de la dernière sélection : le formulaire en repart (après un rechargement, par exemple).
  const last = action.run?.input
  useEffect(() => {
    if (!last) return
    setLabel(last.label || ANY_LABEL)
    setUrgency(last.urgency ?? 'any')
    setAssignee(last.assignee ?? 'free')
    setExtra(last.extra ?? '')
  }, [action.run?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const labels = [...(meta.data?.labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const result = action.result
  const start = () => action.start({ label: label === ANY_LABEL ? undefined : label, urgency, assignee, extra })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Tickets rapides</h1>
          <p className="mt-1 text-sm text-muted-foreground">Un agent lit en entier tous les tickets à démarrer qui correspondent à tes critères, les vérifie dans le code, et te classe les moins longs à faire, même quand aucun n’est petit. Rien n’est modifié.</p>
        </div>
        <PromptMenu items={[['quick-tickets', 'Sélection']]} />
      </div>

      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Projet</span>
          <div className="flex flex-wrap gap-1.5">
            {(projects.data ?? [project]).map((p) => (
              <Pill key={p.id} className="font-mono" active={p.id === project.id} onClick={() => go({ page: 'quick', project: p.id })}>{p.name}</Pill>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{project.team ? `Tickets de l’équipe Linear ${project.team}, jugés d’après le code de ${project.repo}.` : 'Ce projet n’a pas d’équipe Linear : choisis-en un autre, ou lie une équipe au projet.'}</p>
        </div>

        <div className="flex flex-wrap gap-5">
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
            <FieldLabel htmlFor="quick-label">Label</FieldLabel>
            <Select value={label} onValueChange={setLabel} disabled={!project.team}>
              <SelectTrigger id="quick-label" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_LABEL}>Tous les labels</SelectItem>
                {/* Label d'une sélection précédente, disparu de Linear depuis : il reste affiché. */}
                {label !== ANY_LABEL && !labels.some((l) => l.name === label) && <SelectItem value={label}>{label}</SelectItem>}
                {labels.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {meta.isLoading && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />Chargement des labels…</span>}
            <ErrorBox error={meta.error} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Priorité</span>
            <fieldset className="flex flex-wrap gap-1.5" aria-label="Priorité">
              {URGENCY.map((u) => <Pill key={u.key} active={urgency === u.key} onClick={() => setUrgency(u.key)}>{u.label}</Pill>)}
            </fieldset>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Checkbox id="quick-assigned" className="mt-0.5" checked={assignee === 'all'} onCheckedChange={(v) => setAssignee(v === true ? 'all' : 'free')} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="quick-assigned">Inclure les tickets déjà assignés à quelqu’un d’autre</FieldLabel>
            <span className="text-xs text-muted-foreground">Décoché : seulement les tickets sans personne, et les tiens.</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="quick-extra">Consigne <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
          <Textarea id="quick-extra" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ex. : seulement le front web, rien qui touche à la base de données, pas plus d’une heure chacun…" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={action.busy || !project.team} onClick={() => void start()}>{action.busy ? <Spinner /> : <PlayIcon />}Trouver les tickets rapides</Button>
          <span className="text-sm text-muted-foreground">Seuls les tickets pas encore démarrés sont examinés (triage, backlog, à faire).</span>
        </div>
        <RunPanel id={action.id} events={action.events} running={action.running} run={action.run} label="L’agent lit les tickets et les vérifie dans le code" onStop={action.stop} action={action} />
      </section>

      {result && !action.busy && <Results project={project} projects={projects.data ?? [project]} result={result} />}
    </div>
  )
}

function Results({ project, projects, result }: { project: Project; projects: Project[]; result: QuickTicketsOutput }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Tickets retenus">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">{plural(result.picks.length, 'ticket retenu', 'tickets retenus')} sur {plural(result.examined, 'examiné', 'examinés')}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>
      </div>
      {!result.picks.length && <Empty title="Aucun ticket classé">L’agent n’a pu en estimer aucun : son résumé dit pourquoi.</Empty>}
      {result.picks.map((p, n) => {
        // Le ticket peut relever d'un autre dépôt du même produit : le pre-check et le worktree partent de celui-là.
        const target = projects.find((x) => x.name === p.repo || x.repo === p.repo) ?? project
        return (
          <article key={p.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 font-semibold">
                <span className="mr-2 text-muted-foreground tabular-nums">{n + 1}.</span>
                <a className="font-mono text-[13px] hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.id}</a> {p.title}
              </h3>
              <span className="flex flex-wrap gap-1">
                <Badge tone={SIZE[p.size].tone}>{SIZE[p.size].label}</Badge>
                <Badge tone="gray">{p.effort}</Badge>
                <Badge tone={CONFIDENCE[p.confidence]}>confiance {p.confidence}</Badge>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{p.priority}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{target.name}</span>
              {p.labels.map((l) => <Badge key={l} tone="gray">{l}</Badge>)}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{p.why}</p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{p.approach}</p>
            {p.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{p.files.join(', ')}</p>}
            {p.risk && <p className="text-sm text-amber-700 dark:text-amber-400">Risque : {p.risk}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild><a href={href({ page: 'precheck', project: target.id, ticket: p.id })}><ClipboardCheckIcon />Pre-check</a></Button>
              <Button size="sm" variant="outline" asChild><a href={href({ page: 'create', project: target.id, ticket: p.id })}><GitBranchPlusIcon />Créer le worktree</a></Button>
              <Button size="sm" variant="ghost" asChild><a href={p.url} target="_blank" rel="noreferrer">Ouvrir dans Linear<ArrowUpRightIcon /></a></Button>
            </div>
          </article>
        )
      })}
    </section>
  )
}
