import { describe, expectTypeOf, it } from 'vitest'
import type * as T from '../shared/types.ts'
import type { FromSchema } from './lib/jsonSchemaType.ts'
import type * as S from './schemas.ts'

/** Le schéma décrit bien un type (une faute dans `type` donnerait never, compatible avec tout), et ce type tient dans T. */
type Aligned<Schema, Type> = [FromSchema<Schema>] extends [never] ? false : FromSchema<Schema> extends Type ? true : false

// Ce que l'agent renvoie (d'après le schéma passé à --json-schema) doit être lisible avec le type de shared/types.ts.
describe('schémas des sorties structurées', () => {
  it('sont alignés avec shared/types.ts', () => {
    expectTypeOf<Aligned<typeof S.branchNameSchema, T.BranchNameOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.dailySchema, T.DailyOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.dirtyTriageSchema, T.DirtyTriageOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.conflictResolveSchema, T.ConflictResolveOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.ticketDraftSchema, T.TicketDraftOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.reviewSchema, T.ReviewOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.prReviewSchema, T.PrReviewOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.commentsSchema, T.CommentsOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.commentsFixAllSchema, T.CommentsFixAllAgentOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.findingsFixAllSchema, T.FindingsFixAllAgentOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.ciAllSchema, T.CiAllOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.insightsSchema, T.InsightsOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.followupSchema, T.FollowupOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.prPrepareSchema, T.PrPrepareOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.commentReplySchema, T.CommentReplyOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.fixSchema, T.FixOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.testSchema, T.TestOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.checksAnalyzeSchema, T.ChecksAnalyzeOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.manualTestSchema, T.ManualTestOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.ciSchema, T.CiOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.commitPlanSchema, T.CommitPlanOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.commitFixSchema, T.CommitFixOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.hookFixPlanSchema, T.HookFixPlanOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.ticketPlanSchema, T.TicketPlanOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.branchAskSchema, T.BranchAskOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.ticketWorkSchema, T.TicketWorkOutput>>().toEqualTypeOf<true>()
    expectTypeOf<Aligned<typeof S.testCheckSchema, T.TestCheckOutput>>().toEqualTypeOf<true>()
  })
})
