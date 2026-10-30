import { CheckIcon, ClipboardCopyIcon, CopyIcon, ExternalLinkIcon, HandIcon, PlayIcon, SquareIcon, TerminalIcon, WrenchIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { ManualTestOutput, Project, Run, TestCheckOutput } from '../../../../shared/types.ts'
import { useOpenManualEnv, useSaveManualSteps, useSetCheckDecision, useStopManualEnv } from '../../data/mutations.ts'
import { useManualEnv } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Badge, Dot, PromptMenu, RunPanel, Spinner, ago, useToast } from '../../ui.tsx'

/** Étapes cochées, enregistrées sur le run du test manuel : elles comptent pour l'étape « Tests » et la PR. */
function useChecked(project: string, wtId: string, run: Run | null) {
  const toast = useToast()
  const save = useSaveManualSteps(project, wtId)
  const runId = run?.id ?? null
  const [state, setState] = useState({ runId, checked: run?.manualChecked ?? [] })
  // Autre préparation (relance, ou run arrivé après le premier rendu) : repartir de ce qu'elle a enregistré.
  if (state.runId !== runId) setState({ runId, checked: run?.manualChecked ?? [] })
  const toggle = (i: number, on: boolean) => {
    if (!runId) return
    const checked = on ? [...state.checked, i] : state.checked.filter((x) => x !== i)
    setState({ runId, checked })
    save.mutate({ runId, checked }, { onError: (e) => toast(`Étape non enregistrée : ${e.message}`, true) })
  }
  return { checked: state.checked, toggle }
}

