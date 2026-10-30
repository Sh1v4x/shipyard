import { CheckIcon, GitCommitHorizontalIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { BlockedCommit as Blocked, CommitFixOutput, HookFixPlanOutput, Run } from '../../../shared/types.ts'
import { useAction } from '../data/runs.ts'
import { Badge, PromptMenu, RunPanel, Spinner, plural } from '../ui.tsx'

/**
 * Correction faite mais commit refusé par un hook git : les changements attendent dans le worktree.
 * Shipyard propose une solution ; je l'approuve ou je dis quoi faire, puis il recommite, pousse et poste les DONE en attente.
 */
export function BlockedCommit({ run }: { run: Run | null }) {
  const b = run?.blockedCommit
  if (!run || !b) return null
  return <BlockedCard run={run} b={b} />
}

function BlockedCard({ run, b }: { run: Run; b: Blocked }) {
  const scope = { project: run.scope.project, worktree: run.scope.worktree, ref: run.id }
  const plan = useAction<HookFixPlanOutput>('hook-fix-plan', scope, { previousRunId: run.id })
  const fix = useAction<CommitFixOutput>('hook-fix', scope, { previousRunId: run.id })
  const [other, setOther] = useState<string | null>(null)
  const p = plan.result
  // Commité par une correction (ce run-ci, ou une suivante dans la chaîne, qui porte alors son propre blocage).
  const resolved = !!b.resolvedBy || (fix.run?.status === 'success' && !fix.run.blockedCommit)

  if (resolved) {
    return <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckIcon className="size-4" />Commit passé après correction{b.threads.length ? `, ${plural(b.threads.length, 'DONE posté', 'DONE postés')}` : ''}.</p>
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GitCommitHorizontalIcon className="size-4 text-amber-700 dark:text-amber-400" />
        <span className="font-medium text-amber-800 dark:text-amber-300">Commit refusé par un hook git</span>
        <span className="text-muted-foreground">
          · les changements sont gardés, pas commités{b.threads.length ? ` · ${plural(b.threads.length, 'fil attend', 'fils attendent')} son DONE` : ''}
        </span>
        <span className="ml-auto"><PromptMenu items={[['hook-fix-plan', 'Solution à un commit refusé']]} /></span>
      </div>
      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground">Sortie du hook</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{b.error.split('\n').slice(-60).join('\n')}</pre>
      </details>
      {!p && (
        <div>
          <Button size="sm" disabled={plan.busy} onClick={() => plan.start({ previousRunId: run.id })}>
            {plan.busy ? <Spinner /> : <SparklesIcon />}Proposer une solution
          </Button>
        </div>
      )}
      <RunPanel id={plan.id} events={plan.events} running={plan.running} run={plan.run} label="Claude lit la sortie du hook et le code" onStop={plan.stop} action={plan} />
      {p && (
        <div className="flex flex-col gap-2 rounded-md border bg-background p-3">
          <p><span className="font-medium">Cause : </span>{p.cause}</p>
          <p><span className="font-medium">Solution proposée : </span>{p.proposal}</p>
          {p.newTitle && <p><span className="font-medium">Nouveau titre : </span><span className="font-mono text-xs">{p.newTitle}</span></p>}
          {p.disablesRule && <Badge tone="red" className="self-start">Désactive une règle</Badge>}
          {!fix.busy && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => fix.start({ previousRunId: run.id, planRunId: plan.id })}>Approuver : corriger et recommiter</Button>
              <Button size="sm" variant="outline" onClick={() => setOther(other == null ? '' : null)}>Autre solution…</Button>
              <Button size="sm" variant="ghost" disabled={plan.busy} onClick={() => plan.start({ previousRunId: run.id })}>Proposer autre chose</Button>
            </div>
          )}
          {other != null && !fix.busy && (
            <div className="flex flex-col gap-2">
              <Textarea rows={3} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Ex. : n’utilise pas useEffectEvent, rends les callbacks stables au niveau du module et garde-les en dépendances." />
              <div>
                <Button size="sm" disabled={!other.trim()} onClick={() => { void fix.start({ previousRunId: run.id, feedback: other }); setOther(null) }}>Appliquer ma solution et recommiter</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <RunPanel id={fix.id} events={fix.events} running={fix.running} run={fix.run} label="Correction, commit, push et réponses" onStop={fix.stop} action={fix} />
      {/* Refusé à nouveau : la correction porte à son tour le commit en attente. */}
      <BlockedCommit run={fix.run} />
    </div>
  )
}
