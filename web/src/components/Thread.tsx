import { ExternalLinkIcon, MessagesSquareIcon } from 'lucide-react'
import type { ReviewThread } from '../../../shared/types.ts'
import { cn } from '@/lib/utils'
import { Avatar, Badge, ago } from '../ui.tsx'
import { Markdown } from './Markdown.tsx'

/** Messages d'un fil GitHub, du premier au dernier, avec leur auteur. `me` : mon login, affiché « toi ». */
export function ThreadMessages({ thread, me, className }: { thread: ReviewThread; me?: string | null; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {thread.comments.map((c, i) => (
        <div key={c.id} className="flex gap-2.5">
          <Avatar login={c.author} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{c.author === me ? 'Toi' : c.author}</span>
              {i > 0 && c.author !== thread.comments[0].author && <Badge tone="blue">Réponse</Badge>}
              <span>{ago(c.createdAt)}</span>
            </span>
            <Markdown text={c.body} code={i === 0 ? thread.code : undefined} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Fil déjà ouvert sur le même sujet ou au même endroit, affiché sous une remarque de l'IA :
 * le commentaire d'origine et la réponse du développeur, pour juger si la remarque est encore fondée.
 */
export function PriorThread({ thread, me, title = 'Déjà discuté à cet endroit' }: { thread: ReviewThread; me?: string | null; title?: string }) {
  return (
    <details className="group rounded-lg border bg-muted/40 px-3 py-2.5" open>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <MessagesSquareIcon className="size-4 text-muted-foreground" />
        {title}
        <span className="font-mono text-xs font-normal text-muted-foreground">{thread.path}{thread.line ? `:${thread.line}` : ''}</span>
        {thread.isResolved && <Badge tone="green">Résolu</Badge>}
        {thread.isOutdated && <Badge tone="gray">Ligne modifiée depuis</Badge>}
        {thread.comments.length > 1 ? <Badge tone="blue">{thread.comments.length - 1} réponse(s)</Badge> : <Badge tone="gray">Sans réponse</Badge>}
        <a href={thread.comments[0]?.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
          GitHub<ExternalLinkIcon className="size-3" />
        </a>
      </summary>
      <ThreadMessages thread={thread} me={me} className="mt-3" />
    </details>
  )
}
