import { execFile } from 'node:child_process'

export class CommandError extends Error {
  constructor(
    public cmd: string,
    public stderr: string,
    public code: number | null,
    public stdout = '',
  ) {
    super(`${cmd} a échoué${code != null ? ` (code ${code})` : ''} : ${stderr.trim().slice(0, 500)}`)
  }
}

interface ExecOptions {
  cwd?: string
  input?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/** Lance une commande sans shell et renvoie stdout. Rejette avec CommandError si le code de sortie est non nul. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? process.env },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : null
          reject(new CommandError(`${cmd} ${args.slice(0, 3).join(' ')}`, stderr || err.message, code, stdout))
          return
        }
        resolve(stdout)
      },
    )
    if (opts.input != null) {
      child.stdin?.end(opts.input)
    }
  })
}

export async function runJson<T>(cmd: string, args: string[], opts: ExecOptions = {}): Promise<T> {
  const out = await run(cmd, args, opts)
  return JSON.parse(out) as T
}

/** Petit cache mémoire avec durée de vie, pour éviter de rappeler gh/Linear à chaque rendu. */
export function ttlCache<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: Promise<T> }>()
  return {
    get(key: string, load: () => Promise<T>, force = false): Promise<T> {
      const hit = store.get(key)
      if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value
      const value = load()
      store.set(key, { at: Date.now(), value })
      value.catch(() => store.delete(key))
      return value
    },
    values(): Promise<T>[] {
      return [...store.values()].map((v) => v.value)
    },
    clear(prefix = '') {
      for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
    },
  }
}
