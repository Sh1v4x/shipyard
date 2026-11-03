import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { ActionInput, ActionKind, PromptCost, Run, RunEvent, RunScope, RunSummary } from '../../shared/types.ts'
import { RUNS_DIR } from './config.ts'
import { killProcessTree } from './processTree.ts'
import { costsByPrompt, createRunStore, type RunRecord } from './runStore.ts'
import { androidHome } from './platform.ts'
import { fableExhausted } from './usage.ts'
import { loadAgents, systemPrompt } from './prompts.ts'

export interface RunSpec {
  /** Appelé à chaque outil lancé par l'agent, avec ses paramètres (ex. suivre sa liste TodoWrite). */
  onTool?: (name: string, input: Record<string, unknown>) => void
  /** Identifiant imposé (utile quand des fichiers du run doivent exister avant son lancement). */
  id?: string
  /** Reprend une session claude existante (garde tout le contexte, coûte moins cher). */
  resume?: string | null
  kind: ActionKind
  title: string
  scope: RunScope
  cwd: string
  prompt: string
  schema?: object
  model?: string | null
  permissionMode?: string
  /** Outils autorisés sans confirmation (en -p, tout le reste est refusé). */
  allowedTools?: string[]
  disallowedTools?: string[]
  /** Restreint les outils intégrés disponibles ("" = aucun). */
  tools?: string
  /** Dossiers lisibles en plus du worktree (ex. diff écrit par le serveur). */
  addDirs?: string[]
  /** Sous-agents (fichiers agents/*.md) exposés à l'agent principal. */
  agents?: string[]
  /** Serveurs MCP propres au run (ex. Playwright pour les tests). */
  mcpServers?: Record<string, unknown>
  /** Prompt dont vient `prompt` (voir Run.promptKey). */
  promptKey?: string
  /** Message de l'utilisateur à l'origine du run (ex. question sur un plan), gardé pour l'affichage. */
  note?: string | null
  /** Demande initiale (consigne d'un plan), reprise telle quelle lors des échanges et du travail. */
  request?: string | null
  /** Charge les réglages utilisateur (plugins, hooks) : plus lent et plus cher, désactivé par défaut. */
  userSettings?: boolean
  /** Appelé avec la sortie structurée quand le run réussit (commit, push, réponse GitHub…). */
  onSuccess?: (run: Run) => Promise<void>
}

interface Live {
  run: Run
  /** Absent pour une tâche serveur (startJob) : l'arrêt passe alors par `run.status`. */
  child?: ChildProcess
  bus: EventEmitter
  /** Tâches en cours d'un job (ex. run claude de correction) à arrêter avec lui. */
  children?: Set<string>
}

const live = new Map<string, Live>()

const store = createRunStore(RUNS_DIR)
const save = (run: Run) => store.save(run)

// Au démarrage, un run resté « running » sur disque appartient à un serveur précédent : il est perdu.
for (const { id } of store.records().filter((r) => r.status === 'running')) {
  const r = store.get(id)
  if (!r) continue
  r.status = 'error'
  r.endedAt = new Date().toISOString()
  r.events.push({ t: 'error', text: 'Interrompu : le serveur Shipyard a redémarré pendant le run.' })
  save(r)
}

/** Supprime les vieux runs (voir RunStore.purge) ; `onRemove` nettoie ce qui est rangé sous leur id. */
export const purgeRuns = (onRemove: (id: string) => void) => store.purge(Date.now(), onRemove)

// Les agents ne doivent pas survivre au serveur.
const killAll = () => {
  for (const l of live.values()) if (l.child) killTree(l.child)
}
process.on('exit', killAll)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => {
    killAll()
    process.exit(0)
  })

/** Arrête claude et tout ce qu'il a lancé, tâches de fond comprises (SIGTERM, puis SIGKILL après 5 s). */
function killTree(child: ChildProcess) {
  const pid = child.pid
  if (pid == null || child.exitCode != null) return
  killProcessTree(pid, 'SIGTERM')
  setTimeout(() => {
    if (child.exitCode == null) killProcessTree(pid, 'SIGKILL')
  }, 5000).unref()
}

/**
 * Délai laissé à un agent après son résultat final : claude ne se termine pas tant que ses tâches de fond tournent
 * (serveur de dev, Metro…), même si l'agent n'en a plus besoin. Passé ce délai, Shipyard les arrête lui-même.
 */
