import { DownloadIcon, FilmIcon } from 'lucide-react'
import { useState } from 'react'
import type { RunVideo } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { useRunVideos } from '../data/queries.ts'
import { Pill, Spinner } from '../ui.tsx'

const LABEL: Record<RunVideo['platform'], string> = { web: 'Navigateur', android: 'Android' }
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} Mo`
const time = (s: number) => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`

/**
 * Vidéos d'un test, à transmettre comme preuve : la version courte (pauses de réflexion retirées) par défaut,
 * la version complète à côté, et un bouton pour télécharger.
 */
export function TestVideos({ runId, endedAt }: { runId: string; endedAt: string | null }) {
  const videos = useRunVideos(runId, endedAt)
  const list = videos.data ?? []
  // Une vidéo par plateforme, et par app quand plusieurs apps web sont testées (worktrees liés).
  const groups = [...new Set(list.map((v) => `${v.platform}|${v.label ?? ''}`))]
  if (!endedAt) return null
  if (!list.length) {
    const pending = Date.now() - Date.parse(endedAt) < 180_000
    return pending ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Montage de la vidéo du test…</div> : null
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const videos = list.filter((v) => `${v.platform}|${v.label ?? ''}` === g)
        return <PlatformVideo key={g} runId={runId} platform={videos[0].platform} label={videos[0].label} videos={videos} />
      })}
    </div>
  )
}

function PlatformVideo({ runId, platform, label, videos }: { runId: string; platform: RunVideo['platform']; label?: string; videos: RunVideo[] }) {
  const short = videos.find((v) => v.short)
  const full = videos.find((v) => !v.short)
  const [showFull, setShowFull] = useState(!short)
  const current = (showFull ? full : short) ?? full ?? short!
  const src = (v: RunVideo, download = false) => `/api/runs/${runId}/videos/${v.file}${download ? '?download=1' : ''}`
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium"><FilmIcon className="size-4 text-muted-foreground" />Vidéo du test · {LABEL[platform]}{label && <span className="font-mono text-xs text-muted-foreground">{label}</span>}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {short && full && (
            <>
              <Pill active={!showFull} onClick={() => setShowFull(false)}>Courte · {time(short.durationSec)}</Pill>
              <Pill active={showFull} onClick={() => setShowFull(true)}>Complète · {time(full.durationSec)}</Pill>
            </>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={src(current, true)}><DownloadIcon />Télécharger ({mb(current.sizeBytes)})</a>
          </Button>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: enregistrement d'écran d'un test, sans piste audio ni sous-titres */}
      <video key={current.file} src={src(current)} controls preload="metadata" className="max-h-[560px] w-full rounded-lg bg-black" />
      <p className="text-xs text-muted-foreground">
        {current.short ? 'Version courte : seules les actions et leur effet sont gardés, les temps de réflexion de l’agent sont retirés. ' : ''}
        Pour la joindre à la PR, télécharge-la puis glisse-la dans un commentaire GitHub. Gardée 14 jours.
      </p>
    </section>
  )
}
