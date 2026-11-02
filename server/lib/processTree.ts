import { execFileSync } from 'node:child_process'

export interface ProcessRow {
  pid: number
  ppid: number
}

/** Table des processus de la machine (pid, parent). */
export function processTable(): ProcessRow[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  return out.split('\n').flatMap((line) => {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    return pid && !Number.isNaN(ppid) ? [{ pid, ppid }] : []
  })
}

/** Descendants d'un processus (enfants, petits-enfants…), les plus profonds d'abord. */
export function descendants(root: number, table: ProcessRow[]): number[] {
  const children = new Map<number, number[]>()
  for (const p of table) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid])
  const out: number[] = []
  const visit = (pid: number) => {
    for (const c of children.get(pid) ?? []) {
      visit(c)
      out.push(c)
    }
  }
  visit(root)
  return out
}

/**
 * Arrête un processus et tout ce qu'il a lancé. Les tâches de fond d'un agent (serveur de dev, Metro…) tournent dans
 * leur propre groupe de processus : arrêter le seul groupe de claude les laisserait vivre, et claude les attendrait.
 */
export function killProcessTree(root: number, signal: NodeJS.Signals) {
  let pids: number[] = []
  try {
    pids = descendants(root, processTable())
  } catch {
    /* ps indisponible : on se rabat sur le groupe de claude */
  }
  for (const pid of [...pids, root]) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, signal)
      } catch {
        /* pas chef de groupe, ou déjà terminé */
      }
    }
  }
}