const RESULT_GRACE_MS = 60_000

/**
 * Sans aucune sortie de claude pendant ce délai et sans résultat, l'agent est bloqué (outil qui ne répond plus, comme
 * un navigateur figé). Les commandes ont leur propre limite (10 min au plus), les outils MCP aussi (MCP_TOOL_TIMEOUT).
 */
const STALL_MS = 20 * 60_000

const STALL_RESUME_PROMPT = [
  'Shipyard stopped you: no progress for 20 minutes, most likely a tool or command that stopped responding (browser, emulator, network).',
  'The servers and tools you had started in the background were stopped too: restart what you need.',
  'Do not repeat the action that hung as is: restart the tool (reopen the browser, restart the emulator) or work around it, then continue the task where you left off and deliver your output.',
].join(' ')

/** Termine les processus restants d'un groupe (SIGTERM, puis SIGKILL après 5 s). */
function cleanupGroup(pid: number | undefined) {
  if (pid == null) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return // groupe déjà vide
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* déjà terminé */
    }
  }, 5000).unref()
}

/** Processus claude des runs en cours (pid = groupe de processus, lancé en détaché). */
export function liveAgents(): { run: Run; pid: number }[] {
  return [...live.values()].filter((l) => l.child?.pid != null).map((l) => ({ run: l.run, pid: l.child!.pid! }))
}

export function getRun(id: string): Run | null {
  return live.get(id)?.run ?? store.get(id)
}

export function subscribe(id: string, fn: (e: RunEvent | { t: 'end'; run: Run }) => void): () => void {
  const l = live.get(id)
  if (!l) return () => undefined
  const onEvent = (e: RunEvent) => fn(e)
  const onEnd = (run: Run) => fn({ t: 'end', run })
  l.bus.on('event', onEvent)
  l.bus.on('end', onEnd)
  return () => {
    l.bus.off('event', onEvent)
    l.bus.off('end', onEnd)
  }
}

export function cancelRun(id: string) {
  const l = live.get(id)
  if (!l) return false
  l.run.status = 'cancelled'
  l.run.events.push({ t: 'error', text: 'Arrêté à la demande.' })
  for (const sub of l.children ?? []) cancelRun(sub)
  if (l.child) killTree(l.child)
  return true
}

/** Garde les paramètres de l'action sur le run (en cours ou terminé), pour pouvoir la relancer. */
export function setRunInput(id: string, input: ActionInput) {
  const r = getRun(id)
  if (!r) return
  r.input = input
  save(r)
}

/** Modifie un run terminé ou en cours (champs de suivi : commit bloqué…). */
export function patchRun(id: string, patch: Partial<Pick<Run, 'blockedCommit' | 'manualChecked' | 'checkDecision'>>) {
  const l = live.get(id)
  const r = l?.run ?? getRun(id)
  if (!r) return
  Object.assign(r, patch)
  save(r)
}

/** Enregistre ma décision sur un run terminé. */
export function setRunDecision(id: string, decision: NonNullable<Run['decision']>): Run | null {
  const r = getRun(id)
  if (!r || r.status === 'running') return null
  r.decision = decision
  save(r)
  return r
}

/** Attend la fin d'un run (utile pour enchaîner des étapes dans une tâche serveur). */
export function waitForRun(id: string): Promise<Run> {
  const l = live.get(id)
  if (!l) return Promise.resolve(getRun(id)!)
  return new Promise((resolve) => l.bus.once('end', resolve))
}

export interface JobContext {
  log: (e: RunEvent) => void
  /** Le run du job, pour y poser des champs de suivi (commit bloqué…). */
  run: Run
  cancelled: () => boolean
  /** Lance un run claude rattaché au job (arrêté avec lui) et attend sa fin. */
  runChild: (spec: RunSpec) => Promise<Run>
}

/**
 * Tâche serveur suivie comme un run (journal en direct, reprise après rechargement, bouton Arrêter),
 * sans process claude propre. La valeur renvoyée par `work` devient la sortie structurée.
 */
