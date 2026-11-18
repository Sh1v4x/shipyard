import { KeyRoundIcon, PencilIcon, PlayIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { PostmanAuthInfo, PostmanLink, PostmanRequest, PostmanRequestData, PostmanResponse, PostmanState, PostmanVariable } from '../../../../shared/types.ts'
import { useDeletePostmanRequest, useRunPostman, useSavePostmanRequest, useSetPostmanEnvironment, useSetPostmanVariable } from '../../data/mutations.ts'
import { usePostmanEnvironments } from '../../data/queries.ts'
import { Badge, ErrorBox, FoldCard, SectionLabel, Spinner, type Tone, plural, useToast } from '../../ui.tsx'

// Travail à la main sur le dossier Postman lié : voir l'autorisation et les variables qui s'appliquent, envoyer une
// requête et lire sa réponse, créer, modifier ou supprimer une requête.

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const METHOD_TONE: Record<string, Tone> = { GET: 'green', POST: 'blue', PUT: 'amber', PATCH: 'amber', DELETE: 'red' }
/** Valeur du choix « aucun environnement » (une liste déroulante n'accepte pas de valeur vide). */
const NO_ENV = '__none__'

export const Method = ({ method }: { method: string }) => <Badge tone={METHOD_TONE[method.toUpperCase()] ?? 'gray'} className="font-mono">{method.toUpperCase()}</Badge>

export const headerLines = (r: Pick<PostmanRequestData, 'headers'>) => r.headers.map((h) => `${h.key}: ${h.value}`).join('\n')

/** « Clé: valeur » par ligne, comme on les lit dans une requête HTTP. */
const parseHeaders = (text: string) =>
  text.split('\n').map((l) => l.match(/^\s*([^:\s][^:]*):\s?(.*)$/)).filter((m) => !!m).map((m) => ({ key: m[1].trim(), value: m[2].trim() }))

export function Code({ title, code, tone, wrap = false }: { title: string; code: string; tone?: 'red' | 'green'; wrap?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-md border', tone === 'red' && 'border-red-500/25', tone === 'green' && 'border-emerald-500/25')}>
      <span className={cn('px-3 py-1 text-xs font-medium', tone === 'red' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : tone === 'green' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>{title}</span>
      <code className={cn('block max-h-72 flex-1 overflow-auto bg-muted/40 p-3 font-mono text-xs leading-relaxed', wrap ? 'whitespace-pre-wrap' : 'whitespace-pre')}>{code || '(vide)'}</code>
    </div>
  )
}

const AUTH_LABEL: Record<string, string> = { noauth: 'Aucune', bearer: 'Bearer token', basic: 'Basic', apikey: 'Clé d’API', oauth2: 'OAuth 2.0' }
const authOrigin = (a: PostmanAuthInfo) => (a.from === 'request' ? 'posée sur la requête' : a.from === 'folder' ? `héritée du dossier ${a.source}` : a.from === 'collection' ? `héritée de la collection ${a.source}` : '')

/** L'autorisation qui s'applique, en une ligne : son type, qui la porte, ses paramètres (valeurs en clair masquées). */
export function AuthLine({ auth }: { auth: PostmanAuthInfo }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="font-medium">{AUTH_LABEL[auth.type] ?? auth.type}</span>
      {authOrigin(auth) && <span className="text-muted-foreground">{authOrigin(auth)}</span>}
      {auth.fields.map((f) => <span key={f.key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{f.key} = {f.value}</span>)}
      {!auth.supported && <Badge tone="amber">non gérée à l’envoi</Badge>}
    </p>
  )
}

const SOURCE: Record<PostmanVariable['source'], { label: string; tone: Tone }> = {
  local: { label: 'Shipyard', tone: 'blue' },
  environment: { label: 'Environnement', tone: 'green' },
  collection: { label: 'Collection', tone: 'gray' },
  missing: { label: 'Sans valeur', tone: 'amber' },
}

/**
 * Ce qui permet d'appeler les routes du dossier : l'autorisation héritée, l'environnement Postman choisi, et les
 * variables utilisées. Une valeur saisie ici reste sur ce Mac et passe avant celle de Postman (jeton de test…).
 */
export function AuthCard({ project, wtId, link, state }: { project: string; wtId: string; link: PostmanLink; state: PostmanState }) {
  const envs = usePostmanEnvironments(link.workspaceId)
  const setEnv = useSetPostmanEnvironment(project, wtId)
  const toast = useToast()
  const missing = state.variables.filter((v) => v.source === 'missing').length
  return (
    <FoldCard title="Autorisation et variables" icon={KeyRoundIcon} defaultOpen={missing > 0}
      badge={missing > 0 ? <Badge tone="amber">{plural(missing, 'variable sans valeur', 'variables sans valeur')}</Badge> : undefined}
      summary={[AUTH_LABEL[state.auth.type] ?? state.auth.type, link.environmentName ? `environnement ${link.environmentName}` : 'aucun environnement', plural(state.variables.length, 'variable', 'variables')].join(' · ')}>
      <div>
        <SectionLabel>Autorisation du dossier</SectionLabel>
        <AuthLine auth={state.auth} />
        <p className="mt-1.5 text-xs text-muted-foreground">Une requête sans autorisation propre hérite de celle-ci. Elle se règle dans Postman (onglet Authorization du dossier ou de la collection) ; ici tu donnes la valeur de ses variables.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`pm-env-${wtId}`}>Environnement Postman</FieldLabel>
        {link.workspaceId ? (
          <Select value={link.environmentId ?? NO_ENV} disabled={envs.isLoading || setEnv.isPending} onValueChange={(v) => setEnv.mutate(v === NO_ENV ? null : v, { onError: (e) => toast(e.message, true) })}>
            <SelectTrigger id={`pm-env-${wtId}`} className="w-full max-w-sm"><SelectValue placeholder={envs.isLoading ? 'Chargement…' : 'Aucun'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ENV}>Aucun</SelectItem>
              {(envs.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <p className="text-sm text-muted-foreground">Relie le dossier en choisissant son espace de travail pour proposer ses environnements.</p>}
        {envs.error && <ErrorBox error={envs.error} />}
        <p className="text-xs text-muted-foreground">Postman ne partage que les valeurs enregistrées de l’environnement : une valeur « courante » restée dans ton application Postman (un jeton collé à la main) n’arrive pas ici. Donne-la ci-dessous.</p>
      </div>
      <div>
        <SectionLabel>Variables utilisées par le dossier</SectionLabel>
        {state.variables.length === 0 ? <p className="text-sm text-muted-foreground">Aucune variable dans les requêtes de ce dossier.</p> : (
          <div className="overflow-hidden rounded-lg border">
            {state.variables.map((v) => <VariableRow key={v.key} project={project} wtId={wtId} v={v} />)}
          </div>
        )}
        <NewVariable project={project} wtId={wtId} />
      </div>
    </FoldCard>
  )
}

function VariableRow({ project, wtId, v }: { project: string; wtId: string; v: PostmanVariable }) {
  const set = useSetPostmanVariable(project, wtId)
  const toast = useToast()
  const [value, setValue] = useState('')
  const save = (next: string | null) => set.mutate({ key: v.key, value: next }, { onSuccess: () => setValue(''), onError: (e) => toast(e.message, true) })
  return (
    <form className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-2 first:border-t-0" onSubmit={(e) => { e.preventDefault(); if (value) save(value) }}>
      <span className="min-w-36 font-mono text-xs font-medium break-all">{`{{${v.key}}}`}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={v.secret ? undefined : v.value ?? undefined}>{v.value ?? '—'}</span>
      <Badge tone={SOURCE[v.source].tone}>{SOURCE[v.source].label}</Badge>
      <Input type={v.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} aria-label={`Valeur locale de ${v.key}`} className="h-7 w-48 font-mono text-xs" placeholder="Valeur dans Shipyard" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" size="sm" variant="outline" className="h-7" disabled={!value || set.isPending}>{set.isPending ? <Spinner /> : 'Définir'}</Button>
      {v.source === 'local' && <Button type="button" size="sm" variant="ghost" className="h-7" disabled={set.isPending} title="Revenir à la valeur de Postman" onClick={() => save(null)}>Retirer</Button>}
    </form>
  )
}

/** Une variable que les requêtes n'utilisent pas encore (celle d'une requête que je m'apprête à écrire). */
function NewVariable({ project, wtId }: { project: string; wtId: string }) {
  const set = useSetPostmanVariable(project, wtId)
  const toast = useToast()
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const valid = /^[^{}\s]+$/.test(key) && !!value
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => {
      e.preventDefault()
      if (valid) set.mutate({ key, value }, { onSuccess: () => { setKey(''); setValue('') }, onError: (err) => toast(err.message, true) })
    }}>
      <Input aria-label="Nom d’une nouvelle variable" className="h-7 w-44 font-mono text-xs" placeholder="nouvelleVariable" value={key} onChange={(e) => setKey(e.target.value.trim())} />
      <Input aria-label="Valeur de la nouvelle variable" autoComplete="off" spellCheck={false} className="h-7 w-56 font-mono text-xs" placeholder="valeur (gardée sur ce Mac)" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" size="sm" variant="ghost" className="h-7" disabled={!valid || set.isPending}><PlusIcon />Ajouter une variable</Button>
    </form>
  )
}

const statusTone = (s: number): Tone => (s < 300 ? 'green' : s < 400 ? 'blue' : s < 500 ? 'amber' : 'red')
const size = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`)

/** JSON indenté quand la réponse en est ; sinon le texte tel quel. */
function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

/** Réponse d'un envoi : statut, durée, ce qui a été appliqué, puis le corps et les headers. */
export function ResponseView({ res }: { res: PostmanResponse }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Badge tone={statusTone(res.status)} className="font-mono">{res.status} {res.statusText}</Badge>
        <span className="tabular-nums text-muted-foreground">{res.timeMs} ms · {size(res.size)}</span>
        <span className="text-xs text-muted-foreground">{new Date(res.at).toLocaleTimeString('fr-FR')}</span>
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">{res.method} {res.url}</p>
      <p className="text-xs text-muted-foreground">Autorisation : {res.auth}</p>
      {res.unresolved.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Variables sans valeur, envoyées telles quelles : {res.unresolved.map((k) => `{{${k}}}`).join(', ')}. Donne-leur une valeur dans « Autorisation et variables ».</p>}
      <Code title={res.truncated ? 'Réponse (coupée : trop longue)' : 'Réponse'} code={pretty(res.body)} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Headers de la réponse ({res.headers.length})</summary>
        <code className="mt-1.5 block overflow-auto rounded-md bg-muted/40 p-3 font-mono leading-relaxed whitespace-pre">{res.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}</code>
      </details>
    </div>
  )
}

/** Requêtes du dossier lié, par sous-dossier : chacune se déplie pour être envoyée, modifiée ou supprimée. */
export function RequestList({ project, wtId, state }: { project: string; wtId: string; state: PostmanState }) {
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const { requests } = state
  const groups = [...new Set(requests.map((r) => r.folder))]
  return (
    <div className="flex flex-col gap-4">
      {!requests.length && !creating && <p className="text-sm text-muted-foreground">Aucune requête dans ce dossier. Écris-en une, ou demande à l’agent d’y ajouter les routes de la branche.</p>}
      {groups.map((folder) => (
        <div key={folder} className="flex flex-col gap-1.5">
          {(folder || groups.length > 1) && <SectionLabel className="mb-0">{folder || 'À la racine du dossier'}</SectionLabel>}
          <div className="overflow-hidden rounded-lg border">
            {requests.filter((r) => r.folder === folder).map((r) => (
              <RequestRow key={r.id} project={project} wtId={wtId} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}
                last={state.responses.find((x) => x.requestId === r.id)} folders={state.folders} />
            ))}
          </div>
        </div>
      ))}
      {creating
        ? <RequestForm project={project} wtId={wtId} folders={state.folders} auth={state.auth} onDone={() => setCreating(false)} />
        : <div><Button size="sm" variant="outline" onClick={() => setCreating(true)}><PlusIcon />Nouvelle requête</Button></div>}
    </div>
  )
}

function RequestRow({ project, wtId, r, open, onToggle, last, folders }: { project: string; wtId: string; r: PostmanRequest; open: boolean; onToggle: () => void; last: PostmanResponse | undefined; folders: string[] }) {
  const run = useRunPostman(project, wtId)
  const remove = useDeletePostmanRequest(project, wtId)
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const res = run.data ?? last
  return (
    <div className="border-t first:border-t-0">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
        <Method method={r.method} />
        <span className="font-medium">{r.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{r.url}</span>
        {res && <Badge tone={statusTone(res.status)} className="font-mono">{res.status}</Badge>}
      </button>
      {open && (editing ? (
        <div className="border-t bg-muted/20 p-3">
          <RequestForm project={project} wtId={wtId} folders={folders} auth={r.auth} current={r} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-3">
          <p className="font-mono text-xs break-all">{r.url}</p>
          <AuthLine auth={r.auth} />
          {r.headers.length > 0 && <Code title="Headers" code={headerLines(r)} />}
          {r.body && <Code title={r.bodyMode === 'raw' ? 'Body' : `Body (${r.bodyMode})`} code={r.body} />}
          {r.description && <Code title="Description" code={r.description} wrap />}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={run.isPending || r.bodyMode === 'file'} title={r.bodyMode === 'file' ? 'Requête avec un fichier : à envoyer depuis Postman' : 'La requête part vraiment vers cette adresse'} onClick={() => run.mutate({ requestId: r.id })}>
              {run.isPending ? <Spinner /> : <PlayIcon />}Envoyer
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PencilIcon />Modifier</Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending}
              onClick={() => confirm(`Supprimer « ${r.name} » de la collection Postman ?`) && remove.mutate(r.id, { onSuccess: () => toast(`« ${r.name} » supprimée de Postman`), onError: (e) => toast(e.message, true) })}>
              {remove.isPending ? <Spinner /> : <Trash2Icon />}Supprimer
            </Button>
          </div>
          {run.error && <ErrorBox error={run.error} />}
          {res && !run.isPending && <ResponseView res={res} />}
        </div>
      ))}
    </div>
  )
}

/** Écrire une requête à la main (ou en modifier une) : on peut l'essayer avant de l'enregistrer dans Postman. */
function RequestForm({ project, wtId, folders, auth, current, onDone }: { project: string; wtId: string; folders: string[]; auth: PostmanAuthInfo; current?: PostmanRequest; onDone: () => void }) {
  const run = useRunPostman(project, wtId)
  const save = useSavePostmanRequest(project, wtId)
  const toast = useToast()
  const [f, setF] = useState({ name: current?.name ?? '', method: current?.method ?? 'GET', url: current?.url ?? '', folder: current?.folder ?? '', headers: current ? headerLines(current) : '', body: current?.body ?? '', description: current?.description ?? '' })
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))
  // Corps form-data, urlencoded ou GraphQL : affiché en aperçu, il ne se réécrit pas d'ici.
  const rawBody = !current || current.bodyMode === 'raw' || current.bodyMode === 'none'
  const data: PostmanRequestData = { name: f.name.trim(), method: f.method, url: f.url.trim(), headers: parseHeaders(f.headers), body: rawBody ? f.body : null, description: f.description }
  const valid = !!data.name && !!data.url
  const id = current?.id ?? 'new'
  return (
    <form className="flex flex-col gap-3 rounded-lg border bg-card p-4" onSubmit={(e) => {
      e.preventDefault()
      if (!valid) return
      save.mutate({ ...data, id: current?.id ?? null, folder: f.folder.trim() }, {
        onSuccess: () => {
          toast(current ? `« ${data.name} » mise à jour dans Postman` : `« ${data.name} » créée dans Postman`)
          onDone()
        },
        onError: (err) => toast(err.message, true),
      })
    }}>
      <p className="font-semibold">{current ? `Modifier « ${current.name} »` : 'Nouvelle requête'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" id={`pm-name-${id}`}><Input id={`pm-name-${id}`} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Se connecter" /></Field>
        {!current && (
          <Field label="Sous-dossier" id={`pm-folder-${id}`} hint="Vide : à la racine du dossier lié. Créé s’il n’existe pas.">
            <Input id={`pm-folder-${id}`} list={`pm-folders-${id}`} value={f.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="Auth" />
            <datalist id={`pm-folders-${id}`}>{folders.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={f.method} onValueChange={(v) => set({ method: v })}>
          <SelectTrigger className="w-28 font-mono text-xs" aria-label="Méthode"><SelectValue /></SelectTrigger>
          <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input aria-label="Adresse" className="min-w-0 flex-1 font-mono text-xs" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="{{baseUrl}}/auth/login" />
      </div>
      <AuthLine auth={auth} />
      <Field label="Headers" id={`pm-headers-${id}`} hint="Un par ligne, « Nom: valeur ». L’autorisation ci-dessus s’ajoute toute seule à l’envoi.">
        <Textarea id={`pm-headers-${id}`} rows={2} className="font-mono text-xs" value={f.headers} onChange={(e) => set({ headers: e.target.value })} placeholder="Content-Type: application/json" />
      </Field>
      {rawBody
        ? <Field label="Body" id={`pm-body-${id}`}><Textarea id={`pm-body-${id}`} rows={6} className="font-mono text-xs" value={f.body} onChange={(e) => set({ body: e.target.value })} placeholder={'{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}'} /></Field>
        : <p className="text-sm text-muted-foreground">Le body de cette requête est en {current?.bodyMode} : il se modifie dans Postman.</p>}
      <Field label="Description" id={`pm-desc-${id}`}><Textarea id={`pm-desc-${id}`} rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!data.url || run.isPending || !rawBody} title="Envoie ce brouillon sans l’enregistrer" onClick={() => run.mutate({ requestId: current?.id, request: { ...data, name: data.name || 'Brouillon' } })}>
          {run.isPending ? <Spinner /> : <PlayIcon />}Tester
        </Button>
        <Button type="submit" size="sm" disabled={!valid || save.isPending}>{save.isPending ? <Spinner /> : <SaveIcon />}{current ? 'Enregistrer dans Postman' : 'Créer dans Postman'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
      {run.error && <ErrorBox error={run.error} />}
      {run.data && !run.isPending && <ResponseView res={run.data} />}
    </form>
  )
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
