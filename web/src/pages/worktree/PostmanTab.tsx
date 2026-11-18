import { ArrowRightIcon, CheckIcon, FolderIcon, Link2OffIcon, RefreshCwIcon, SendIcon, SettingsIcon, UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { PostmanApplied, PostmanLink, PostmanOperation, PostmanOutput, PostmanRequest } from '../../../../shared/types.ts'
import { Markdown } from '../../components/Markdown.tsx'
import { useApplyPostman, useLinkPostman, useRefreshPostman, useUnlinkPostman } from '../../data/mutations.ts'
import { usePostman, usePostmanApplied, usePostmanCollections, usePostmanFolders, usePostmanWorkspaces } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Badge, Empty, ErrorBox, FoldCard, PromptMenu, RunPanel, RunningBadge, SectionLabel, Spinner, type Tone, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { AuthCard, Code, Method, RequestList, headerLines } from './PostmanRequests.tsx'

/** Valeur du choix « racine de la collection » (une liste déroulante n'accepte pas de valeur vide). */
const ROOT = '__root__'

const OP: Record<PostmanOperation['op'], { label: string; tone: Tone }> = {
  create: { label: 'Créer', tone: 'green' },
  update: { label: 'Modifier', tone: 'amber' },
  delete: { label: 'Supprimer', tone: 'red' },
}

const where = (link: PostmanLink) => `${link.collectionName}${link.folderPath ? ` / ${link.folderPath}` : ''}`

/**
 * Outil Postman d'un worktree (catégorie « Outils ») : un dossier d'une collection lié à la branche,
 * ses requêtes, et un agent qui propose les requêtes à créer ou à mettre à jour d'après le code. Rien n'est écrit
 * dans Postman avant mon accord.
 */
export function PostmanTab({ project, wtId }: TabProps) {
  const q = usePostman(project.id, wtId)
  const [picking, setPicking] = useState(false)
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Lecture du dossier Postman…</div>
  if (!q.data) return <ErrorBox error={q.error ?? 'Postman illisible'} />
  const { configured, link, requests, folders, error } = q.data
  if (!configured) {
    return (
      <Empty title="Postman n’est pas connecté" icon={SendIcon} action={<Button size="sm" onClick={() => go({ page: 'settings', section: 'credentials' })}><SettingsIcon />Ouvrir les réglages</Button>}>
        Ajoute ta clé API Postman dans Réglages › Connexions pour lier un dossier de collection à ce worktree.
      </Empty>
    )
  }
  if (!link || picking) return <LinkPicker project={project.id} wtId={wtId} current={link} onDone={() => setPicking(false)} />
  return (
    <section className="flex flex-col gap-4" aria-label="Postman">
      <LinkHeader project={project.id} wtId={wtId} link={link} count={requests.length} onChange={() => setPicking(true)} />
      {error ? <ErrorBox error={error} /> : (
        <>
          <AuthCard project={project.id} wtId={wtId} link={link} state={q.data} />
          <FoldCard title="Requêtes du dossier" icon={FolderIcon} defaultOpen
            summary={requests.length ? [plural(requests.length, 'requête', 'requêtes'), folders.length && plural(folders.length, 'sous-dossier', 'sous-dossiers'), 'envoyer, écrire, modifier'].filter(Boolean).join(' · ') : 'Dossier vide pour l’instant : écris une première requête'}>
            <RequestList project={project.id} wtId={wtId} state={q.data} />
          </FoldCard>
          <Composer project={project.id} wtId={wtId} link={link} requests={requests} />
        </>
      )}
    </section>
  )
}

function LinkHeader({ project, wtId, link, count, onChange }: { project: string; wtId: string; link: PostmanLink; count: number; onChange: () => void }) {
  const refresh = useRefreshPostman(project, wtId)
  const unlink = useUnlinkPostman(project, wtId)
  const toast = useToast()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">Dossier lié à ce worktree</p>
        <p className="font-semibold break-words">{where(link)}{!link.folderPath && <span className="font-normal text-muted-foreground"> · racine de la collection</span>}</p>
      </div>
      <Badge tone="gray">{plural(count, 'requête', 'requêtes')}</Badge>
      <Button size="sm" variant="ghost" disabled={refresh.isPending} title="Relire le dossier dans Postman" onClick={() => refresh.mutate(undefined, { onError: (e) => toast(e.message, true) })}>
        {refresh.isPending ? <Spinner /> : <RefreshCwIcon />}Actualiser
      </Button>
      <Button size="sm" variant="outline" onClick={onChange}>Changer de dossier</Button>
      <Button size="sm" variant="ghost" disabled={unlink.isPending} title="Le dossier reste tel quel dans Postman"
        onClick={() => confirm('Délier ce dossier du worktree ? Rien n’est supprimé dans Postman.') && unlink.mutate(undefined, { onSuccess: () => toast('Dossier Postman délié'), onError: (e) => toast(e.message, true) })}>
        <Link2OffIcon />Délier
      </Button>
    </div>
  )
}

