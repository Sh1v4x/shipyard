import type { DiffLine } from '../../shared/types.ts'

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
