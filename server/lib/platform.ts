import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Plateforme d'un dépôt, pour savoir comment l'agent teste et capture : navigateur (Playwright) ou émulateur Android.

export type Platform = 'web' | 'android'

/** App mobile (Expo / React Native, ou dossier android/) : testée sur l'émulateur Android. Sinon, web. */
export function platformOf(path: string): Platform {
  if (existsSync(join(path, 'android'))) return 'android'
  try {
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    if (pkg.dependencies?.['react-native'] || pkg.dependencies?.expo) return 'android'
  } catch {
    /* pas de package.json */
  }
  return 'web'
}

/** SDK Android local (ANDROID_HOME, sinon l'emplacement par défaut d'Android Studio), ou null. */
export function androidHome(): string | null {
  const dir = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library', 'Android', 'sdk')
  return existsSync(dir) ? dir : null
}

/** Émulateurs (AVD) disponibles. */
export function androidAvds(): string[] {
  const dir = join(homedir(), '.android', 'avd')
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.ini')).map((f) => f.slice(0, -4))
  } catch {
    return []
  }
}
