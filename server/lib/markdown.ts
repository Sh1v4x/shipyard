/** Front matter minimal : `cle: valeur` et `cle: [a, b, c]`. Suffisant pour prompts/ et agents/. */
export interface Parsed {
  meta: Record<string, string | string[]>
  body: string
}

export function parseFrontMatter(src: string): Parsed {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string | string[]> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const v = kv[2].trim()
    meta[kv[1]] = v.startsWith('[') && v.endsWith(']')
      ? v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : v.replace(/^["']|["']$/g, '')
  }
  return { meta, body: m[2] }
}

export function serializeFrontMatter(meta: Record<string, string | string[]>, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`
}

export const str = (v: string | string[] | undefined, d = '') => (Array.isArray(v) ? v.join(', ') : v ?? d)
export const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])
