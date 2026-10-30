import { CheckIcon, PlusIcon, StickyNoteIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import type { Note, Project } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreateNote, useDeleteNote, useUpdateNote } from '../data/mutations.ts'
import { useNotes, useProjects } from '../data/queries.ts'
import { Badge, Empty, Pill, Spinner, ago, useToast } from '../ui.tsx'

type Filter = 'open' | 'done' | 'all'

export function NotesPage() {
  const notes = useNotes()
  const projects = useProjects()
  const create = useCreateNote()
  const toast = useToast()
  const [text, setText] = useState('')
  const [project, setProject] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [scope, setScope] = useState<string | 'all'>('all')

  const list = (notes.data ?? [])
    .filter((n) => (filter === 'all' ? true : filter === 'done' ? n.done : !n.done))
    .filter((n) => scope === 'all' || n.project === (scope === 'none' ? null : scope))
  const open = (notes.data ?? []).filter((n) => !n.done).length

  const add = () => {
    if (!text.trim()) return
    create.mutate({ text, project }, { onSuccess: () => setText(''), onError: (e) => toast(e.message, true) })
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ce que tu dois faire ou ne pas oublier. Coche une note quand c’est fait.</p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
        <Textarea
          aria-label="Nouvelle note"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Ex. : relancer Yannis sur la review de #912, vérifier la migration en staging…"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Projet</span>
            <Pill active={project === null} onClick={() => setProject(null)}>Général</Pill>
            {projects.data?.map((p) => <Pill key={p.id} active={project === p.id} className="font-mono" onClick={() => setProject(p.id)}>{p.name}</Pill>)}
          </div>
          <Button disabled={!text.trim() || create.isPending} onClick={add} title="⌘ + Entrée">
            {create.isPending ? <Spinner /> : <PlusIcon />}Ajouter
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Pill active={filter === 'open'} onClick={() => setFilter('open')}>À faire · {open}</Pill>
          <Pill active={filter === 'done'} onClick={() => setFilter('done')}>Faites</Pill>
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>Toutes</Pill>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={scope === 'all'} onClick={() => setScope('all')}>Tous les projets</Pill>
          <Pill active={scope === 'none'} onClick={() => setScope('none')}>Général</Pill>
          {projects.data?.map((p) => <Pill key={p.id} active={scope === p.id} className="font-mono" onClick={() => setScope(p.id)}>{p.name}</Pill>)}
        </div>
      </div>

      {notes.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des notes…</div>}
      {notes.data && !list.length && (
        <Empty icon={StickyNoteIcon} title={filter === 'done' ? 'Aucune note terminée' : 'Rien à faire'}>
          {filter === 'open' ? 'Ajoute une note ci-dessus pour t’en souvenir.' : 'Les notes cochées apparaissent ici.'}
        </Empty>
      )}
      <ul className="flex flex-col gap-2">
        {list.map((n) => <NoteRow key={n.id} note={n} projects={projects.data ?? []} />)}
      </ul>
    </div>
  )
}

function NoteRow({ note, projects }: { note: Note; projects: Project[] }) {
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const project = projects.find((p) => p.id === note.project)
  const onError = (e: Error) => toast(e.message, true)

  const save = () => {
    if (draft?.trim() && draft.trim() !== note.text) update.mutate({ id: note.id, text: draft.trim() }, { onError })
    setDraft(null)
  }

  return (
    <li className={cn('group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs', note.done && 'opacity-60')}>
      <Checkbox className="mt-0.5" checked={note.done} aria-label={note.done ? 'Marquer à faire' : 'Marquer comme faite'} onCheckedChange={(v) => update.mutate({ id: note.id, done: v === true }, { onError })} />
      <div className="min-w-0 flex-1">
        {draft !== null ? (
          <div className="flex flex-col gap-2">
            <Textarea aria-label="Modifier la note" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
                if (e.key === 'Escape') setDraft(null)
              }} />
            <div className="flex gap-2">
              <Button size="sm" onClick={save}><CheckIcon />Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
            </div>
          </div>
        ) : (
          <button type="button" className={cn('w-full text-left text-sm whitespace-pre-wrap', note.done && 'line-through')} title="Cliquer pour modifier" onClick={() => setDraft(note.text)}>{note.text}</button>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {project ? <Badge tone="blue">{project.name}</Badge> : <Badge tone="gray">Général</Badge>}
          <span>{ago(note.createdAt)}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Supprimer la note"
        onClick={() => confirm('Supprimer cette note ?') && remove.mutate(note.id, { onError })}>
        <Trash2Icon />
      </Button>
    </li>
  )
}
