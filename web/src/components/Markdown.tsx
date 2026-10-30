import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Markdown des commentaires GitHub (reviewers, CodeRabbit…) : ce qu'ils utilisent vraiment, sans dépendance.
// Paragraphes, titres, listes, citations, code, liens, gras/italique, <details>, tableaux en bloc, et les blocs
// ```suggestion affichés en diff contre les lignes commentées. Le HTML est réduit à son texte, jamais injecté.

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; ordered: boolean; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; lang: string; code: string }
  | { t: 'table'; text: string }
  | { t: 'details'; summary: string; body: string }

/** Bloc ```suggestion d'un commentaire : le code proposé à la place des lignes commentées. */
export const suggestionOf = (body: string) => body.match(/```suggestion[^\n]*\n([\s\S]*?)```/)?.[1]?.replace(/\n$/, '') ?? null

function stripHtml(text: string) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?!details|summary)[a-z][^>]*>/gi, '')
}

function parse(src: string): Block[] {
  const lines = stripHtml(src).replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = line.match(/^\s*```(\S*)/)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++])
      i++
      out.push({ t: 'code', lang: fence[1], code: code.join('\n') })
      continue
    }
    if (/^\s*<details>/i.test(line)) {
      const body: string[] = []
      let summary = 'Détails'
      i++
      let depth = 1
      while (i < lines.length) {
        if (/<details>/i.test(lines[i])) depth++
        if (/<\/details>/i.test(lines[i]) && --depth === 0) break
        const s = lines[i].match(/<summary>(.*?)<\/summary>/i)
        if (s && summary === 'Détails' && !body.length) summary = s[1]
        else body.push(lines[i])
        i++
      }
      i++
      out.push({ t: 'details', summary, body: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++])
      out.push({ t: 'table', text: rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).join('\n') })
      continue
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', text: q.join('\n') })
      continue
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+/)
    if (li) {
      const ordered = /\d/.test(li[1])
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`
        items.push(item)
      }
      out.push({ t: 'list', ordered, items })
      continue
    }
    const p: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|\||<details>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) p.push(lines[i++])
    if (!p.length) p.push(lines[i++])
    out.push({ t: 'p', text: p.join('\n') })
  }
  return out
}

/** Gras, italique, code, liens et URL nues. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g
  let last = 0
  let k = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const s = m[0]
    if (m[1]) out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{s.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k++} className="font-semibold">{inline(s.slice(2, -2))}</strong>)
    else if (m[3]) out.push(<em key={k++}>{inline(s.slice(1, -1))}</em>)
    else if (m[4]) {
      const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!
      out.push(<a key={k++} href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{inline(label)}</a>)
    } else out.push(<a key={k++} href={s} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">{s}</a>)
    last = m.index + s.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.map((n, i) => (typeof n === 'string' ? <Fragment key={`t${i}`}>{n.split('\n').flatMap((l, j) => (j ? [<br key={j} />, l] : [l]))}</Fragment> : n))
}

/** Bloc ```suggestion : les lignes commentées (si connues) remplacées par le code proposé. */
export function SuggestionDiff({ code, before }: { code: string; before?: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">Suggestion</div>
      <pre className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
        {before?.map((l, i) => <div key={`d${i}`} className="bg-red-500/10 px-3 text-red-800 dark:text-red-300">- {l}</div>)}
        {code.split('\n').map((l, i) => <div key={`a${i}`} className="bg-emerald-500/10 px-3 text-emerald-800 dark:text-emerald-300">+ {l}</div>)}
      </pre>
    </div>
  )
}

function Blocks({ blocks, code }: { blocks: Block[]; code?: string[] }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'p': return <p key={i}>{inline(b.text)}</p>
      case 'h': return <p key={i} className="font-semibold">{inline(b.text)}</p>
      case 'quote': return <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">{inline(b.text)}</blockquote>
      case 'table': return <pre key={i} className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs">{b.text}</pre>
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul'
        return <L key={i} className={cn('flex flex-col gap-1 pl-5', b.ordered ? 'list-decimal' : 'list-disc')}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>
      }
      case 'code':
        if (b.lang === 'suggestion') return <SuggestionDiff key={i} code={b.code} before={code} />
        return <pre key={i} className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-[12.5px] leading-relaxed">{b.code}</pre>
      case 'details':
        return (
          <details key={i} className="rounded-md border px-3 py-2 text-muted-foreground">
            <summary className="cursor-pointer text-xs font-medium">{inline(b.summary)}</summary>
            <div className="mt-2 flex flex-col gap-2 text-foreground"><Blocks blocks={parse(b.body)} /></div>
          </details>
        )
      default:
        return null
    }
  })
}

/** Corps d'un commentaire. code : lignes commentées, pour afficher une suggestion en diff. */
export function Markdown({ text, code, className }: { text: string; code?: string[]; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-2 break-words', className)}><Blocks blocks={parse(text)} code={code} /></div>
}

/** Texte brut d'un commentaire, pour un aperçu sur une ligne. */
export const plain = (body: string, max = 200) => {
  const t = stripHtml(body).replace(/```[\s\S]*?```/g, ' ').replace(/[*_`>#]|\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