export function startJob(meta: { kind: ActionKind; title: string; scope: RunScope }, work: (ctx: JobContext) => Promise<unknown>): Run {
  const run: Run = {
    id: randomUUID(), ...meta, status: 'running', startedAt: new Date().toISOString(), endedAt: null, costUsd: null,
    events: [], result: null, structured: null, sessionId: null,
  }
  const bus = new EventEmitter()
  const entry: Live = { run, bus, children: new Set() }
  live.set(run.id, entry)
  save(run)
  const log = (e: RunEvent) => {
    run.events.push(e)
    save(run)
    bus.emit('event', e)
  }
  const ctx: JobContext = {
    log,
    run,
    cancelled: () => run.status === 'cancelled',
    runChild: async (spec) => {
      const child = startRun(spec)
      entry.children!.add(child.id)
      log({ t: 'info', text: `Agent lancé : ${spec.title}` })
      const done = await waitForRun(child.id)
      entry.children!.delete(child.id)
      run.costUsd = (run.costUsd ?? 0) + (done.costUsd ?? 0)
      return done
    },
  }
  void (async () => {
    try {
      run.structured = await work(ctx)
      if (run.status === 'running') run.status = 'success'
    } catch (e) {
      if (run.status === 'running') run.status = 'error'
      log({ t: 'error', text: (e as Error).message })
    }
    run.endedAt = new Date().toISOString()
    log({ t: 'info', text: run.status === 'success' ? 'Terminé.' : run.status === 'cancelled' ? 'Arrêté.' : 'Échec.' })
    bus.emit('end', run)
    live.delete(run.id)
    notifyEnd(run)
  })()
  return run
}

/** Tous les runs, en cours et terminés, sans leur journal. */
export function allRuns(): RunRecord[] {
  const runs: RunRecord[] = [...live.values()].map(({ run: { events: _e, ...record } }) => record)
  const seen = new Set(runs.map((r) => r.id))
  return [...runs, ...store.records().filter((r) => !seen.has(r.id))]
}

const endListeners: ((run: Run) => void)[] = []
/** Prévenu à la fin de chaque run (agent ou tâche serveur), une fois son résultat enregistré. */
export const onRunEnd = (fn: (run: Run) => void) => endListeners.push(fn)
const notifyEnd = (run: Run) => {
  for (const fn of endListeners) fn(run)
}

/** Derniers runs, filtrés par portée. */
export function listRuns(filter: Partial<RunScope> & { kind?: string; status?: string }, limit = 30): RunSummary[] {
  return allRuns()
    .filter((r) =>
      (!filter.kind || r.kind === filter.kind) &&
      (!filter.status || r.status === filter.status) &&
      (!filter.project || r.scope.project === filter.project) &&
      (!filter.worktree || r.scope.worktree === filter.worktree) &&
      (filter.pr == null || r.scope.pr === filter.pr) &&
      (!filter.ref || r.scope.ref === filter.ref),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map(({ result: _r, structured: _s, sessionId: _id, input: _in, ...summary }) => summary)
}

/** Ligne de `claude -p --output-format stream-json` : seuls les champs lus par Shipyard. */
interface StreamMessage {
  type?: string
  subtype?: string
  session_id?: string
  parent_tool_use_id?: string | null
  message?: { content?: { type: string; id: string; name: string; text?: string; input?: Record<string, unknown> }[] }
  total_cost_usd?: number
  result?: unknown
  structured_output?: unknown
  is_error?: boolean
}

function parseStreamMessage(line: string): StreamMessage | null {
  try {
    const msg: unknown = JSON.parse(line)
    return msg && typeof msg === 'object' ? (msg as StreamMessage) : null
  } catch {
    return null
  }
}

export const promptCosts = (days: number): Map<string, PromptCost> => costsByPrompt(allRuns(), Date.now() - days * 86_400_000)

function summarizeTool(name: string, input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.pattern ?? input.description ?? input.prompt ?? input.url ?? ''
  return String(v).split('\n')[0].slice(0, 160) || name
}

/**
 * Environnement des agents : celui du serveur, sans ses propres réglages (PORT, PANEL_URL…). Sinon l'app
 * lancée par l'agent pour ses tests lit PORT=4317 et tombe sur le port de Shipyard (EADDRINUSE).
 */
const SHIPYARD_ONLY = ['PORT', 'PANEL_URL', 'WORKTREE_ROOT', 'PROJECTS_ROOT']
export function agentEnv(): NodeJS.ProcessEnv {
  // MCP_TOOL_TIMEOUT : un outil MCP figé (navigateur Playwright qui ne répond plus) renvoie une erreur au bout de
  // 3 min au lieu de bloquer l'agent ; il peut alors relancer l'outil.
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'shipyard', MCP_TOOL_TIMEOUT: String(3 * 60_000) }
  for (const k of SHIPYARD_ONLY) delete env[k]
  // Outils Android (emulator, adb) dans le PATH : les agents testent les apps mobiles sur l'émulateur.
  const sdk = androidHome()
  if (sdk) {
    env.ANDROID_HOME = sdk
    env.PATH = [join(sdk, 'emulator'), join(sdk, 'platform-tools'), env.PATH].filter(Boolean).join(':')
  }
  return env
}

