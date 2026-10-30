import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Écrit dans un fichier temporaire puis renomme : un arrêt en pleine écriture ne laisse jamais un fichier tronqué. */
export function writeFileAtomic(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, content)
  renameSync(`${path}.tmp`, path)
}
