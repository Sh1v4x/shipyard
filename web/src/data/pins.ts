import { useSyncExternalStore } from 'react'

// Worktrees épinglés dans la barre latérale : une préférence de ce navigateur, gardée dans le localStorage.

const KEY = 'shipyard:pins'
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let pins = read()

function write(next: string[]) {
  pins = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
  for (const l of listeners) l()
}

/** Clé d'un worktree épinglé : projet et identifiant, pour ne pas mélanger les projets. */
const pinKey = (project: string, wt: string) => `${project}:${wt}`

export function usePins() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => pins)
  return {
    isPinned: (project: string, wt: string) => list.includes(pinKey(project, wt)),
    toggle: (project: string, wt: string) => {
      const k = pinKey(project, wt)
      write(list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
    },
    /** Identifiants des worktrees épinglés du projet, dans l'ordre d'épinglage. */
    of: (project: string) => list.filter((k) => k.startsWith(`${project}:`)).map((k) => k.slice(project.length + 1)),
  }
}