/** Test manuel : l'IA prépare l'environnement, Shipyard lance l'app et ouvre Chrome, je suis la liste d'étapes. */
export function ManualTest({ project, wtId, consigne, mine }: { project: Project; wtId: string; consigne: string; mine: boolean }) {
  const prep = useAction<ManualTestOutput>('test-manual', { project: project.id, worktree: wtId })
  const env = useManualEnv(project.id, wtId)
  const stop = useStopManualEnv(project.id, wtId)
  const open = useOpenManualEnv(project.id, wtId)
  const toast = useToast()
  const r = prep.result
  const live = env.data && env.data.runId === prep.id ? env.data : null
  const { checked, toggle } = useChecked(project.id, wtId, prep.run)

  return (
    <section className="flex flex-col gap-4" aria-label="Test manuel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div className="flex min-w-0 flex-[1_1_320px] gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><HandIcon className="size-4" /></div>
          <div className="min-w-0">
            <p className="font-semibold">Tester moi-même</p>
            <p className="mt-0.5 text-sm text-muted-foreground">L’IA prépare l’environnement (dépendances, base, données de test), Shipyard lance l’app et l’ouvre dans Chrome sur la bonne page. Tu suis la liste d’étapes.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PromptMenu items={[['test-manual', 'Préparer un test manuel']]} />
          <Button size="sm" variant={r ? 'outline' : 'default'} disabled={prep.busy} onClick={() => prep.start({ extra: consigne })}>
            {prep.busy ? <Spinner /> : <PlayIcon />}{r ? 'Relancer la préparation' : 'Préparer le test manuel'}
          </Button>
        </div>
      </div>
      <RunPanel id={prep.id} events={prep.events} running={prep.running} run={prep.run} label="Préparation, puis lancement de l’app" onStop={prep.stop} action={prep} />
      {r && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              {live ? <Badge tone="green">App lancée · {ago(live.startedAt)}</Badge> : <Badge tone="gray">App arrêtée</Badge>}
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline-offset-2 hover:underline">{r.url}</a>}
            </div>
            {live && (
              <div className="flex flex-wrap gap-2">
                {live.url && (
                  <Button size="sm" variant="outline" disabled={open.isPending} onClick={() => open.mutate(undefined, { onError: (e) => toast(e.message, true) })}>
                    <ExternalLinkIcon />Rouvrir dans Chrome
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate(undefined, { onSuccess: () => toast('Environnement arrêté'), onError: (e) => toast(e.message, true) })}>
                  {stop.isPending ? <Spinner /> : <SquareIcon />}Arrêter l’app
                </Button>
              </div>
            )}
          </div>
          {live && (
            <div className="flex flex-col gap-1.5 border-b px-5 py-3">
              {live.services.map((s) => (
                <details key={s.name} className="group text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <Dot color={s.alive ? 'var(--color-emerald-500)' : 'var(--color-red-500)'} />
                    <span className="font-medium">{s.name}</span>
                    {s.port != null && <span className="text-muted-foreground">:{s.port}</span>}
                    {!s.alive && <span className="text-red-600 dark:text-red-400">arrêté</span>}
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{s.command}</span>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{s.log || 'Aucune sortie.'}</pre>
                </details>
              ))}
            </div>
          )}
          {r.setup.trim() && <p className="border-b px-5 py-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Préparation : </span>{r.setup}</p>}
          {r.access.trim() && <p className="border-b px-5 py-3 text-sm whitespace-pre-line"><span className="font-medium">Accès : </span>{r.access}</p>}
          <ol>
            {r.steps.map((s, i) => (
              <ManualStep key={i} step={s} index={i} project={project.id} wtId={wtId} runId={prep.id} mine={mine} done={checked.includes(i)} onCheck={(v) => toggle(i, v)} />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

type Step = ManualTestOutput['steps'][number]

/** Commande d'une étape : le champ dédié, sinon celle écrite dans le texte (« Dans un terminal : … », ou entre backticks). */
function commandOf(step: Step): { command: string | null; detail: string } {
  if (step.command?.trim()) return { command: step.command.trim(), detail: step.detail }
  const inText = step.detail.match(/Dans un terminal\s*:\s*([\s\S]+?)\s*(?=Attendu\s*:|$)/i)
  if (inText) return { command: inText[1].replace(/^`+|`+$/g, '').trim(), detail: step.detail.replace(inText[0], '').trim() }
  const ticks = step.detail.match(/`{1,3}([^`]*(?:psql|curl|docker|SELECT|select|cat|jq)[^`]*)`{1,3}/)
  if (ticks) return { command: ticks[1].trim(), detail: step.detail.replace(ticks[0], '').trim() }
  return { command: null, detail: step.detail }
}

/** Ma décision sur une vérification, enregistrée sur son run : prend le pas sur le verdict de l'IA. */
function useCheckDecision(project: string, wtId: string, run: Run | null) {
  const toast = useToast()
  const save = useSetCheckDecision(project, wtId)
  const runId = run?.id ?? null
  const [state, setState] = useState({ runId, value: run?.checkDecision ?? null })
  if (state.runId !== runId) setState({ runId, value: run?.checkDecision ?? null })
  const set = (value: 'pass' | 'fail' | null) => {
    if (!runId) return
    setState({ runId, value })
    save.mutate({ runId, decision: value }, { onError: (e) => toast(`Décision non enregistrée : ${e.message}`, true) })
  }
  return [state.value, set] as const
}

const VERDICT: Record<TestCheckOutput['verdict'], [string, 'green' | 'red' | 'amber']> = { pass: ['Conforme', 'green'], fail: ['Non conforme', 'red'], unclear: ['À voir', 'amber'] }

/**
 * Une étape du test manuel. Quand elle se vérifie dans un terminal : la commande, un bouton pour la copier,
 * et « Exécuter », qui la lance et compare le résultat à l'attendu. Une étape conforme se coche toute seule.
 */
function ManualStep({ step, index, project, wtId, runId, mine, done, onCheck }: { step: Step; index: number; project: string; wtId: string; runId: string | null; mine: boolean; done: boolean; onCheck: (v: boolean) => void }) {
  const { command, detail } = commandOf(step)
  const check = useAction<TestCheckOutput>('test-check', { project, worktree: wtId, ref: `${runId}:${index}` })
  const fixer = useAction('ticket', { project, worktree: wtId })
  const toast = useToast()
  const out = check.result
  // Ma décision sur un verdict « À voir » ou « Non conforme ».
  const [decision, setDecision] = useCheckDecision(project, wtId, check.run)
  const verdict = decision ?? out?.verdict
  const askFix = async () => {
    if (!out) return
    const id = await fixer.start({ extra: [
      `Fix what the manual test reveals. Step: "${step.title}".`,
      `Check command: ${out.command}`,
      `Expected: ${step.expected}`,
      `Got:\n${out.output}`,
      `Analysis: ${out.explanation}`,
      'If the gap comes from a mistake in the expected result and not from the code, change nothing and explain it.',
    ].join('\n') })
    if (!id) return
    setDecision('fail')
    toast('Correctif demandé : suivi dans Ticket et commits')
    go({ page: 'worktree', project, wt: wtId, tab: 'ticket' })
  }
  const copy = (text: string, done: string) => navigator.clipboard.writeText(text).then(() => toast(done), () => toast('Copie impossible : sélectionne le texte à la main', true))
  useEffect(() => {
    if (out?.verdict === 'pass' && !done) onCheck(true)
    // Seulement quand un nouveau résultat arrive.
  }, [check.id, out?.verdict])
  const id = `manual-step-${wtId}-${index}`
  return (
    <li className="flex gap-3 border-t px-5 py-3 first:border-t-0">
      <Checkbox id={id} className="mt-0.5" checked={done} onCheckedChange={(v) => onCheck(v === true)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label htmlFor={id} className={cn('min-w-0 cursor-pointer', done && 'opacity-60')}>
          <span className={cn('font-medium', done && 'line-through')}>{index + 1}. {step.title}</span>
          {detail && <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>}
        </label>
        {step.url && (
          <a href={step.url} target="_blank" rel="noreferrer" className="flex w-fit max-w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm transition-colors hover:bg-accent">
            <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">Ouvrir la page</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{step.url.replace(/^https?:\/\//, '')}</span>
          </a>
        )}
        {command && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5">
              <TerminalIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Dans un terminal</span>
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(command, 'Commande copiée')}><CopyIcon />Copier</Button>
                <Button size="sm" className="h-7" disabled={check.busy} title="Lance la commande et compare le résultat à l’attendu" onClick={() => void check.start({ step: step.title, command, expected: step.expected })}>
                  {check.busy ? <Spinner /> : <PlayIcon />}{out ? 'Réexécuter' : 'Exécuter'}
                </Button>
              </span>
            </div>
            <pre className="overflow-x-auto bg-terminal px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-terminal-foreground select-all">{command}</pre>
          </div>
        )}
        <p className="text-sm"><span className="font-medium">Attendu : </span>{step.expected}</p>
        {command && <RunPanel id={check.id} events={check.events} running={check.running} run={check.run} label="Exécution de la commande, puis comparaison avec l’attendu" onStop={check.stop} action={check} />}
        {out && verdict && (
          <div className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm', verdict === 'pass' ? 'border-emerald-500/40 bg-emerald-500/5' : verdict === 'fail' ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={VERDICT[verdict][1]}>{VERDICT[verdict][0]}{decision && ' · tranché par toi'}</Badge>
              <span>{out.explanation}</span>
            </span>
            {command && out.command.trim() !== command.trim() && <p className="text-xs text-muted-foreground">Commande corrigée pour l’environnement : <span className="font-mono break-all">{out.command}</span></p>}
            {out.output.trim() && <pre className="max-h-56 overflow-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs whitespace-pre text-terminal-foreground">{out.output}</pre>}
            {/* La suite : trancher un « À voir », faire corriger un écart, ou revenir sur sa décision. */}
            {verdict !== 'pass' && !decision && (
              <div className="flex flex-col gap-2 border-t border-current/10 pt-2.5">
                <span className="text-xs font-medium text-muted-foreground">{verdict === 'unclear' ? 'L’IA ne peut pas conclure : à toi de trancher.' : 'Le résultat ne correspond pas à l’attendu.'}</span>
                <div className="flex flex-wrap gap-2">
                  {mine
                    ? <Button size="sm" disabled={fixer.busy} onClick={() => void askFix()}>{fixer.busy ? <Spinner /> : <WrenchIcon />}Demander un correctif à l’IA</Button>
                    : <Button size="sm" variant="outline" onClick={() => copy(`Test « ${step.title} » : ${out.explanation}\n\n${out.command}\n${out.output}`, 'Copié : à coller dans ta review')}><ClipboardCopyIcon />Copier pour la review</Button>}
                  <Button size="sm" variant="outline" onClick={() => { setDecision('pass'); onCheck(true) }}><CheckIcon />{verdict === 'unclear' ? 'C’est conforme' : 'C’est conforme quand même'}</Button>
                  {verdict === 'unclear' && <Button size="sm" variant="ghost" onClick={() => { setDecision('fail'); onCheck(false) }}><XIcon />Non conforme</Button>}
                </div>
              </div>
            )}
            {decision && (
              <div className="flex flex-wrap items-center gap-2 border-t border-current/10 pt-2.5">
                {decision === 'fail' && mine && <Button size="sm" disabled={fixer.busy} onClick={() => void askFix()}>{fixer.busy ? <Spinner /> : <WrenchIcon />}Demander un correctif à l’IA</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setDecision(null); if (decision === 'pass') onCheck(false) }}>Revenir sur ma décision</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