export function startRun(spec: RunSpec): Run {
  const run: Run = {
    id: spec.id ?? randomUUID(),
    kind: spec.kind,
    title: spec.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    costUsd: null,
    scope: spec.scope,
    ...(spec.promptKey ? { promptKey: spec.promptKey } : {}),
    ...(spec.note ? { note: spec.note } : {}),
    ...(spec.request ? { request: spec.request } : {}),
    events: [],
    result: null,
    structured: null,
    sessionId: null,
  }

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt()]
  if (!spec.userSettings) args.push('--setting-sources', 'project,local')
  if (spec.mcpServers) args.push('--mcp-config', JSON.stringify({ mcpServers: spec.mcpServers }), '--strict-mcp-config')
  else if (!spec.userSettings) args.push('--strict-mcp-config')
  // Sans modèle fixé, l'agent prend Fable (le défaut) : quota épuisé, il passe sur Opus plutôt que d'échouer.
  const model = spec.model ?? (fableExhausted() ? 'opus' : null)
  if (model) args.push('--model', model)
  if (model && !spec.model) run.events.push({ t: 'info', text: 'Quota hebdomadaire de Fable épuisé : agent lancé sur Opus.' })
  if (spec.permissionMode && spec.permissionMode !== 'default') args.push('--permission-mode', spec.permissionMode)
  if (spec.addDirs?.length) args.push('--add-dir', ...spec.addDirs)
  if (spec.tools != null) args.push('--tools', spec.tools)
  if (spec.allowedTools?.length) args.push('--allowedTools', ...spec.allowedTools)
  if (spec.disallowedTools?.length) args.push('--disallowedTools', ...spec.disallowedTools)
  if (spec.schema) args.push('--json-schema', JSON.stringify(spec.schema))
  if (spec.agents?.length) args.push('--agents', JSON.stringify(loadAgents(spec.agents)))

  const bus = new EventEmitter()
  const entry: Live = { run, bus }
  live.set(run.id, entry)
  save(run)

  // Sauvegarde régulière : un rechargement de page ou un redémarrage retrouve l'état du run.
  let dirty = false
  const flush = setInterval(() => {
    if (dirty) {
      dirty = false
      save(run)
    }
  }, 1000)
  const push = (e: RunEvent) => {
    run.events.push(e)
    dirty = true
    bus.emit('event', e)
  }
  // Une seule relance automatique par run après un blocage (voir STALL_MS).
  let relaunched = false

  /** Lance claude (ou reprend sa session) et branche sa sortie sur le run. */
  const launch = (prompt: string, resume: string | null | undefined) => {
    // detached : claude devient chef de groupe, ce qui permet d'arrêter aussi ce qu'il a lancé.
    const child = spawn('claude', [...args, ...(resume ? ['--resume', resume] : [])], { cwd: spec.cwd, detached: true, env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    entry.child = child
    child.stdin.end(prompt)
    // Coût des lancements précédents (relance) : celui que claude annonce est cumulé pour ce processus seulement.
    const priorCost = run.costUsd ?? 0
    push({ t: 'info', text: resume && relaunched ? 'claude -p relancé (reprise de la session)' : `claude -p lancé dans ${spec.cwd}` })

    // Résultat final reçu, et minuteur qui arrête ensuite les tâches de fond restées ouvertes (voir RESULT_GRACE_MS).
    let resultDelivered = false
    let leftovers: ReturnType<typeof setTimeout> | undefined
    // Dernière sortie de claude : sans rien depuis STALL_MS et sans résultat, l'agent est bloqué.
    let lastOutput = Date.now()
    let stalled = false
    const watchdog = setInterval(() => {
      if (resultDelivered || child.exitCode != null || Date.now() - lastOutput < STALL_MS) return
      clearInterval(watchdog)
      stalled = true
      push({ t: 'info', text: `Aucune activité depuis ${STALL_MS / 60_000} min : l’agent est bloqué (outil ou commande qui ne répond plus). Shipyard l’arrête${relaunched ? '' : ' et le relance'}.` })
      killTree(child)
    }, 60_000)

    // Les sous-agents sont identifiés par le tool_use Agent/Task qui les a lancés.
    const subNames = new Map<string, string>()
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      lastOutput = Date.now()
      buf += chunk
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) handle(line)
      }
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
    })

    function handle(line: string) {
      const msg = parseStreamMessage(line)
      if (!msg) return
      if (msg.session_id) run.sessionId = msg.session_id
      const sub = msg.parent_tool_use_id ? subNames.get(msg.parent_tool_use_id) ?? 'sous-agent' : undefined
      if (msg.type === 'assistant') {
        for (const c of msg.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) push({ t: 'text', text: c.text.trim(), sub })
          if (c.type === 'tool_use') {
            if (c.name === 'StructuredOutput') continue
            if (c.name === 'Agent' || c.name === 'Task') subNames.set(c.id, String(c.input?.subagent_type ?? c.input?.description ?? 'sous-agent'))
            try {
              spec.onTool?.(c.name, c.input ?? {})
            } catch {
              /* un suivi en échec ne doit pas casser le run */
            }
            push({ t: 'tool', name: c.name, summary: summarizeTool(c.name, c.input ?? {}), sub, at: Date.now() })
          }
        }
      } else if (msg.type === 'result') {
        run.costUsd = priorCost + (msg.total_cost_usd ?? 0)
        run.result = typeof msg.result === 'string' ? msg.result : null
        run.structured = msg.structured_output ?? null
        if (msg.is_error || msg.subtype !== 'success') push({ t: 'error', text: `Fin en erreur : ${msg.subtype}${msg.result ? ` — ${String(msg.result).slice(0, 300)}` : ''}` })
        else resultDelivered = true
        leftovers ??= setTimeout(() => {
          if (child.exitCode != null || run.status !== 'running') return
          push({ t: 'info', text: 'Résultat rendu, mais des tâches de fond tournaient encore (serveurs de test…) : Shipyard les arrête.' })
          killTree(child)
        }, RESULT_GRACE_MS)
      }
    }

    child.on('error', (e) => push({ t: 'error', text: `Impossible de lancer claude : ${e.message}` }))
    child.on('close', async (code) => {
      clearInterval(watchdog)
      if (leftovers) clearTimeout(leftovers)
      // claude est sorti : ce qu'il a lancé et laissé tourner (app, Metro, émulateur…) part avec lui.
      cleanupGroup(child.pid)
      if (buf.trim()) handle(buf.trim())
      // Bloqué : on reprend sa session une fois, en lui disant ce qui s'est passé, plutôt que d'échouer.
      if (stalled && !relaunched && run.sessionId && run.status === 'running') {
        relaunched = true
        launch(STALL_RESUME_PROMPT, run.sessionId)
        return
      }
      clearInterval(flush)
      if (run.status !== 'cancelled') {
        if (stalled) push({ t: 'error', text: 'Toujours bloqué après une relance : arrêté.' })
        // Arrêté par Shipyard après son résultat (tâches de fond restées ouvertes) : le travail est fait, ce n'est pas un échec.
        const ok = (code === 0 || resultDelivered) && !run.events.some((e) => e.t === 'error') && (!spec.schema || run.structured != null)
        run.status = ok ? 'success' : 'error'
        if (!ok && stderr.trim()) push({ t: 'error', text: stderr.trim().slice(-800) })
        if (!ok && spec.schema && run.structured == null && code === 0) push({ t: 'error', text: 'Pas de sortie structurée.' })
      }
      if (run.status === 'success' && spec.onSuccess) {
        try {
          push({ t: 'info', text: 'Application du résultat…' })
          await spec.onSuccess(run)
        } catch (e) {
          run.status = 'error'
          push({ t: 'error', text: (e as Error).message })
        }
      }
      run.endedAt = new Date().toISOString()
      push({ t: 'info', text: run.status === 'success' ? 'Terminé.' : run.status === 'cancelled' ? 'Arrêté.' : 'Échec.' })
      save(run)
      bus.emit('end', run)
      live.delete(run.id)
      notifyEnd(run)
    })
  }

  // Le prompt passe par stdin : un diff de PR peut dépasser la taille max d'un argument.
  launch(spec.prompt, spec.resume)
  return run
}
