import { useEffect, useState } from 'react'
import type { StatsScope } from '../../shared/types.ts'

/** Routeur minimal basé sur le hash : #/p/<projet>, #/p/<projet>/wt/<id>/<onglet>, #/prompts/<clé>… */
export type Route =
  | { page: 'home' }
  | { page: 'overview'; project: string; tab?: string }
  | { page: 'worktree'; project: string; wt: string; tab?: string }
  | { page: 'create'; project: string; ticket?: string; mode?: string }
  | { page: 'automations' }
  | { page: 'insights'; project: string; mode?: string }
  | { page: 'new-ticket'; project: string }
  | { page: 'add-project' }
  | { page: 'prompts'; key?: string }
  | { page: 'notes' }
  | { page: 'inbox' }
  | { page: 'daily' }
  | { page: 'stats'; from?: string; to?: string; scope?: StatsScope }
  | { page: 'settings' }

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const q = new URLSearchParams(query)
  const s = path.split('/').filter(Boolean).map(decodeURIComponent)
  if (s[0] === 'p' && s[1]) {
    if (s[2] === 'wt' && s[3]) return { page: 'worktree', project: s[1], wt: s[3], tab: s[4] }
    if (s[2] === 'automations') return { page: 'automations' }
    if (s[2] === 'insights') return { page: 'insights', project: s[1], mode: s[3] }
    if (s[2] === 'ticket') return { page: 'new-ticket', project: s[1] }
    if (s[2] === 'new') return { page: 'create', project: s[1], ticket: q.get('ticket') ?? undefined, mode: q.get('mode') ?? undefined }
    return { page: 'overview', project: s[1], tab: s[2] }
  }
  if (s[0] === 'add-project') return { page: 'add-project' }
  if (s[0] === 'automations') return { page: 'automations' }
  if (s[0] === 'prompts') return { page: 'prompts', key: s[1] }
  if (s[0] === 'notes') return { page: 'notes' }
  if (s[0] === 'inbox') return { page: 'inbox' }
  if (s[0] === 'daily') return { page: 'daily' }
  if (s[0] === 'stats') {
    const scope = q.get('scope')
    return { page: 'stats', from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, scope: scope === 'all' || scope === 'tracked' ? scope : undefined }
  }
  if (s[0] === 'settings') return { page: 'settings' }
  return { page: 'home' }
}

export function href(r: Route): string {
  switch (r.page) {
    case 'overview':
      return `#/p/${r.project}${r.tab ? `/${r.tab}` : ''}`
    case 'worktree':
      return `#/p/${r.project}/wt/${r.wt}${r.tab ? `/${r.tab}` : ''}`
    case 'create': {
      const q = new URLSearchParams()
      if (r.ticket) q.set('ticket', r.ticket)
      if (r.mode) q.set('mode', r.mode)
      return `#/p/${r.project}/new${q.size ? `?${q}` : ''}`
    }
    case 'automations':
      return '#/automations'
    case 'insights':
      return `#/p/${r.project}/insights${r.mode ? `/${r.mode}` : ''}`
    case 'new-ticket':
      return `#/p/${r.project}/ticket`
    case 'add-project':
      return '#/add-project'
    case 'prompts':
      return `#/prompts${r.key ? `/${r.key}` : ''}`
    case 'notes':
      return '#/notes'
    case 'inbox':
      return '#/inbox'
    case 'daily':
      return '#/daily'
    case 'stats': {
      const q = new URLSearchParams()
      if (r.from) q.set('from', r.from)
      if (r.to) q.set('to', r.to)
      if (r.scope) q.set('scope', r.scope)
      return `#/stats${q.size ? `?${q}` : ''}`
    }
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}

export const go = (r: Route) => {
  window.location.hash = href(r)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
