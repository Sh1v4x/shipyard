import type { AgentProcesses, AgentProcess } from '../../shared/types.ts'
import { run } from './exec.ts'
import { liveAgents } from './claude.ts'
import { HttpError } from './config.ts'

// Processus des agents : ceux des runs en cours (avec la mémoire de tout ce qu'ils ont lancé) et les orphelins,
// agents claude lancés par Shipyard qui tournent encore sans run (serveur redémarré, arrêt raté).

/** Signature des agents lancés par Shipyard (claude -p en flux JSON), qui les distingue des sessions interactives. */
const SHIPYARD_AGENT = /(^|\/)claude -p --output-format stream-json --verbose --append-system-prompt/

interface Proc { pid: number; pgid: number; rss: number; etime: string; command: string }

/** Processus dont le dossier courant est sous ce chemin (lsof sur les cwd : rapide, sans parcourir le dossier). */
export async function processesIn(path: string): Promise<{ pid: number; command: string }[]> {
  const out = await run('lsof', ['-a', '-d', 'cwd', '-Fpcn']).catch((e: { stdout?: string }) => e.stdout ?? '')
  const found: { pid: number; command: string }[] = []
  let pid = 0
  let command = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('c')) command = line.slice(1)
    else if (line.startsWith('n') && (line.slice(1) === path || line.slice(1).startsWith(`${path}/`))) found.push({ pid, command })
  }
  const full = await processes().catch(() => [])
  return found.map((f) => ({ pid: f.pid, command: full.find((p) => p.pid === f.pid)?.command.slice(0, 140) ?? f.command }))
}

async function processes(): Promise<Proc[]> {
  const out = await run('ps', ['-axo', 'pid=,pgid=,rss=,etime=,command=']).catch(() => '')
  return out.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: Number(m[1]), pgid: Number(m[2]), rss: Number(m[3]), etime: m[4], command: m[5] }))
}

const mb = (kb: number) => Math.round(kb / 1024)
const short = (cmd: string) => (SHIPYARD_AGENT.test(cmd) ? 'claude -p (agent)' : cmd.length > 140 ? `${cmd.slice(0, 140)}…` : cmd)
const toProc = (p: Proc): AgentProcess => ({ pid: p.pid, rssMb: mb(p.rss), elapsed: p.etime, command: short(p.command) })

export async function agentProcesses(): Promise<AgentProcesses> {
  const procs = await processes()
  const groups = new Map<number, Proc[]>()
  for (const p of procs) groups.set(p.pgid, [...(groups.get(p.pgid) ?? []), p])
  const live = liveAgents()
  const liveGroups = new Set(live.map((l) => l.pid))
  const runs = live.map(({ run: r, pid }) => {
    const list = groups.get(pid) ?? []
    return { runId: r.id, title: r.title, kind: r.kind, scope: r.scope, startedAt: r.startedAt, pgid: pid, rssMb: mb(list.reduce((a, p) => a + p.rss, 0)), processes: list.map(toProc) }
  })
  const orphans = [...groups.entries()]
    .filter(([pgid, list]) => !liveGroups.has(pgid) && list.some((p) => SHIPYARD_AGENT.test(p.command) && p.pid !== process.pid))
    .map(([pgid, list]) => ({ pgid, rssMb: mb(list.reduce((a, p) => a + p.rss, 0)), processes: list.map(toProc) }))
  return { runs, orphans, totalMb: [...runs, ...orphans].reduce((a, g) => a + g.rssMb, 0) }
}

/** Termine un groupe orphelin. Refuse tout ce qui n'est pas un agent Shipyard sans run. */
export async function killOrphan(pgid: number) {
  const { orphans } = await agentProcesses()
  if (!orphans.some((o) => o.pgid === pgid)) throw new HttpError(404, 'Aucun agent orphelin avec ce groupe')
  process.kill(-pgid, 'SIGTERM')
  setTimeout(() => {
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      /* déjà terminé */
    }
  }, 5000).unref()
}
