import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from './exec.ts'

// Vidéos des tests : enregistrement (navigateur via Playwright MCP, émulateur Android via adb screenrecord),
// puis montage d'une version courte qui ne garde que les moments autour des actions de l'agent.

/** Fenêtre gardée autour de chaque action : un peu avant, et le temps de voir son effet. */
const BEFORE = 0.5
const AFTER = 2

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- Playwright ----------

/** L'enregistrement du navigateur passe par le ffmpeg de Playwright : téléchargé une fois s'il manque. */
export async function ensurePlaywrightFfmpeg(): Promise<boolean> {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (existsSync(cache) && readdirSync(cache).some((d) => d.startsWith('ffmpeg-'))) return true
  // Le playwright-core embarqué par @playwright/mcp (même version que celle qui enregistre).
  const npx = join(homedir(), '.npm/_npx')
  const clis = existsSync(npx)
    ? readdirSync(npx).map((d) => join(npx, d, 'node_modules/playwright-core/cli.js')).filter((f) => existsSync(join(f, '../../@playwright/mcp')))
    : []
  const cli = clis.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  const ok = await (cli ? run('node', [cli, 'install', 'ffmpeg'], { timeoutMs: 180_000 }) : run('npx', ['-y', 'playwright', 'install', 'ffmpeg'], { timeoutMs: 180_000 }))
    .then(() => true, () => false)
  return ok
}

// ---------- Android ----------

const adb = (args: string[], serial?: string) => run('adb', serial ? ['-s', serial, ...args] : args, { timeoutMs: 30_000 })

/** Premier émulateur ou appareil connecté et prêt, ou null. */
export async function androidDevice(): Promise<string | null> {
  const out = await adb(['devices']).catch(() => '')
  return out.split('\n').slice(1).map((l) => l.split('\t')).find(([, state]) => state?.trim() === 'device')?.[0] ?? null
}

export interface AndroidRecorder {
  /** Arrête l'enregistrement, récupère la vidéo (segments recollés) ; null si rien n'a été filmé. */
  stop(): Promise<{ file: string; startedAt: number; serial: string } | null>
}

/**
 * Filme l'écran Android pendant le test : attend qu'un appareil soit prêt (l'agent peut lancer l'émulateur en cours de route),
 * puis enchaîne des segments de 170 s (screenrecord s'arrête seul à 3 min).
 */
export function startAndroidRecorder(dir: string, tag: string): AndroidRecorder {
  let stopped = false
  let serial: string | null = null
  let startedAt = 0
  let child: ChildProcess | null = null
  const segments: string[] = []
  const loop = (async () => {
    while (!stopped && !serial) {
      serial = await androidDevice()
      if (!serial) await sleep(3_000)
    }
    while (!stopped && serial) {
      const remote = `/sdcard/shipyard-${tag}-${segments.length}.mp4`
      segments.push(remote)
      if (!startedAt) startedAt = Date.now()
      const at = Date.now()
      child = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--time-limit', '170', remote], { stdio: 'ignore' })
      await new Promise((r) => child!.once('exit', r))
      // Un screenrecord qui échoue d'emblée (émulateur qui démarre, stockage plein) : on attend avant de réessayer.
      if (!stopped) await sleep(Date.now() - at < 5_000 ? 3_000 : 200)
    }
  })()
  return {
    async stop() {
      stopped = true
      if (!serial) return null
      // SIGINT : screenrecord finalise le fichier proprement.
      await adb(['shell', 'pkill', '-INT', 'screenrecord'], serial).catch(() => undefined)
      await Promise.race([loop, sleep(8_000)])
      await sleep(1_000)
      const local: string[] = []
      for (const [i, remote] of segments.entries()) {
        const file = join(dir, `android-${i}.mp4`)
        const ok = await adb(['pull', remote, file], serial).then(() => true, () => false)
        await adb(['shell', 'rm', '-f', remote], serial).catch(() => undefined)
        // Un segment coupé net (émulateur arrêté ou redémarré) n'est pas lisible et ferait échouer tout le montage.
        if (ok && existsSync(file) && statSync(file).size > 1_000 && (await videoDuration(file)) > 0) local.push(file)
      }
      if (!local.length) return null
      const full = join(dir, 'android-full.mp4')
      if (local.length === 1) await run('mv', [local[0], full])
      else {
        const list = join(dir, 'segments.txt')
        writeFileSync(list, local.map((f) => `file '${f}'`).join('\n'))
        await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', full], { timeoutMs: 300_000 })
      }
      return { file: full, startedAt, serial }
    },
  }
}

// ---------- Montage ----------

export async function videoDuration(file: string): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).catch(() => '')
  return Number(out.trim()) || 0
}

/**
 * Version courte : ne garde que les fenêtres autour des actions (en secondes depuis le début de la vidéo).
 * Les pauses de réflexion entre deux actions disparaissent ; chaque action reste visible avec son effet.
 */
export async function trimAroundActions(input: string, output: string, actions: number[]): Promise<boolean> {
  const duration = await videoDuration(input)
  if (!duration || !actions.length) return false
  const windows: [number, number][] = []
  for (const t of actions.filter((x) => x >= -AFTER && x <= duration).sort((a, b) => a - b)) {
    const start = Math.max(0, t - BEFORE)
    const end = Math.min(duration, t + AFTER)
    const last = windows.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else windows.push([start, end])
  }
  if (!windows.length) return false
  const kept = windows.reduce((a, [s, e]) => a + e - s, 0)
  // Rien à gagner : la vidéo est déjà presque entièrement faite d'actions.
  if (kept > duration * 0.9) return false
  const select = windows.map(([s, e]) => `between(t,${s.toFixed(2)},${e.toFixed(2)})`).join('+')
  // fps d'abord : screenrecord ne produit une image que quand l'écran change, la sélection doit compter en temps réel.
  await run('ffmpeg', ['-y', '-i', input, '-vf', `fps=25,select='${select}',setpts=N/FRAME_RATE/TB`, '-an', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { timeoutMs: 600_000 })
  return existsSync(output)
}

/** Copie lisible partout (MP4 H.264) d'une vidéo du navigateur (WebM). */
export async function toMp4(input: string, output: string): Promise<boolean> {
  await run('ffmpeg', ['-y', '-i', input, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { timeoutMs: 600_000 })
  return existsSync(output)
}
