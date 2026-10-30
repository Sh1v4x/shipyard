import { useEffect, useRef, useState } from 'react'
import type { PromptInfo, PromptSource } from '../../../shared/types.ts'
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, CircleDotIcon, HistoryIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { Diff, DiffRow } from '@/components/Diff'
import { Button } from '@/components/ui/button'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreateRule, useResetPrompt, useSavePrompt } from '../data/mutations.ts'
import { useProjects, usePromptHistory, usePromptVersionDiff, usePrompts } from '../data/queries.ts'
import { go } from '../router.ts'
import { Badge, Pill, Spinner, ago, plural, useToast } from '../ui.tsx'

const GROUP_ORDER = ['Linear', 'Worktree', 'Ma PR', 'Review', 'Qualité', 'Règles de review']

export function PromptsPage({ selected }: { selected?: string }) {
  const prompts = usePrompts()
  const list = prompts.data ?? []
  const current = list.find((p) => p.key === selected) ?? list[0]
  const groups = [...new Set(list.map((p) => p.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 99) % 100 - (GROUP_ORDER.indexOf(b) + 99) % 100)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => history.back()}><ArrowLeftIcon />Retour</Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prompts</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Les modèles envoyés à l’IA pour chaque action (<span className="font-mono text-xs">prompts/*.md</span>) et les règles de dev utilisées par la review (<span className="font-mono text-xs">rules/*.md</span>). Une modification est prise en compte dès le prochain lancement.
          </p>
        </div>
      </div>
      {prompts.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des prompts…</div>}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Liste des prompts" className="flex flex-col gap-5 lg:sticky lg:top-20 lg:w-64 lg:shrink-0">
          {groups.map((g) => (
            <div key={g} className="flex flex-col gap-0.5">
              <span className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{g}</span>
              {g === 'Règles de review' && <p className="px-2.5 pb-1.5 text-xs text-muted-foreground">Les règles de dev que la review applique, sans jamais les citer à l’auteur.</p>}
              {list.filter((p) => p.group === g).map((p) => {
                const active = p.key === current?.key
                return (
                  <button type="button"
                    key={p.key}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go({ page: 'prompts', key: p.key })}
                    className={cn(
                      'flex min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                      active && 'bg-accent font-medium text-accent-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1">{p.name}</span>
                    {p.modified && <Badge tone="amber">modifié</Badge>}
                  </button>
                )
              })}
              {g === 'Règles de review' && <NewRuleButton onCreated={(key) => go({ page: 'prompts', key })} />}
            </div>
          ))}
        </nav>
        {current && <PromptEditor key={current.key} prompt={current} />}
      </div>
    </div>
  )
}

function PromptEditor({ prompt }: { prompt: PromptInfo }) {
  const [value, setValue] = useState(prompt.content)
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useToast()
  const isRule = prompt.source === 'rule'
  const save = useSavePrompt(isRule ? 'rule' : 'prompt')
  const reset = useResetPrompt(isRule ? 'rule' : 'prompt')

  // Enregistrement automatique 600 ms après la dernière frappe.
  useEffect(() => {
    if (value === prompt.content) return
    setState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setState('saving')
      save.mutate({ key: prompt.key, content: value }, {
        onSuccess: () => setState('saved'),
        onError: (e) => {
          toast(e.message, true)
          setState('dirty')
        },
      })
    }, 600)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const vars = prompt.vars.map((v) => `{${v}}`)
  return (
    <article className="flex min-w-0 flex-1 flex-col gap-5 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{prompt.name}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{isRule ? 'Règles appliquées par la review et l’auto-review. L’agent s’en sert sans jamais les citer à l’auteur.' : `Utilisé par : ${prompt.when}`}</p>
        </div>
        <Badge tone={prompt.modified ? 'amber' : 'gray'}>{prompt.modified ? 'Modifié par rapport à la version commitée' : isRule ? 'Règles d’origine' : 'Prompt par défaut'}</Badge>
      </div>

      {isRule ? <RuleProjects prompt={prompt} content={value} /> : (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span><span className="text-muted-foreground">Modèle :</span> <span className="font-mono text-xs">{prompt.model ?? 'par défaut'}</span></span>
          <span><span className="text-muted-foreground">Permissions :</span> <span className="font-mono text-xs">{prompt.permissionMode}</span></span>
          {prompt.cost && (
            <span title="En équivalent API, sur les 30 derniers jours">
              <span className="text-muted-foreground">30 derniers jours :</span> {plural(prompt.cost.runs, 'agent lancé', 'agents lancés')} · ≈ {prompt.cost.averageUsd.toFixed(2)} $ en moyenne · {prompt.cost.totalUsd.toFixed(2)} $ au total
            </span>
          )}
        </div>
      )}

      {!isRule && <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Variables disponibles</span>
        <div className="flex flex-wrap gap-1.5">
          {vars.map((v) => <code key={v} className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">{v}</code>)}
        </div>
      </div>}

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="prompt-edit">{isRule ? 'Règles (Markdown : un titre ## par règle)' : 'Modèle'}</FieldLabel>
        <Textarea id="prompt-edit" rows={18} className="field-sizing-fixed min-h-[420px] font-mono text-xs leading-relaxed" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn('flex items-center gap-1.5 text-xs', state === 'dirty' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
            {state === 'saving' ? <Spinner className="size-3.5" /> : state === 'saved' ? <CheckIcon className="size-3.5" /> : <CircleDotIcon className="size-3.5" />}
            {state === 'saving' ? 'Enregistrement…' : state === 'dirty' ? 'Modifications non enregistrées' : 'Enregistré'}
          </span>
          <Button variant="outline" size="sm" disabled={reset.isPending || (!prompt.modified && value === prompt.defaultContent)} onClick={() => reset.mutate(prompt.key, {
            onSuccess: () => {
              setValue(prompt.defaultContent)
              toast('Prompt remis par défaut')
            },
            onError: (e) => toast(e.message, true),
          })}><RotateCcwIcon />Revenir au prompt par défaut</Button>
        </div>
      </div>

      <PromptHistory source={isRule ? 'rule' : 'prompt'} promptKey={prompt.key} onRestore={setValue} />

      {prompt.allowedTools.length > 0 && (
        <details className="group rounded-lg border bg-muted/40 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
            Outils autorisés ({prompt.allowedTools.length})
          </summary>
          <p className="mt-2 font-mono text-xs break-words text-muted-foreground">{prompt.allowedTools.join(' · ')}</p>
          <p className="mt-2 text-xs text-muted-foreground">Pour les changer, édite le front matter de <span className="font-mono">prompts/{prompt.key}.md</span>.</p>
        </details>
      )}
    </article>
  )
}

/** Versions d'avant chaque séance de modification : ce qui a changé depuis, et retour en arrière. */
function PromptHistory({ source, promptKey, onRestore }: { source: PromptSource; promptKey: string; onRestore: (content: string) => void }) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const history = usePromptHistory(source, promptKey, open)
  const versions = history.data ?? []
  return (
    <details className="group rounded-lg border bg-muted/40 px-3 py-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
        Versions précédentes
      </summary>
      {history.isPending && open && <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement…</div>}
      {history.isError && <p className="mt-2 text-xs text-destructive">Historique indisponible : {history.error.message}</p>}
      {history.isSuccess && !versions.length && <p className="mt-2 text-sm text-muted-foreground">Aucune version précédente : elles sont gardées à chaque séance de modification.</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 text-muted-foreground">Avant la modification ({ago(v.savedAt)})</span>
              <Button variant="ghost" size="sm" onClick={() => setShown(shown === v.id ? null : v.id)}>{shown === v.id ? 'Masquer' : 'Ce qui a changé depuis'}</Button>
              <Button variant="outline" size="sm" onClick={() => onRestore(v.content)}><HistoryIcon />Restaurer</Button>
            </div>
            {shown === v.id && <VersionDiff source={source} promptKey={promptKey} version={v.id} />}
          </li>
        ))}
      </ul>
    </details>
  )
}

