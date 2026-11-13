import type { DiffFile, DiffLine } from '../../shared/types.ts'

const MAX_LINES_PER_FILE = 1500

/** Fichiers d'un diff calculé en local (branche sans PR), dans la forme de l'onglet Fichiers. */
export function diffFiles(diff: string): DiffFile[] {
  return [...parseUnifiedDiff(diff)].map(([path, all]) => ({
    path,
    additions: all.filter((l) => l.t === '+').length,
    deletions: all.filter((l) => l.t === '-').length,
    viewed: false,
    lines: all.slice(0, MAX_LINES_PER_FILE),
    truncated: all.length > MAX_LINES_PER_FILE,
  }))
}

export function parseUnifiedDiff(diff: string): Map<string, DiffLine[]> {
  const files = new Map<string, DiffLine[]>()
  let lines: DiffLine[] = []
  let o = 0
  let n = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/ b\/(.+)$/)
      lines = []
      files.set(m ? m[1] : raw, lines)
      continue
    }
    if (raw.startsWith('+++ ') || raw.startsWith('--- ') || raw.startsWith('index ') || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('similarity') || raw.startsWith('rename ') || raw.startsWith('Binary')) continue
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      lines.push({ t: '@', o: null, n: null, code: raw })
      continue
    }
    if (raw.startsWith('+')) lines.push({ t: '+', o: null, n: n++, code: raw.slice(1) })
    else if (raw.startsWith('-')) lines.push({ t: '-', o: o++, n: null, code: raw.slice(1) })
    else if (raw.startsWith(' ')) lines.push({ t: ' ', o: o++, n: n++, code: raw.slice(1) })
  }
  return files
}
