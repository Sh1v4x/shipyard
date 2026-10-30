import { BellIcon, ChevronRightIcon, FolderGit2Icon, KeyRoundIcon, LanguagesIcon, Link2Icon, PaletteIcon, PlusIcon, TagsIcon, Trash2Icon, XIcon, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { LabelRole, Language, Languages, Project } from '../../../shared/types.ts'
import { DEFAULT_LABEL_RULES, LABEL_ROLES } from '../../../shared/review.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useRemoveProject, useSaveSettings, useSetProjectGroup, useTestNotification } from '../data/mutations.ts'
import { useAllRepoLabels, useProjects, useSettings } from '../data/queries.ts'
import { CredentialsSection } from '../components/Credentials.tsx'
import { Badge, Pill, Spinner, useToast } from '../ui.tsx'
import { useTheme } from '../theme.tsx'
import { go } from '../router.ts'

const INTERVALS: [number, string][] = [[60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min']]
const DURATIONS: [number, string][] = [[10, '10 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']]

const SECTIONS = ['appearance', 'languages', 'credentials', 'projects', 'groups', 'labels', 'notifications'] as const
type SectionKey = (typeof SECTIONS)[number]

/** Les sections repliées sont mémorisées (pas les ouvertes) : une nouvelle section s'affiche ouverte. */
const CLOSED_SECTIONS = 'devpanel:settingsClosed'

/** Sections dépliées de la page, mémorisées. Par défaut, toutes sont ouvertes. */
function useOpenSections() {
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(CLOSED_SECTIONS) ?? '[]')
      return Array.isArray(v) ? v.map(String) : []
    } catch {
      return []
    }
  })
  const save = (next: string[]) => {
    setClosed(next)
    try { localStorage.setItem(CLOSED_SECTIONS, JSON.stringify(next)) } catch { /* stockage indisponible */ }
  }
  const open = SECTIONS.filter((k) => !closed.includes(k))
  const toggle = (k: SectionKey) => save(closed.includes(k) ? closed.filter((x) => x !== k) : [...closed, k])
  return { open, toggle, setAll: (v: boolean) => save(v ? [] : [...SECTIONS]) }
}

export function SettingsPage() {
  const sections = useOpenSections()
  const allOpen = sections.open.length === SECTIONS.length
  const section = (key: SectionKey) => ({ open: sections.open.includes(key), onToggle: () => sections.toggle(key) })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connexions à GitHub et Linear, labels reconnus et notifications, pour tous tes projets.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => sections.setAll(!allOpen)}>{allOpen ? 'Tout replier' : 'Tout déplier'}</Button>
      </div>

      <AppearanceSection {...section('appearance')} />

      <LanguagesSection {...section('languages')} />

      <Section
        {...section('credentials')}
        icon={KeyRoundIcon}
        title="Connexions"
        description={<>Claude Code fait tourner les agents sur ton abonnement. Les clés Linear et GitHub sont vérifiées, puis enregistrées dans <span className="font-mono text-xs">.env.local</span> sur ta machine (jamais commité). Elles s’appliquent tout de suite, sans redémarrer.</>}
      >
        <CredentialsSection />
      </Section>

      <Section
        {...section('projects')}
        icon={FolderGit2Icon}
        title="Projets suivis"
        description="Les dépôts que Shipyard suit. Retirer un projet arrête seulement son suivi : le clone, ses worktrees et ses branches restent sur ton disque et sur GitHub, et tu peux le rajouter à tout moment."
      >
        <ProjectsSettings />
      </Section>

      <Section
        {...section('groups')}
        icon={Link2Icon}
        title="Projets liés"
        description="Range dans un même groupe les dépôts d’un même produit (ex. API, web et mobile). Tu pourras ensuite associer leurs worktrees : plan, travail et review des agents porteront alors sur tous les dépôts associés à la fois. Sans association, rien ne change."
      >
        <GroupsSettings />
      </Section>

      <Section
        {...section('labels')}
        icon={TagsIcon}
        title="Labels reconnus"
        description="Une seule liste pour tous les projets : chaque label ajouté ici est détecté sur n’importe quel dépôt et déclenche l’automatisation de son rôle. La casse est ignorée."
      >
        <LabelsSettings />
      </Section>

      <NotificationsSection {...section('notifications')} />
    </div>
  )
}

