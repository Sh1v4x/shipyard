import type { LabelRole, LabelRules, Language, Languages, Settings, SettingsPatch } from '../../shared/types.ts'
import { DEFAULT_LABEL_RULES } from '../../shared/review.ts'
import { jsonFile } from './store.ts'

const DEFAULTS: Settings = {
  labels: DEFAULT_LABEL_RULES,
  notifications: { enabled: true, intervalSec: 120, durationSec: 30 },
  languages: { app: 'fr', github: 'en', pr: 'fr', tickets: 'fr' },
}
const file = jsonFile<Partial<Settings>>('settings.json', {})

export function getSettings(): Settings {
  const s = file.read()
  return { labels: { ...DEFAULTS.labels, ...s.labels }, notifications: { ...DEFAULTS.notifications, ...s.notifications }, languages: { ...DEFAULTS.languages, ...s.languages } }
}

/** Raccourci pour les règles de review : les labels reconnus, tous projets confondus. */
export const labelRules = (): LabelRules => getSettings().labels

/** Noms nettoyés : sans espaces autour, sans vide, sans doublon (casse ignorée). */
function cleanNames(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  const out: string[] = []
  for (const n of names) {
    const v = typeof n === 'string' ? n.trim() : ''
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v.slice(0, 100))
  }
  return out
}

export function saveSettings(patch: SettingsPatch): Settings {
  const cur = getSettings()
  const next: Settings = { labels: { ...cur.labels }, notifications: { ...cur.notifications, ...patch.notifications }, languages: { ...cur.languages } }
  for (const k of Object.keys(next.languages) as (keyof Languages)[]) {
    const v = patch.languages?.[k]
    if (v === 'fr' || v === 'en') next.languages[k] = v
  }
  for (const role of Object.keys(DEFAULT_LABEL_RULES) as LabelRole[]) {
    if (patch.labels && role in patch.labels) next.labels[role] = cleanNames(patch.labels[role])
  }
  // Bornes : pas plus d'une vérification toutes les 30 s (limites de l'API GitHub).
  next.notifications.intervalSec = Math.max(30, Math.min(3600, Math.round(next.notifications.intervalSec)))
  next.notifications.durationSec = Math.max(5, Math.min(600, Math.round(next.notifications.durationSec)))
  file.write(next)
  return next
}

const LANGUAGE_NAME: Record<Language, string> = { fr: 'French', en: 'English' }

/**
 * Langues choisies dans les réglages, en variables de prompt : {lang.app}, {lang.github}, {lang.pr}, {lang.tickets}
 * (« French » ou « English »). Disponibles dans tous les prompts et dans le prompt système.
 */
export function languageVars(): Record<string, string> {
  const l = getSettings().languages
  return { 'lang.app': LANGUAGE_NAME[l.app], 'lang.github': LANGUAGE_NAME[l.github], 'lang.pr': LANGUAGE_NAME[l.pr], 'lang.tickets': LANGUAGE_NAME[l.tickets] }
}
