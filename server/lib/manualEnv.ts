import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { join, resolve, sep } from 'node:path'
import type { ManualEnv, ManualTestOutput } from '../../shared/types.ts'
import { agentEnv } from './claude.ts'
import { DATA_DIR } from './config.ts'
import { run } from './exec.ts'

// Test manuel : l'agent prépare l'environnement puis s'arrête (ce qu'il lance part avec lui). Les commandes
// qu'il renvoie sont lancées ici, gardées allumées tant que je teste, et arrêtées par le bouton ou avec le serveur.

const DIR = join(DATA_DIR, 'manual-env')
// Les processus d'un serveur précédent sont morts avec lui : leurs logs ne servent plus.
rmSync(DIR, { recursive: true, force: true })

interface Service { name: string; command: string; port: number | null; child: ChildProcess; log: string }
interface Env { runId: string; url: string | null; startedAt: string; services: Service[] }

/** Un environnement par worktree. */
const envs = new Map<string, Env>()

const READY_TIMEOUT = 5 * 60_000

const alive = (s: Service) => s.child.exitCode == null && s.child.signalCode == null

const portOpen = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ host: 'localhost', port })
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('error', () => done(false))
    socket.once('timeout', () => {
      socket.destroy()
      done(false)
    })
  })

const tail = (file: string, lines = 30) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n').trim() : '')

/** Le groupe du service (detached : lui et ce qu'il lance), SIGTERM puis SIGKILL s'il traîne. */
async function killService(s: Service) {
  const pid = s.child.pid
  if (pid == null || !alive(s)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  for (let i = 0; i < 50 && alive(s); i++) await new Promise((r) => setTimeout(r, 100))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* déjà terminé */
  }
}

export async function stopManualEnv(wtId: string) {
  const env = envs.get(wtId)
  if (!env) return
  envs.delete(wtId)
  await Promise.all(env.services.map(killService))
}

export function manualEnv(wtId: string): ManualEnv | null {
  const env = envs.get(wtId)
  if (!env) return null
  return {
    runId: env.runId, url: env.url, startedAt: env.startedAt,
    services: env.services.map((s) => ({ name: s.name, command: s.command, port: s.port, alive: alive(s), log: tail(s.log) })),
  }
}

/** Environnement allumé pour ce run (au moins un service encore en vie). */
export const manualEnvAlive = (runId: string) => [...envs.values()].some((e) => e.runId === runId && e.services.some(alive))

export async function openManualEnv(wtId: string) {
  const url = envs.get(wtId)?.url
  if (url) await run('open', ['-a', 'Google Chrome', url]).catch(() => run('open', [url]))
}

/**
 * Lance les services décrits par l'agent, attend que leurs ports répondent, puis ouvre la page dans Chrome.
 * dirs : dossiers où un service a le droit de tourner (le worktree et ses worktrees liés).
 */
export async function startManualEnv(wtId: string, runId: string, out: ManualTestOutput, dirs: string[]) {
  await stopManualEnv(wtId)
  for (const s of out.services) {
    const cwd = resolve(s.cwd)
    if (!dirs.some((d) => cwd === d || cwd.startsWith(d + sep))) throw new Error(`Service « ${s.name} » : dossier hors du worktree (${s.cwd})`)
    if (s.port != null && (await portOpen(s.port))) throw new Error(`Port ${s.port} (${s.name}) déjà occupé par un autre processus : libère-le, puis relance.`)
  }

  const dir = join(DIR, runId)
  mkdirSync(dir, { recursive: true })
  const env: Env = { runId, url: out.url, startedAt: new Date().toISOString(), services: [] }
  envs.set(wtId, env)
  for (const [i, s] of out.services.entries()) {
    const log = join(dir, `${i}-${s.name.replace(/[^\w-]/g, '_')}.log`)
    const fd = openSync(log, 'a')
    const child = spawn('/bin/sh', ['-c', s.command], { cwd: resolve(s.cwd), detached: true, env: agentEnv(), stdio: ['ignore', fd, fd] })
    closeSync(fd)
    child.on('error', () => undefined)
    env.services.push({ name: s.name, command: s.command, port: s.port, child, log })
  }

  const deadline = Date.now() + READY_TIMEOUT
  for (const s of env.services) {
    while (s.port != null && !(await portOpen(s.port))) {
      if (!alive(s) || Date.now() > deadline) {
        const why = alive(s) ? `ne répond pas sur le port ${s.port} après ${READY_TIMEOUT / 60_000} min` : 's’est arrêté'
        const out = tail(s.log, 15)
        await stopManualEnv(wtId)
        throw new Error(`Service « ${s.name} » ${why}.${out ? `\n${out}` : ''}`)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  await openManualEnv(wtId)
}

// Les services ne survivent pas au serveur.
process.on('exit', () => {
  for (const env of envs.values()) {
    for (const s of env.services) {
      try {
        if (s.child.pid != null && alive(s)) process.kill(-s.child.pid, 'SIGTERM')
      } catch {
        /* déjà terminé */
      }
    }
  }
})