function VersionDiff({ source, promptKey, version }: { source: PromptSource; promptKey: string; version: string }) {
  const diff = usePromptVersionDiff(source, promptKey, version)
  if (diff.isPending) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Calcul des différences…</div>
  if (diff.isError) return <p className="text-xs text-destructive">Différences indisponibles : {diff.error.message}</p>
  return (
    <Diff className="max-h-96 overflow-auto rounded-md border bg-card">
      {diff.data.length ? diff.data.map((l, i) => <DiffRow key={i} line={l} nums={[l.o, l.n]} />) : <p className="p-3 text-muted-foreground">Identique au texte actuel.</p>}
    </Diff>
  )
}

/** Projets auxquels une règle s'applique. */
function RuleProjects({ prompt, content }: { prompt: PromptInfo; content: string }) {
  const projects = useProjects()
  const toast = useToast()
  const saveRule = useSavePrompt('rule')
  const current = prompt.projects ?? ['all']
  const save = (next: string[]) => saveRule.mutate({ key: prompt.key, content, projects: next.length ? next : ['all'] }, { onError: (e) => toast(e.message, true) })
  const all = current.includes('all')
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">S’applique à</span>
      <div className="flex flex-wrap gap-2">
        <Pill active={all} onClick={() => save(['all'])}>Tous les projets</Pill>
        {projects.data?.map((p) => {
          const on = !all && current.includes(p.id)
          return (
            <Pill key={p.id} active={on} className="font-mono" onClick={() => save(on ? current.filter((x) => x !== p.id && x !== 'all') : [...current.filter((x) => x !== 'all'), p.id])}>{p.name}</Pill>
          )
        })}
      </div>
    </div>
  )
}

function NewRuleButton({ onCreated }: { onCreated: (key: string) => void }) {
  const toast = useToast()
  const create = useCreateRule()
  return (
    <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" disabled={create.isPending} onClick={() => {
      const name = prompt('Nom du groupe de règles (ex. Tests, Accessibilité)')
      if (!name?.trim()) return
      create.mutate(name.trim(), { onSuccess: (r) => onCreated(r.key), onError: (e) => toast(e.message, true) })
    }}><PlusIcon />Nouveau groupe de règles</Button>
  )
}
