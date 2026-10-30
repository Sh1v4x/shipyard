import { describe, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { ActionInput, CreateWorktreeInput, Note, ReviewDecisions, SettingsPatch } from '../shared/types.ts'
import type * as I from './inputs.ts'

/** Champs du type partagé absents du schéma : zod les retirerait sans erreur. */
type Missing<Schema extends z.ZodType, Type> = Exclude<keyof Type, keyof z.output<Schema>>

describe('schémas des corps de requête', () => {
  it('couvrent tous les champs des types partagés', () => {
    expectTypeOf<Missing<typeof I.actionInput, ActionInput>>().toBeNever()
    expectTypeOf<Missing<typeof I.createWorktreeInput, CreateWorktreeInput>>().toBeNever()
    expectTypeOf<Missing<typeof I.updateNoteInput, Pick<Note, 'text' | 'done' | 'project'>>>().toBeNever()
    expectTypeOf<Missing<typeof I.settingsInput, SettingsPatch>>().toBeNever()
    expectTypeOf<Missing<typeof I.reviewDecisionsInput, ReviewDecisions>>().toBeNever()
  })
})
