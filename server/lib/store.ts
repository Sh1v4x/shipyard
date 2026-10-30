import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomicWrite.ts'
import { DATA_DIR } from './config.ts'

/** Petit fichier JSON dans .data/ : lu à chaque appel, écrit de façon atomique. */
export function jsonFile<T>(name: string, initial: T) {
  const path = join(DATA_DIR, name)
  return {
    read(): T {
      try {
        return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : initial
      } catch {
        return initial
      }
    },
    write(value: T) {
      writeFileAtomic(path, JSON.stringify(value, null, 2))
    },
  }
}

/** Fichier JSON quelconque (hors .data/ compris) : null s'il manque ou ne se lit pas. */
export function readJsonFile<T>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
  } catch {
    return null
  }
}
