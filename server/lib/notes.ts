import { randomUUID } from 'node:crypto'
import type { Note } from '../../shared/types.ts'
import { HttpError } from './config.ts'
import { jsonFile } from './store.ts'

const file = jsonFile<Note[]>('notes.json', [])

export const listNotes = () => file.read()

export function createNote(text: string, project: string | null): Note {
  if (!text.trim()) throw new HttpError(400, 'Note vide')
  const now = new Date().toISOString()
  const note: Note = { id: randomUUID(), text: text.trim(), done: false, project, createdAt: now, updatedAt: now }
  file.write([note, ...file.read()])
  return note
}

export function updateNote(id: string, patch: Partial<Pick<Note, 'text' | 'done' | 'project'>>): Note {
  const notes = file.read()
  const note = notes.find((n) => n.id === id)
  if (!note) throw new HttpError(404, 'Note introuvable')
  Object.assign(note, patch, { updatedAt: new Date().toISOString() })
  file.write(notes)
  return note
}

export function deleteNote(id: string) {
  file.write(file.read().filter((n) => n.id !== id))
}
