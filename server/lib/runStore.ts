import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptCost, Run, RunEvent } from '../../shared/types.ts'
import { writeFileAtomic } from './atomicWrite.ts'

/** Run sans son journal : ce que gardent l'index en mémoire et le fichier `<id>.json`. */
export type RunRecord = Omit<Run, 'events'>

const RETENTION_DAYS = 60

/**
 * Coût par prompt depuis `since`. Seuls les agents portent un prompt : une tâche serveur, qui additionne le coût
 * de ses agents, n'est pas comptée une seconde fois.
 */
export function costsByPrompt(records: RunRecord[], since: number): Map<string, PromptCost> {
  const byPrompt = new Map<string, { runs: number; totalUsd: number }>()
  for (const r of records) {
    if (!r.promptKey || r.costUsd == null || Date.parse(r.startedAt) < since) continue
    const cur = byPrompt.get(r.promptKey) ?? { runs: 0, totalUsd: 0 }
    byPrompt.set(r.promptKey, { runs: cur.runs + 1, totalUsd: cur.totalUsd + r.costUsd })
  }
  return new Map([...byPrompt].map(([key, c]) => [key, { ...c, averageUsd: c.totalUsd / c.runs }]))
}

/** Fichier d'un run : contrôle minimal avant de lui faire confiance (sinon le fichier est ignoré). */
function parseRunFile(text: string): Run | RunRecord {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || !('id' in value) || !('kind' in value) || !('status' in value) || !('scope' in value)) throw new Error('Run illisible')
  return value as Run | RunRecord
}

/**
 * Runs sur disque : `<id>.json` pour l'état (réécrit à chaque changement, petit) et `<id>.events.jsonl`
 * pour le journal, complété ligne à ligne. Les états sont indexés en mémoire au premier accès : lister les
 * runs ne relit plus le disque.
 */
export function createRunStore(dir: string) {
  let index: Map<string, RunRecord> | null = null
  /** Événements déjà écrits par run : `save` n'ajoute que les suivants. */
  const written = new Map<string, number>()

  const metaPath = (id: string) => join(dir, `${id}.json`)
  const eventsPath = (id: string) => join(dir, `${id}.events.jsonl`)

  const writeMeta = (record: RunRecord) => writeFileAtomic(metaPath(record.id), JSON.stringify(record))

  function readEvents(id: string): RunEvent[] {
    if (!existsSync(eventsPath(id))) return []
    return readFileSync(eventsPath(id), 'utf8').split('\n').filter(Boolean).map((l): RunEvent => JSON.parse(l))
  }

  function load(): Map<string, RunRecord> {
    if (index) return index
    index = new Map()
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const stored = parseRunFile(readFileSync(join(dir, f), 'utf8'))
        // Ancien format : le journal était dans le fichier du run.
        if ('events' in stored) {
          const { events, ...record } = stored
          writeFileSync(eventsPath(record.id), events.map((e) => `${JSON.stringify(e)}\n`).join(''))
          writeMeta(record)
          index.set(record.id, record)
        } else index.set(stored.id, stored)
      } catch {
        /* fichier illisible : ignoré */
      }
    }
    return index
  }

  return {
    /** Enregistre l'état du run et les événements ajoutés depuis le dernier appel. */
    save(run: Run) {
      const { events, ...record } = run
      const from = written.get(run.id) ?? 0
      if (events.length > from) appendFileSync(eventsPath(run.id), events.slice(from).map((e) => `${JSON.stringify(e)}\n`).join(''))
      // Une copie plus ancienne du même run ne doit pas faire réécrire des événements déjà sur disque.
      written.set(run.id, Math.max(from, events.length))
      writeMeta(record)
      load().set(run.id, record)
    },

    get(id: string): Run | null {
      const record = load().get(id)
      if (!record) return null
      const events = readEvents(id)
      written.set(id, events.length)
      return { ...record, events }
    },

    records(): RunRecord[] {
      return [...load().values()]
    },

    /**
     * Retire les runs de plus de RETENTION_DAYS jours, sauf le dernier de chaque type et portée : c'est lui
     * que lisent « À valider » et chaque écran. `onRemove` nettoie ce qui est rangé ailleurs sous l'id du run.
     */
    purge(now: number, onRemove: (id: string) => void = () => undefined): string[] {
      const latest = new Map<string, RunRecord>()
      const key = (r: RunRecord) => `${r.kind}|${r.scope.project}|${r.scope.worktree ?? ''}|${r.scope.ref ?? ''}`
      for (const r of load().values()) {
        const cur = latest.get(key(r))
        if (!cur || r.startedAt > cur.startedAt) latest.set(key(r), r)
      }
      const limit = now - RETENTION_DAYS * 86_400_000
      const removed: string[] = []
      for (const r of [...load().values()]) {
        if (r.status === 'running' || latest.get(key(r)) === r || Date.parse(r.startedAt) >= limit) continue
        rmSync(metaPath(r.id), { force: true })
        rmSync(eventsPath(r.id), { force: true })
        load().delete(r.id)
        written.delete(r.id)
        onRemove(r.id)
        removed.push(r.id)
      }
      return removed
    },
  }
}
