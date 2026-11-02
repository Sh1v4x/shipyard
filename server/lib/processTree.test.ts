import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { descendants, killProcessTree } from './processTree.ts'

describe('descendants', () => {
  it('trouve toute la descendance, les plus profonds d’abord, sans les autres branches', () => {
    // claude (10) → shell de fond (20) → bun dev (21) → node (22) ; claude → playwright (30) ; autre processus (40, 41)
    const table = [
      { pid: 10, ppid: 1 }, { pid: 20, ppid: 10 }, { pid: 21, ppid: 20 }, { pid: 22, ppid: 21 },
      { pid: 30, ppid: 10 }, { pid: 40, ppid: 1 }, { pid: 41, ppid: 40 },
    ]
    expect(descendants(10, table)).toEqual([22, 21, 20, 30])
    expect(descendants(99, table)).toEqual([])
  })
})

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('killProcessTree', () => {
  it('arrête aussi une tâche de fond lancée dans son propre groupe de processus', async () => {
    // Comme un agent : un parent qui lance un « serveur » détaché (nouveau groupe), puis attend.
    const script = "const { spawn } = require('node:child_process'); const s = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); console.log(s.pid); setInterval(() => {}, 1000)"
    const parent = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const server = await new Promise<number>((resolve) => parent.stdout.once('data', (d) => resolve(Number(String(d).trim()))))
    expect(alive(server)).toBe(true)
    killProcessTree(parent.pid ?? 0, 'SIGKILL')
    await new Promise((r) => setTimeout(r, 300))
    expect(alive(server)).toBe(false)
  })
})