/** Carte de réglages repliable : un clic sur l'en-tête plie ou déplie le contenu. */
function Section({ icon: IconCmp, title, description, aside, open, onToggle, children }: {
  icon: LucideIcon
  title: string
  description: ReactNode
  aside?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const id = `settings-${title}`
  return (
    <section className="flex flex-col rounded-xl border bg-card shadow-xs">
      <div className="flex items-start justify-between gap-4 p-5">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="group/s flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronRightIcon className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold"><IconCmp className="size-4" />{title}</span>
            {open && <span className="mt-1 block text-sm text-muted-foreground">{description}</span>}
          </span>
        </button>
        {aside}
      </div>
      {open && <div id={id} className="flex flex-col gap-6 px-5 pb-5">{children}</div>}
    </section>
  )
}

const LANGUAGE_ROWS: { key: keyof Languages; title: string; help: string }[] = [
  { key: 'app', title: 'Réponses des agents dans Shipyard', help: 'Analyses, plans, audits, résumés, verdicts de test, daily.' },
  { key: 'github', title: 'Ce qui est posté sur GitHub', help: 'Commentaires de review et réponses dans les fils de discussion.' },
  { key: 'pr', title: 'Description des PR', help: 'Le corps de la PR rédigé par l’IA. Le titre suit toujours les conventional commits, en anglais.' },
  { key: 'tickets', title: 'Tickets Linear', help: 'Titre et description des tickets rédigés par l’IA.' },
]

/** Langue de ce que les agents écrivent, par destinataire : injectée dans les prompts ({lang.app}, {lang.github}…). */
function LanguagesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const settings = useSettings()
  const save = useSaveSettings()
  const toast = useToast()
  const l = settings.data?.languages
  const set = (key: keyof Languages, v: Language) => l && save.mutate({ languages: { ...l, [key]: v } }, { onError: (e) => toast(e.message, true) })
  return (
    <Section
      open={open}
      onToggle={onToggle}
      icon={LanguagesIcon}
      title="Langues"
      description="Langue de ce que les agents écrivent, selon qui le lit. Les prompts eux-mêmes sont en anglais ; le code, les commentaires de code, les titres de commit et les noms de branche restent toujours en anglais."
    >
      {settings.isLoading && <Spinner />}
      {l && LANGUAGE_ROWS.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-[1_1_280px]">
            <p className="text-sm font-medium">{r.title}</p>
            <p className="text-xs text-muted-foreground">{r.help}</p>
          </div>
          <fieldset className="flex gap-1.5" aria-label={r.title}>
            <Pill active={l[r.key] === 'fr'} onClick={() => set(r.key, 'fr')}>Français</Pill>
            <Pill active={l[r.key] === 'en'} onClick={() => set(r.key, 'en')}>English</Pill>
          </fieldset>
        </div>
      ))}
    </Section>
  )
}

/** Thème cyberpunk : propre à ce navigateur, comme le choix clair / sombre. */
function AppearanceSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { cyber, setCyber } = useTheme()
  return (
    <Section
      open={open}
      onToggle={onToggle}
      icon={PaletteIcon}
      title="Apparence"
      description="Le thème cyberpunk passe l’interface en néon sur fond noir : titres façon terminal, lignes de balayage, petites animations à l’ouverture des pages et palette ⌘K en console. Il remplace le choix clair / sombre tant qu’il est actif. Les animations se coupent si macOS demande de réduire les animations."
      aside={<Switch checked={cyber} onCheckedChange={setCyber} aria-label="Activer le thème cyberpunk" />}
    >
      <p className="text-sm text-muted-foreground">{cyber ? 'Thème cyberpunk actif.' : 'Thème cyberpunk désactivé : clair, sombre ou système, depuis le bouton en haut à droite.'}</p>
    </Section>
  )
}

function NotificationsSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const settings = useSettings()
  const save = useSaveSettings()
  const test = useTestNotification()
  const toast = useToast()
  const n = settings.data?.notifications
  const set = (patch: Partial<NonNullable<typeof n>>) => n && save.mutate({ notifications: { ...n, ...patch } }, { onError: (e) => toast(e.message, true) })

  return (
    <Section
      open={open}
      onToggle={onToggle}
      icon={BellIcon}
      title="Notifications"
      description="Le serveur vérifie GitHub et Linear à intervalle régulier et te prévient quand une tâche apparaît : review demandée, nouveau commentaire, CI en échec, conflit, PR à tester ou review à relancer, nouveau ticket en Todo. Un clic sur la notification ouvre la bonne page."
      aside={n && <Switch checked={n.enabled} onCheckedChange={(v) => set({ enabled: v })} aria-label="Activer les notifications" />}
    >
      {settings.isLoading && <Spinner />}
      {n && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Vérifier toutes les</span>
            <div className="flex flex-wrap gap-1.5">
              {INTERVALS.map(([v, l]) => <Pill key={v} active={n.intervalSec === v} disabled={!n.enabled} onClick={() => set({ intervalSec: v })}>{l}</Pill>)}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Garder la notification affichée</span>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map(([v, l]) => <Pill key={v} active={n.durationSec === v} disabled={!n.enabled} onClick={() => set({ durationSec: v })}>{l}</Pill>)}
            </div>
            <p className="text-xs text-muted-foreground">
              Les notifications viennent de l’app « Shipyard », lancée par le serveur : elles fonctionnent avec n’importe quel navigateur, même sans onglet ouvert. Pour qu’elles restent à l’écran toute la durée choisie, règle « Shipyard » sur le style « Persistant » dans Réglages Système › Notifications (en « Bannière », macOS les masque au bout de quelques secondes, mais elles restent dans le centre de notifications jusqu’à la fin de la durée).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button variant="outline" className="ml-auto" disabled={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => toast('Notification envoyée : si rien ne s’affiche, autorise « Shipyard » dans Réglages Système › Notifications.'), onError: (e) => toast(e.message, true) })}>
              {test.isPending && <Spinner />}Envoyer une notification de test
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}

// ---------- Labels ----------

function LabelsSettings() {
  const settings = useSettings()
  const save = useSaveSettings()
  const repo = useAllRepoLabels()
  const toast = useToast()
  const rules = settings.data?.labels
  if (settings.isLoading) return <Spinner />
  if (!rules) return null
  const setRole = (role: LabelRole, names: string[]) => save.mutate({ labels: { ...rules, [role]: names } }, { onError: (e) => toast(e.message, true) })
  const isDefault = (Object.keys(DEFAULT_LABEL_RULES) as LabelRole[]).every((r) => rules[r].join('\n') === DEFAULT_LABEL_RULES[r].join('\n'))

  return (
    <>
      <datalist id="repo-labels">{repo.names.map((n) => <option key={n} value={n} />)}</datalist>
      {LABEL_ROLES.map((r) => <RoleLabels key={r.role} meta={r} names={rules[r.role]} repoNames={repo.loading ? null : repo.names} onChange={(names) => setRole(r.role, names)} />)}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        <span>Les labels en pointillés n’existent dans aucun des dépôts suivis : ils ne seront jamais détectés tant qu’ils n’y sont pas créés.</span>
        {!isDefault && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={save.isPending} onClick={() => confirm('Rétablir les labels par défaut ?') && save.mutate({ labels: DEFAULT_LABEL_RULES })}>
            Rétablir les labels par défaut
          </Button>
        )}
      </div>
    </>
  )
}