/** Choix du dossier : espace de travail, collection, puis dossier (ou la racine de la collection). */
function LinkPicker({ project, wtId, current, onDone }: { project: string; wtId: string; current: PostmanLink | null; onDone: () => void }) {
  const toast = useToast()
  const [picked, setPicked] = useState<{ ws: string | null; col: string | null; folder: string }>({ ws: current?.workspaceId ?? null, col: current?.collectionId ?? null, folder: current?.folderId ?? ROOT })
  const workspaces = usePostmanWorkspaces(true)
  // Un seul espace de travail : choisi d'office.
  const ws = picked.ws ?? (workspaces.data?.length === 1 ? workspaces.data[0].id : null)
  const collections = usePostmanCollections(ws)
  const folders = usePostmanFolders(picked.col)
  const link = useLinkPostman(project, wtId)
  const failure = workspaces.error ?? collections.error ?? folders.error
  return (
    <section aria-label="Lier un dossier Postman" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><SendIcon className="size-4" /></div>
        <div className="min-w-0">
          <p className="font-semibold">{current ? 'Changer de dossier Postman' : 'Lier un dossier Postman à ce worktree'}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Facultatif. Une fois le dossier lié, tu demandes ici d’y ajouter les routes de la branche ou de mettre à jour ses requêtes : l’agent lit le code du worktree, propose, et rien n’est écrit dans Postman sans ton accord.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <PickField label="Espace de travail" id={`pm-ws-${wtId}`} value={ws} loading={workspaces.isLoading} placeholder="Choisir un espace"
          options={workspaces.data ?? []} onChange={(v) => setPicked({ ws: v, col: null, folder: ROOT })} />
        <PickField label="Collection" id={`pm-col-${wtId}`} value={picked.col} loading={collections.isLoading} disabled={!ws} placeholder={ws ? 'Choisir une collection' : 'Choisis d’abord un espace'}
          options={collections.data ?? []} onChange={(v) => setPicked({ ws, col: v, folder: ROOT })} />
        <PickField label="Dossier" id={`pm-folder-${wtId}`} value={picked.col ? picked.folder : null} loading={folders.isLoading} disabled={!picked.col} placeholder="Choisis d’abord une collection"
          options={[{ id: ROOT, name: 'Racine de la collection' }, ...(folders.data ?? []).map((f) => ({ id: f.id, name: f.path }))]} onChange={(v) => setPicked({ ...picked, ws, folder: v })} />
      </div>
      {failure && <ErrorBox error={failure} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!picked.col || link.isPending}
          onClick={() => picked.col && link.mutate({ workspaceId: ws, collectionId: picked.col, folderId: picked.folder === ROOT ? null : picked.folder }, {
            onSuccess: (l) => {
              toast(`Dossier lié : ${where(l)}`)
              onDone()
            },
            onError: (e) => toast(e.message, true),
          })}>
          {link.isPending ? <Spinner /> : <CheckIcon />}Lier ce dossier
        </Button>
        {current && <Button size="sm" variant="ghost" onClick={onDone}>Annuler</Button>}
      </div>
    </section>
  )
}

