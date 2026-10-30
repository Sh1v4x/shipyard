import { createNote, deleteNote, listNotes, updateNote } from '../lib/notes.ts'
import { Hono } from 'hono'
import { jsonBody } from '../http.ts'
import * as inputs from '../inputs.ts'

export const notesRoutes = new Hono()

notesRoutes.get('/notes', (c) => c.json(listNotes()))

notesRoutes.post('/notes', async (c) => {
  const b = await jsonBody(c, inputs.createNoteInput)
  return c.json(createNote(b.text, b.project ?? null))
})

notesRoutes.patch('/notes/:id', async (c) => c.json(updateNote(c.req.param('id'), await jsonBody(c, inputs.updateNoteInput))))

notesRoutes.delete('/notes/:id', (c) => {
  deleteNote(c.req.param('id'))
  return c.json({ ok: true })
})
