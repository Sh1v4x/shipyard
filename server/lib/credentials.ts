import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials } from '../../shared/types.ts'
import { ROOT } from './config.ts'
import { run } from './exec.ts'
import * as gh from './github.ts'
import * as linear from './linear.ts'
import * as postman from './postman.ts'

// Clés de connexion, réglables depuis l'interface : enregistrées dans .env.local (jamais commité)
// et appliquées tout de suite, sans redémarrer le serveur.

const ENV_FILE = join(ROOT, '.env.local')

/** Écrit (ou retire, si value est null) une variable dans .env.local et dans l'environnement du serveur. */
function setEnv(key: string, value: string | null) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n') : []
  const at = lines.findIndex((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1] === key)
  if (value === null) {
    if (at >= 0) lines.splice(at, 1)
    delete process.env[key]
  } else {
    if (at >= 0) lines[at] = `${key}=${value}`
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`)
    process.env[key] = value
  }
  writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 })
}

/** Quatre derniers caractères, pour reconnaître une clé sans l'afficher. */
const hint = (v: string | undefined) => (v ? `…${v.slice(-4)}` : null)

interface ClaudeAuth { loggedIn: boolean; authMethod?: string; email?: string; orgName?: string; subscriptionType?: string }

/** État de Claude Code : installé, version, compte connecté (claude auth status). */
async function claudeStatus(): Promise<Credentials['claude']> {
  const version = (await run('claude', ['--version']).catch(() => '')).trim() || null
  if (!version) return { installed: false, version: null, loggedIn: false, method: null, email: null, org: null, plan: null }
  const auth = await run('claude', ['auth', 'status', '--json']).then((s) => JSON.parse(s) as ClaudeAuth).catch(() => null)
  return {
    installed: true,
    version,
    loggedIn: !!auth?.loggedIn,
    method: auth?.authMethod ?? null,
    email: auth?.email ?? null,
    org: auth?.orgName ?? null,
    plan: auth?.subscriptionType ?? null,
  }
}

export async function getCredentials(): Promise<Credentials> {
  const key = process.env.LINEAR_API_KEY
  const token = process.env.GH_TOKEN
  const postmanKey = process.env.POSTMAN_API_KEY
  const [linearUser, githubLogin, postmanUser, claude] = await Promise.all([
    key ? linear.checkLinearKey(key).then((v) => v.name).catch(() => null) : Promise.resolve(null),
    gh.me().catch(() => null),
    postmanKey ? postman.me().catch(() => null) : Promise.resolve(null),
    claudeStatus(),
  ])
  return {
    linear: { configured: !!key, hint: hint(key), user: linearUser },
    github: { source: token ? 'token' : 'gh', hint: hint(token), login: githubLogin },
    postman: { configured: !!postmanKey, hint: hint(postmanKey), user: postmanUser },
    claude,
  }
}

/**
 * Connexion à Claude Code : la connexion passe par le navigateur et peut demander de coller un code,
 * elle est donc lancée dans une fenêtre Terminal (claude auth login), où elle se termine.
 */
export async function claudeLogin() {
  await run('osascript', ['-e', 'tell application "Terminal"', '-e', 'activate', '-e', 'do script "claude auth login --claudeai"', '-e', 'end tell'])
}

export async function claudeLogout() {
  await run('claude', ['auth', 'logout'])
}

/** Vérifie puis enregistre la clé Linear ; null la retire. */
export async function setLinearKey(key: string | null) {
  if (key) await linear.checkLinearKey(key.trim())
  setEnv('LINEAR_API_KEY', key?.trim() || null)
  linear.resetLinear()
}

/** Vérifie puis enregistre un jeton GitHub ; null revient à la connexion de `gh` (gh auth login). */
export async function setGithubToken(token: string | null) {
  if (token) await gh.checkGithubToken(token.trim())
  setEnv('GH_TOKEN', token?.trim() || null)
  gh.resetGithub()
}

/** Vérifie puis enregistre la clé Postman ; null la retire (l'onglet Postman disparaît des worktrees). */
export async function setPostmanKey(key: string | null) {
  if (key) await postman.checkPostmanKey(key.trim())
  setEnv('POSTMAN_API_KEY', key?.trim() || null)
  postman.resetPostman()
}