function PickField({ label, id, value, options, placeholder, loading, disabled, onChange }: {
  label: string
  id: string
  value: string | null
  options: { id: string; name: string }[]
  placeholder: string
  loading: boolean
  disabled?: boolean
  onChange: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger id={id} className="w-full min-w-0"><SelectValue placeholder={loading ? 'Chargement…' : placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          {!options.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">Rien à choisir ici.</p>}
        </SelectContent>
      </Select>
    </div>
  )
}

/** La demande à l'agent, son passage, puis ses propositions à approuver. */
function Composer({ project, wtId, link, requests }: { project: string; wtId: string; link: PostmanLink; requests: PostmanRequest[] }) {
  const ask = useAction<PostmanOutput>('postman', { project, worktree: wtId })
  const [text, setText] = useState('')
  const [followUp, setFollowUp] = useState('')
  // L'agent envoie lui-même les requêtes : elles partent vraiment vers l'API visée, donc seulement si je le demande.
  const [runCalls, setRunCalls] = useState(false)
  const r = ask.result
  const send = async (request: string, previousRunId?: string) => {
    if (!request.trim()) return
    const id = await ask.start({ extra: request.trim(), previousRunId, runCalls })
    if (id) {
      setText('')
      setFollowUp('')
    }
  }
  return (
    <section aria-label="Travailler sur le dossier Postman" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`postman-ask-${wtId}`}>Travailler avec l’agent : que veux-tu faire dans ce dossier ?</FieldLabel>
        <Textarea id={`postman-ask-${wtId}`} rows={3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Ex. : ajoute les routes créées par cette branche · mets à jour le body de « Créer un job » d’après le nouveau schéma · quelles routes du module billing manquent dans ce dossier ?" />
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={runCalls} onCheckedChange={(v) => setRunCalls(v === true)} />
          <span>L’agent peut envoyer les requêtes <span className="text-muted-foreground">: il teste les appels lui-même et lit les réponses (il ne voit ni jeton ni mot de passe). Les appels partent vraiment vers l’API visée par les variables.</span></span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!text.trim() || ask.busy} onClick={() => void send(text)}>
            {ask.busy ? <Spinner /> : <SendIcon />}Demander à l’agent
          </Button>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">L’agent part du ticket, des commits et du diff de la branche, et lit le code du worktree.</span>
          {ask.working && <RunningBadge />}
          <PromptMenu items={[['postman', 'Travail sur le dossier Postman']]} />
        </div>
      </div>
      <RunPanel id={ask.id} events={ask.events} running={ask.running} run={ask.run} label="L’agent lit le code et prépare les requêtes" onStop={ask.stop} action={ask} />
      {r && ask.id && !ask.busy && (
        <div className="flex flex-col gap-4 border-t border-dashed pt-4">
          {ask.run?.request && (
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <SectionLabel>Ta demande</SectionLabel>
              <p className="whitespace-pre-line">{ask.run.request}</p>
            </div>
          )}
          <Markdown text={r.summary} className="text-[15px] leading-relaxed font-medium" />
          {r.details.trim() && <Markdown text={r.details} className="text-sm leading-relaxed" />}
          {r.operations.length > 0 && <Proposals key={ask.id} project={project} wtId={wtId} runId={ask.id} link={link} operations={r.operations} requests={requests} />}
          {r.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{r.files.join(' · ')}</p>}
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={`postman-more-${wtId}`}>Préciser <span className="font-normal text-muted-foreground">(l’agent reprend avec tout le contexte de l’échange)</span></FieldLabel>
            <Textarea id={`postman-more-${wtId}`} rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Ex. : range-les dans un sous-dossier « Jobs » · ajoute aussi la route d’export · le token est dans {{adminToken}}" />
            <div><Button size="sm" variant="outline" disabled={!followUp.trim() || ask.busy} onClick={() => void send(followUp, ask.id ?? undefined)}>Continuer l’échange</Button></div>
          </div>
        </div>
      )}
    </section>
  )
}

/** Propositions d'un passage : cochées par défaut, écrites dans Postman à la demande, une seule fois chacune. */
function Proposals({ project, wtId, runId, link, operations, requests }: { project: string; wtId: string; runId: string; link: PostmanLink; operations: PostmanOperation[]; requests: PostmanRequest[] }) {
  const applied = usePostmanApplied(runId)
  const apply = useApplyPostman(project, wtId)
  const toast = useToast()
  const [skipped, setSkipped] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const done = (i: number): PostmanApplied | undefined => applied.data?.find((a) => a.index === i)
  const todo = operations.map((_, i) => i).filter((i) => !done(i) && !skipped.includes(i))
  const left = operations.filter((_, i) => !done(i)).length
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel className="mb-0">{left ? `Propositions · ${left} à écrire dans ${where(link)}` : 'Propositions · toutes écrites dans Postman'}</SectionLabel>
      <div className="overflow-hidden rounded-lg border">
        {operations.map((op, i) => {
          const id = `postman-op-${runId}-${i}`
          const written = !!done(i)
          return (
            <div key={id} className="flex gap-3 border-t px-4 py-3 first:border-t-0">
              {written
                ? <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white" title="Écrit dans Postman"><CheckIcon className="size-2.5" strokeWidth={3} /></span>
                : <Checkbox id={id} className="mt-0.5" checked={!skipped.includes(i)} onCheckedChange={(v) => setSkipped((s) => (v === true ? s.filter((x) => x !== i) : [...s, i]))} />}
              <div className={cn('flex min-w-0 flex-1 flex-col gap-2', !written && skipped.includes(i) && 'opacity-60')}>
                <label htmlFor={written ? undefined : id} className={cn('block', !written && 'cursor-pointer')}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={OP[op.op].tone}>{OP[op.op].label}</Badge>
                    <Method method={op.method} />
                    <span className="text-sm font-medium">{op.name}</span>
                    {op.folder && <span className="text-xs text-muted-foreground">dans {op.folder}</span>}
                    {written && <Badge tone="green">Écrit dans Postman</Badge>}
                  </span>
                  <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">{op.url}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{op.reason}</span>
                </label>
                {/* Hors du label de la case : sélectionner du texte ne doit pas la décocher. */}
                {!written && <OperationDetail op={op} current={requests.find((x) => x.id === op.requestId)} />}
              </div>
            </div>
          )
        })}
      </div>
      {error && <ErrorBox error={error} />}
      {left > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!todo.length || apply.isPending} onClick={() => {
            setError(null)
            apply.mutate({ runId, indexes: todo }, {
              onSuccess: (res) => {
                setError(res.error)
                if (!res.error) toast(`${plural(todo.length, 'requête écrite', 'requêtes écrites')} dans Postman`)
              },
              onError: (e) => setError(e.message),
            })
          }}>
            {apply.isPending ? <Spinner /> : <UploadIcon />}Écrire dans Postman{todo.length > 0 && ` · ${todo.length}`}
          </Button>
          <span className="text-xs text-muted-foreground">Seules les propositions cochées partent. Une modification ne change que les champs listés.</span>
        </div>
      )}
    </div>
  )
}

