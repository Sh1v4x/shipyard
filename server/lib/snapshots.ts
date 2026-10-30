import { dropSnapshot, restoreSnapshot, type Snapshot } from './git.ts'
import { jsonFile } from './store.ts'

// Photos des worktrees prises avant le travail d'un agent (et des worktrees liés), par run :
// « Abandonner » ou « Refuser et annuler » remettent ces fichiers sans toucher au travail de l'utilisateur.
// Des corrections reprennent la photo du premier passage (ref : identifiant du run qui l'a prise).

const file = jsonFile<Record<string, { ref: string; snaps: Snapshot[] }>>('snapshots.json', {})

export function saveSnapshots(run: string, entry: { ref: string; snaps: Snapshot[] }) {
  file.write({ ...file.read(), [run]: entry })
}

/** Photo d'un run, retirée du registre (elle ne sert qu'une fois). */
export function takeSnapshots(run: string): { ref: string; snaps: Snapshot[] } | null {
  const all = file.read()
  const entry = all[run] ?? null
  if (entry) {
    delete all[run]
    file.write(all)
  }
  return entry
}

/** Remet les worktrees dans leur état d'avant le run. Renvoie false si le run n'a pas de photo. */
export async function revertRun(run: string): Promise<boolean> {
  const entry = takeSnapshots(run)
  if (!entry) return false
  for (const s of entry.snaps) await restoreSnapshot(s, entry.ref)
  return true
}

/** Travail gardé : la photo n'est plus utile. */
export async function forgetRun(run: string) {
  const entry = takeSnapshots(run)
  if (entry) for (const s of entry.snaps) await dropSnapshot(s.path, entry.ref)
}
