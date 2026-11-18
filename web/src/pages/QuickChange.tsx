import { PlusIcon, ZapIcon } from 'lucide-react'
import { useState } from 'react'
import type { PrecheckOutput, Project } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useRuns } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Pill, PromptMenu, RunPanel, Spinner } from '../ui.tsx'
import { PrecheckResult } from './Precheck.tsx'

/** Identifiant court d'une modification rapide : il range ses passages (plan, échanges) et sert d'adresse à sa page. */
const newId = () => crypto.randomUUID().slice(0, 8)

/**
 * Modification rapide, sans ticket : je décris ce que je veux changer, l'IA l'analyse dans le code du projet et rend un
 * plan. J'échange avec elle si besoin, puis j'approuve : la branche et le worktree sont créés, et elle applique le plan.
 * Rien n'est créé avant mon accord, rien n'est commité avant que j'aie vu le résultat.
 */
export function QuickChangePage({ project, id }: { project: Project; id?: string }) {
  const plan = useAction<PrecheckOutput>('quick-change', { project: project.id, ref: id })
  const recent = useRuns({ project: project.id, kind: 'quick-change' })
  const [request, setRequest] = useState('')
  // Une modification par identifiant : les précédentes restent ouvrables, sous le titre de leur premier passage.
  const others = [...new Map((recent.data ?? []).filter((r) => r.scope.ref && r.scope.ref !== id).reverse().map((r) => [r.scope.ref!, r.title.replace(/^(Échange · )?Modif rapide · /, '')])).entries()].reverse().slice(0, 8)

  const launch = async () => {
    const text = request.trim()
    if (!text) return
    // Une demande neuve ouvre une nouvelle modification ; relancer celle affichée garde son identifiant.
    const ref = id && !plan.id ? id : newId()
    const started = await plan.start({ ref, extra: text })
    if (started) go({ page: 'quick-change', project: project.id, id: ref })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Modification rapide</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Pour un changement qui ne mérite pas un ticket : décris-le, l’IA l’analyse dans le code de {project.name} et propose un plan. Tu approuves, la branche et le worktree sont créés et elle applique le plan. Rien n’est créé avant ton accord, rien n’est commité sans toi.
          </p>
        </div>
        <PromptMenu items={[['quick-change', 'Modification rapide (sans ticket)']]} />
      </div>

      {(!id || !plan.id) && !plan.loading && (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="quick-change-request">Ce que tu veux changer</FieldLabel>
            <Textarea id="quick-change-request" rows={4} value={request} onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !plan.busy) void launch() }}
              placeholder="Ex. : le total de la facture ne compte pas les remises quand la liste est vide · renomme « Bilan » en « Clôture » dans le menu · ajoute un bouton pour copier l’IBAN sur la page du compte." />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!request.trim() || plan.busy} onClick={() => void launch()} title="⌘ + Entrée">
              {plan.starting ? <Spinner /> : <ZapIcon />}Analyser et proposer un plan
            </Button>
            <span className="text-sm text-muted-foreground">Lecture seule : aucun fichier modifié, aucune branche créée.</span>
          </div>
        </section>
      )}

      {id && plan.id && (
        <>
          {plan.run?.request && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/60 p-4 text-sm">
              <p className="min-w-0 flex-1"><span className="font-medium">Ta demande :</span> <span className="whitespace-pre-wrap">{plan.run.request}</span></p>
              <Button size="sm" variant="outline" asChild><a href={href({ page: 'quick-change', project: project.id })}><PlusIcon />Autre modification</a></Button>
            </div>
          )}
          <RunPanel id={plan.id} events={plan.events} running={plan.running} run={plan.run} label="L’IA lit ta demande et explore le code" onStop={plan.stop} action={plan} />
          {plan.result && !plan.busy && (
            <PrecheckResult project={project} ticket={null} runId={plan.id} out={plan.result} note={plan.run?.note ?? null} approved={plan.run?.decision === 'approved'} worktree={null}
              onSend={(feedback) => plan.start({ feedback, previousRunId: plan.id })} />
          )}
        </>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Modifications précédentes</span>
          {others.map(([ref, title]) => <Pill key={ref} active={false} className="max-w-64 truncate text-xs" onClick={() => go({ page: 'quick-change', project: project.id, id: ref })}>{title}</Pill>)}
        </div>
      )}
    </div>
  )
}