/** Ce qu'une proposition écrit : la requête entière pour une création, les seuls champs qui changent pour une modification. */
function OperationDetail({ op, current }: { op: PostmanOperation; current: PostmanRequest | undefined }) {
  if (op.op === 'create') {
    return (
      <>
        {op.headers.length > 0 && <Code title="Headers" code={headerLines(op)} />}
        {op.body && <Code title="Body" code={op.body} />}
        {op.description && <Code title="Description" code={op.description} wrap />}
      </>
    )
  }
  if (!current) return <p className="text-sm text-amber-700 dark:text-amber-400">Cette requête n’est plus dans le dossier lié : la proposition ne pourra pas être écrite.</p>
  if (op.op === 'delete') return <p className="text-sm text-muted-foreground">La requête « {current.name} » est retirée du dossier.</p>
  const rawBody = current.bodyMode === 'raw' || current.bodyMode === 'none'
  const fields: [label: string, before: string, after: string, wrap?: boolean][] = [
    ['Nom', current.name, op.name],
    ['Méthode', current.method, op.method.toUpperCase()],
    ['URL', current.url, op.url],
    ['Headers', headerLines(current), headerLines(op)],
    ['Body', current.body ?? '', rawBody && op.body !== null ? op.body : current.body ?? ''],
    ['Description', current.description, op.description, true],
  ]
  const changed = fields.filter(([, before, after]) => before !== after)
  if (!changed.length) return <p className="text-sm text-muted-foreground">Déjà à jour : rien à changer.</p>
  return (
    <>
      {changed.map(([label, before, after, wrap]) => (
        <div key={label} className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Code title={`${label} · avant`} code={before} tone="red" wrap={wrap} />
          <ArrowRightIcon className="hidden size-4 self-center text-muted-foreground lg:block" aria-hidden />
          <Code title={`${label} · après`} code={after} tone="green" wrap={wrap} />
        </div>
      ))}
    </>
  )
}