function RoleLabels({ meta, names, repoNames, onChange }: { meta: (typeof LABEL_ROLES)[number]; names: string[]; repoNames: string[] | null; onChange: (names: string[]) => void }) {
  const [value, setValue] = useState('')
  const known = (n: string) =>
    !repoNames || meta.source === 'Linear' || repoNames.some((r) => r.toLowerCase() === n.toLowerCase())
  const add = () => {
    const v = value.trim()
    if (!v) return
    if (!names.some((n) => n.toLowerCase() === v.toLowerCase())) onChange([...names, v])
    setValue('')
  }
  return (
    <div className="flex flex-col gap-2 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{meta.title}</span>
        <Badge tone={meta.source === 'GitHub' ? 'gray' : 'blue'}>{meta.source}</Badge>
        {meta.match === 'contains' && <Badge tone="gray">contient</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{meta.help}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {names.map((n) => (
          <span
            key={n}
            title={known(n) ? undefined : 'Absent des dépôts suivis'}
            className={cn('inline-flex h-7 items-center gap-1 rounded-full border bg-background pr-1 pl-2.5 text-xs font-medium dark:bg-input/30', !known(n) && 'border-dashed text-muted-foreground')}
          >
            {n}
            <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Retirer ${n}`} onClick={() => onChange(names.filter((x) => x !== n))}>
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {!names.length && <span className="text-xs text-muted-foreground italic">Aucun label : ce rôle est désactivé.</span>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
        <Input list={meta.source === 'GitHub' ? 'repo-labels' : undefined} className="h-8 max-w-xs text-xs" placeholder="Ajouter un label…" aria-label={`Ajouter un label « ${meta.title} »`} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={!value.trim()}>Ajouter</Button>
      </form>
    </div>
  )
}

/** Groupe de chaque projet : un nom libre, partagé par les projets liés. */
function ProjectsSettings() {
  const projects = useProjects()
  const remove = useRemoveProject()
  const toast = useToast()
  const removeProject = (p: Project) => {
    if (!confirm(`Retirer ${p.name} de Shipyard ?\n\nLe clone, ses worktrees et ses branches restent sur ton disque et sur GitHub : seul son suivi s’arrête.`)) return
    remove.mutate(p.id, { onSuccess: () => toast(`${p.name} retiré de Shipyard`), onError: (e) => toast(e.message, true) })
  }

  if (projects.isLoading) return <Spinner />
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y rounded-lg border">
        {(projects.data ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="font-mono text-xs break-all text-muted-foreground">{p.repo} · {p.path}</p>
            </div>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={remove.isPending && remove.variables === p.id} onClick={() => removeProject(p)}>
              {remove.isPending && remove.variables === p.id ? <Spinner /> : <Trash2Icon />}Retirer
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => go({ page: 'add-project' })}><PlusIcon />Ajouter un projet</Button>
    </div>
  )
}

function GroupsSettings() {
  const projects = useProjects()
  const save = useSetProjectGroup()
  const toast = useToast()
  const groups = [...new Set((projects.data ?? []).map((p) => p.group).filter((g): g is string => !!g))].sort()
  const set = (project: string, group: string | null) =>
    save.mutate({ project, group }, { onSuccess: (p) => toast(p.group ? `${p.name} rangé dans « ${p.group} »` : `${p.name} retiré de son groupe`), onError: (e) => toast(e.message, true) })

  if (projects.isLoading) return <Spinner />
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      <datalist id="project-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      {(projects.data ?? []).map((p) => {
        const mates = p.group ? (projects.data ?? []).filter((x) => x.id !== p.id && x.group === p.group) : []
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{p.repo}</p>
            </div>
            {mates.length > 0 && <Badge tone="blue">avec {mates.map((m) => m.name).join(', ')}</Badge>}
            <form className="flex items-center gap-1.5" onSubmit={(e) => {
              e.preventDefault()
              const v = String(new FormData(e.currentTarget).get('group') ?? '').trim()
              if (v !== (p.group ?? '')) set(p.id, v || null)
            }}>
              <Input key={p.group ?? ''} name="group" list="project-groups" defaultValue={p.group ?? ''} placeholder="Aucun groupe" className="h-8 w-40 text-sm"
                onBlur={(e) => e.currentTarget.form?.requestSubmit()} aria-label={`Groupe de ${p.name}`} />
              {p.group && (
                <Button type="button" variant="ghost" size="icon-sm" className="size-8" aria-label={`Retirer ${p.name} de son groupe`} onClick={() => set(p.id, null)}><XIcon /></Button>
              )}
            </form>
          </div>
        )
      })}
    </div>
  )
}
