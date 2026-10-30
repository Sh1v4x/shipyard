import { MutationCache, QueryClient, dehydrate, hydrate } from '@tanstack/react-query'

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
  // Toute action peut régler un élément de « À valider » (review envoyée, plan lancé, tickets créés…) :
  // la liste est relue après chaque mutation, sans que chaque hook ait à y penser.
  mutationCache: new MutationCache({
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['runs', 'inbox'] }),
  }),
})

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText)
  return json as T
}

// ---------- Cache conservé entre deux rechargements ----------
// Les vues de projet et les worktrees déjà vus s'affichent tout de suite au rechargement,
// puis TanStack Query les met à jour en arrière-plan.

// À changer quand la forme d'une donnée gardée change : l'ancien cache est alors ignoré.
const PERSIST_KEY = 'devpanel:query-cache:v2'
const PERSISTED = new Set(['projects', 'overview', 'worktree', 'prompts', 'ticket-states', 'linear-meta', 'notes', 'settings'])
const MAX_AGE = 24 * 3600_000

export function restoreCache() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { at: number; state: Parameters<typeof hydrate>[1] }
    if (Date.now() - saved.at > MAX_AGE) return
    // Les dates d'origine sont gardées : au-delà de staleTime, les données s'affichent puis sont rechargées.
    hydrate(queryClient, saved.state)
  } catch {
    /* cache illisible ou stockage indisponible */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
export function persistCache() {
  queryClient.getQueryCache().subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSISTED.has(String(q.queryKey[0])) })
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ at: Date.now(), state }))
      } catch {
        /* quota dépassé ou stockage indisponible : le cache reste en mémoire */
      }
    }, 1_000)
  })
}
