import { describe, expect, it } from 'vitest'
import { actionInput, settingsInput, updateNoteInput } from './inputs.ts'

describe('actionInput', () => {
  it('traite null comme un paramètre absent', () => {
    expect(actionInput.parse({ project: 'p', worktree: null, ref: null, extra: 'x' })).toEqual({ project: 'p', worktree: undefined, ref: undefined, extra: 'x' })
  })

  it('refuse un projet manquant ou un mauvais type', () => {
    expect(actionInput.safeParse({ worktree: 'w' }).success).toBe(false)
    expect(actionInput.safeParse({ project: 'p', period: 'month' }).success).toBe(false)
  })

  it('retire les champs inconnus', () => {
    expect(actionInput.parse({ project: 'p', injected: true })).not.toHaveProperty('injected')
  })
})

describe('settingsInput', () => {
  it('accepte un changement partiel', () => {
    expect(settingsInput.parse({ languages: { pr: 'en' }, labels: { testing: ['qa'] } })).toEqual({ languages: { pr: 'en' }, labels: { testing: ['qa'] } })
  })

  it('refuse une langue, un rôle de label ou une durée invalides', () => {
    expect(settingsInput.safeParse({ languages: { tickets: 'de' } }).success).toBe(false)
    expect(settingsInput.safeParse({ labels: { unknown: [] } }).success).toBe(false)
    expect(settingsInput.safeParse({ notifications: { intervalSec: 0 } }).success).toBe(false)
  })
})

describe('updateNoteInput', () => {
  it('accepte un changement partiel', () => {
    expect(updateNoteInput.parse({ done: true })).toEqual({ done: true })
  })
})
