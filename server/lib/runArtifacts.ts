import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, SHOTS_DIR } from './config.ts'

/** Mes décisions sur une review, par run. */
const REVIEWS_DIR = join(DATA_DIR, 'reviews')
/** Tickets Linear créés depuis un brouillon, par run. */
const CREATED_TICKETS_DIR = join(DATA_DIR, 'created-tickets')

/** L'id vient souvent de l'URL : réduit à ses caractères permis, il ne peut pas sortir du dossier. */
const safeId = (runId: string) => runId.replace(/[^\w-]/g, '')

export const reviewDecisionsPath = (runId: string) => join(REVIEWS_DIR, `${safeId(runId)}.json`)
export const createdTicketsPath = (runId: string) => join(CREATED_TICKETS_DIR, `${safeId(runId)}.json`)
export const shotsDirOf = (runId: string) => join(SHOTS_DIR, safeId(runId))

/** Ce qui est rangé sous l'id d'un run supprimé. */
export function removeRunArtifacts(runId: string) {
  rmSync(reviewDecisionsPath(runId), { force: true })
  rmSync(createdTicketsPath(runId), { force: true })
  rmSync(shotsDirOf(runId), { recursive: true, force: true })
}
