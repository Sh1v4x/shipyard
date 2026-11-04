import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ActionKind, ActionRequest, ConflictResolveOutput, Run, RunEvent } from '../../../shared/types.ts'
import { useToast } from '../ui.tsx'
import { api, queryClient } from './client.ts'
import { qk } from './keys.ts'
import { useRuns, type RunFilter } from './queries.ts'

export async function cancelRun(id: string) {
  await api(`/runs/${id}/cancel`, { method: 'POST' })
  await queryClient.invalidateQueries({ queryKey: qk.runs() })
}

/**
 * Suit un run en direct (SSE). Un run terminé est gardé en cache : revenir sur un onglet
 * ne rouvre pas de flux et ne rejoue pas ses événements.
 */
export function useRun(id: string | null | undefined, onEnd?: (run: Run) => void) {
  const qc = useQueryClient()
  const cached = id ? qc.getQueryData<Run>(qk.run(id)) : undefined
  const [events, setEvents] = useState<RunEvent[]>(cached?.events ?? [])
  const [run, setRun] = useState<Run | null>(cached ?? null)

  useEffect(() => {
    const done = id ? qc.getQueryData<Run>(qk.run(id)) : undefined
    setEvents(done?.events ?? [])
    setRun(done ?? null)
    if (!id || done) return
    const finish = (r: Run) => {
      setRun(r)
      setEvents(r.events)
      qc.setQueryData(qk.run(r.id), r)
      void qc.invalidateQueries({ queryKey: qk.runs() })
      onEnd?.(r)
    }
    const es = new EventSource(`/api/runs/${id}/stream`)
    es.addEventListener('event', (e) => setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data) as RunEvent]))
    es.addEventListener('end', (e) => {
      es.close()
      finish(JSON.parse((e as MessageEvent).data) as Run)
    })
    es.onerror = () => {
      es.close()
      void api<Run>(`/runs/${id}`).then((r) => (r.status === 'running' ? setEvents(r.events) : finish(r)))
    }
    return () => es.close()
  }, [id, qc]) // eslint-disable-line react-hooks/exhaustive-deps

  return { events, run, running: !!id && !run }
}

/** Dernier run d'un type pour une portée donnée + suivi en direct. */
export function useLatestRun(filter: RunFilter & { project: string; kind: ActionKind }) {
  const qc = useQueryClient()
  const runs = useRuns(filter)
  const [override, setOverride] = useState<string | null>(null)
  const id = override ?? runs.data?.[0]?.id ?? null
  // Fin d'un run : ce qu'il a pu écrire (commit, push, réponses GitHub) se voit dans le worktree et la vue du projet.
  const live = useRun(id, () => {
    void qc.invalidateQueries({ queryKey: qk.overview(filter.project) })
    if (filter.worktree) void qc.invalidateQueries({ queryKey: qk.worktree(filter.project, filter.worktree) })
  })
  const toast = useToast()
  return {
    ...live,
    id,
    setId: setOverride,
    loading: runs.isLoading,
    /** Runs précédents de la même action, du plus récent au plus ancien : on peut réafficher une ancienne version. */
    history: runs.data ?? [],
    /** Relance l'action affichée avec les mêmes paramètres (absent pour un run d'avant leur enregistrement). */
    retry: id && live.run && live.run.status !== 'running' && live.run.input
      ? async () => {
          try {
            const r = await api<{ id: string }>(`/runs/${id}/retry`, { method: 'POST' })
            await qc.invalidateQueries({ queryKey: qk.runs() })
            setOverride(r.id)
          } catch (e) {
            toast((e as Error).message, true)
          }
        }
      : undefined,
  }
}

export function useStartAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, input }: { kind: ActionKind; input: ActionRequest }) => api<{ id: string }>(`/actions/${kind}`, { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.runs() }),
  })
}

/**
 * Une action IA liée à une portée (projet, worktree, ref) :
 * retrouve le dernier run (même après un rechargement), le suit en direct, le lance et l'arrête.
 */
export function useAction<T>(kind: ActionKind, scope: { project: string; worktree?: string; ref?: string }, base: ActionRequest = {}) {
  const latest = useLatestRun({ ...scope, kind })
  const start = useStartAction()
  const toast = useToast()
  const ok = latest.run?.status === 'success'
  return {
    ...latest,
    result: ok ? (latest.run!.structured as T) : null,
    failed: latest.run != null && latest.run.status !== 'success',
    starting: start.isPending,
    busy: start.isPending || latest.running,
    start: async (input: ActionRequest = {}) => {
      try {
        const r = await start.mutateAsync({ kind, input: { project: scope.project, worktree: scope.worktree, ref: scope.ref, ...base, ...input } })
        latest.setId(r.id)
        return r.id
      } catch (e) {
        toast((e as Error).message, true)
        return null
      }
    },
    stop: async () => {
      if (latest.id) await cancelRun(latest.id)
    },
  }
}

/** Résolution des conflits : le serveur démarre la fusion avant l'agent, le worktree passe aussitôt en « fusion en cours ». */
export function useResolveConflicts(project: string, worktree: string) {
  const qc = useQueryClient()
  const action = useAction<ConflictResolveOutput>('conflict-resolve', { project, worktree })
  return {
    ...action,
    start: async (input: ActionRequest = {}) => {
      const id = await action.start(input)
      if (id) await qc.invalidateQueries({ queryKey: qk.worktree(project, worktree) })
      return id
    },
  }
}

/**
 * Le test manuel gardait ses étapes cochées et mes décisions dans le navigateur : envoyées une fois au serveur,
 * qui s'en sert maintenant (étape « Tests », description de la PR), puis retirées d'ici.
 */
export async function migrateBrowserTestState() {
  const entries: { key: string; path: string; body: unknown }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? ''
      const value = localStorage.getItem(key)
      if (!value) continue
      if (key.startsWith('manual-steps:')) entries.push({ key, path: `/runs/${key.slice('manual-steps:'.length)}/manual-steps`, body: { checked: JSON.parse(value) } })
      if (key.startsWith('devpanel:test-check:')) entries.push({ key, path: `/runs/${key.slice('devpanel:test-check:'.length)}/check-decision`, body: { decision: value } })
      const answer = key.match(/^devpanel:test-decision:([\w-]+):(.+)$/)
      if (answer) entries.push({ key, path: `/runs/${answer[1]}/test-decision`, body: { name: answer[2], decision: value } })
    }
  } catch {
    return
  }
  for (const e of entries) {
    // Run disparu ou valeur illisible : l'entrée n'a plus d'usage, elle part aussi.
    await api(e.path, { method: 'PUT', body: e.body }).catch(() => undefined)
    localStorage.removeItem(e.key)
  }
}
