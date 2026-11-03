import { BrainIcon, ChevronRightIcon, CircleHelpIcon, ClipboardCopyIcon, FlaskConicalIcon, PencilIcon, PlayIcon, RotateCcwIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSaveTestMemory } from '../../data/mutations.ts'
import { useTestMemory } from '../../data/queries.ts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MultiTestOutput, TestOutput } from '../../../../shared/types.ts'
import { useAction } from '../../data/runs.ts'
import { go } from '../../router.ts'
import { Badge, Empty, PromptMenu, RunPanel, Spinner, ago, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'
import { TestVideos } from '../../components/TestVideos.tsx'
import { ManualTest } from './ManualTest.tsx'

const STATUS = { pass: ['Réussi', 'green'], fail: ['Échec', 'red'], warn: ['À vérifier', 'amber'] } as const

export function TestsTab({ project, detail, wtId }: TabProps) {
  const test = useAction<TestOutput | MultiTestOutput>('test', { project: project.id, worktree: wtId })
  const fixer = useAction('ticket', { project: project.id, worktree: wtId })
  const toast = useToast()
  const mine = detail.worktree.kind !== 'review'
  const r = test.result
  const [consigne, setConsigne] = useState('')
  // Worktrees liés : on peut n'en retester qu'une partie (correctif d'un seul côté) ; les autres gardent leur dernier résultat.
  const repos = [{ id: wtId, name: project.name }, ...(detail.linked ?? []).map((l) => ({ id: l.id, name: l.name }))]
  const [skipped, setSkipped] = useState<string[]>([])
  const testOnly = repos.filter((x) => !skipped.includes(x.id)).map((x) => x.id)

  // Test de worktrees liés : le correctif part de ce worktree, l'agent travaille aussi dans les dépôts liés.
  const askFix = async (name: string, detailText: string, decided?: string, repo?: string) => {
    const where = repo && repo !== project.name ? ` Repository: ${repo} (linked worktree).` : ''
    const extra = decided
      ? `The PR test raised a point that the user has settled.${where} Scenario: "${name}". Finding: ${detailText}. The user's decision: ${decided}. Apply this decision with a minimal fix, then rerun the relevant test.`
      : `Fix this failure found by the PR test.${where} Scenario: "${name}". Finding: ${detailText}. Minimal fix, then rerun the relevant test.`
    const id = await fixer.start({ extra })
    if (id) {
      toast('Correctif demandé : suivi dans l’onglet Ticket')
      go({ page: 'worktree', project: project.id, wt: wtId, tab: 'ticket' })
    }
  }

  const retest = (name: string, note?: string) =>
    void test.start({ extra: [`Retest only the scenario "${name}"; the others keep their result.`, note, consigne].filter(Boolean).join(' ') })

  return (
    <section className="flex flex-col gap-4" aria-label="Tests">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div className="flex min-w-0 flex-[1_1_320px] gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FlaskConicalIcon className="size-4" /></div>
          <div className="min-w-0">
            <p className="font-semibold">Tester la PR avec l’IA</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Lance la suite existante, puis rejoue les scénarios du ticket dans le navigateur ou sur l’émulateur Android. Le test est filmé, pour pouvoir le transmettre. Ne modifie pas le code.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PromptMenu items={[['test', 'Tester une PR']]} />
          <Button size="sm" disabled={test.busy || !testOnly.length} onClick={() => test.start({ extra: consigne, ...(repos.length > 1 && { testOnly }) })}>
            {test.busy ? <Spinner /> : <PlayIcon />}{r ? 'Relancer le test' : 'Lancer le test'}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        {repos.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-2">
            <span className="text-sm font-medium">Dépôts à tester</span>
            {repos.map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!skipped.includes(x.id)} onCheckedChange={(v) => setSkipped((s) => (v ? s.filter((i) => i !== x.id) : [...s, x.id]))} />
                <span className="font-mono">{x.name}</span>
              </label>
            ))}
            {skipped.length > 0 && <span className="text-xs text-muted-foreground">Les autres gardent leur dernier résultat.</span>}
          </div>
        )}
        <FieldLabel htmlFor={`test-consigne-${wtId}`}>Consignes pour ce test <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
        <Textarea id={`test-consigne-${wtId}`} rows={2} value={consigne} onChange={(e) => setConsigne(e.target.value)}
          placeholder="Ex. : connecte-toi avec le compte démo · teste surtout le cas du lien invalide · l’API tourne déjà sur le port 3001." />
        <TestMemory project={project.id} title="Mémoire du projet" hint="toutes les branches" help="Ce qui vaut pour n’importe quelle branche du projet : lancer l’app, l’environnement, la base, les ports, la connexion, les outils du poste." placeholder="- Lancer l’API avec `bun run dev` dans apps-v2/api (port 3001)…" />
        <TestMemory project={project.id} wtId={wtId} title="Mémoire de cette branche" hint="temporaire" help="Ce qui ne vaut que pour cette PR : données propres à sa fonctionnalité, écrans touchés, pièges de son code. Lue seulement par les tests de ce worktree, retirée avec lui." placeholder="- Pour cette fonctionnalité, créer la donnée de test avec…" />
      </div>
      <RunPanel id={test.id} events={test.events} running={test.running} run={test.run} label="Installation, suite de tests, puis scénarios" defaultOpen onStop={test.stop} action={test} />
      {!test.id && !test.loading && <Empty title="Aucun test lancé sur cette PR pour l’instant." />}
      {r && 'parts' in r ? (
        // Worktrees liés : un dépôt par section dépliable, avec son rapport et sa vidéo.
        <div className="flex flex-col gap-3">
          {r.parts.map((p, i) => (
            <details key={p.worktree} open={i === 0} className="group overflow-hidden rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3 [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-mono text-sm font-semibold">{p.projectName}</span>
                <Badge tone="gray">{p.platform === 'android' ? 'Android' : 'Web'}</Badge>
                {p.carriedAt && <span className="text-xs text-muted-foreground">non retesté · résultat du test {ago(p.carriedAt)}</span>}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {p.error ? <Badge tone="red">{p.error}</Badge> : p.output && <Counts r={p.output} />}
                </span>
              </summary>
              <div className="flex flex-col gap-4 border-t p-4">
                {p.runId && <TestVideos runId={p.runId} endedAt={test.run?.endedAt ?? null} />}
                {p.output && <TestReport r={p.output} runId={p.runId ?? test.id} onFix={mine ? (n, d, decided) => askFix(n, d, decided, p.projectName) : undefined} onRetest={p.worktree === wtId ? retest : undefined} />}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <>
          {test.id && test.run && <TestVideos runId={test.id} endedAt={test.run.endedAt} />}
          {r && <TestReport r={r} runId={test.id} onFix={mine ? askFix : undefined} onRetest={retest} />}
        </>
      )}
      <ManualTest project={project} wtId={wtId} consigne={consigne} mine={mine} />
    </section>
  )
}

/** Réussis, à vérifier, en échec : le résumé d'un dépôt dans la liste dépliable. */
function Counts({ r }: { r: TestOutput }) {
  const n = (st: 'pass' | 'warn' | 'fail') => r.scenarios.filter((s) => s.status === st).length
  return (
    <>
      {n('pass') > 0 && <Badge tone="green">{n('pass')} réussi(s)</Badge>}
      {n('warn') > 0 && <Badge tone="amber">{n('warn')} à vérifier</Badge>}
      {n('fail') + r.suite.failed > 0 && <Badge tone="red">{n('fail') + r.suite.failed} échec(s)</Badge>}
    </>
  )
}

type Scenario = TestOutput['scenarios'][number]

/**
 * Rapport d'un test : d'abord les points à trancher (le test ne peut pas décider seul), puis la suite et les scénarios.
 * onFix : demander un correctif (sinon, copier pour la review) ; onRetest : rejouer un seul scénario.
 */
function TestReport({ r, runId, onFix, onRetest }: { r: TestOutput; runId: string | null; onFix?: (name: string, detail: string, decided?: string) => void; onRetest?: (name: string, note?: string) => void }) {
  const toast = useToast()
  const toDecide = r.scenarios.filter((s) => s.status === 'warn')
  const others = r.scenarios.filter((s) => s.status !== 'warn')
  return (
    <div className="flex flex-col gap-4">
      {toDecide.length > 0 && (
        <section aria-label="À trancher" className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5">
          <div className="flex items-center gap-2 border-b border-amber-500/30 px-5 py-3">
            <CircleHelpIcon className="size-4 text-amber-600 dark:text-amber-400" />
            <span className="font-semibold">{toDecide.length > 1 ? `${toDecide.length} points à trancher` : '1 point à trancher'}</span>
            <span className="text-sm text-muted-foreground">Le test ne peut pas décider seul : choisis une réponse, l’IA applique le correctif si besoin.</span>
          </div>
          {toDecide.map((s) => <DecisionCard key={s.name} s={s} runId={runId} onFix={onFix} onRetest={onRetest} />)}
        </section>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-5 py-3 font-mono text-xs">
          <span className="break-all">{r.suite.command}</span>
          <span><span className="text-emerald-600 dark:text-emerald-400">{r.suite.passed} réussis</span> · <span className={cn(r.suite.failed > 0 && 'text-red-600 dark:text-red-400')}>{r.suite.failed} échecs</span></span>
        </div>
        <p className="px-5 py-3 text-sm">{r.suite.summary}</p>
        {r.setup?.trim() && <p className="border-t px-5 py-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Préparation : </span>{r.setup}</p>}
        {others.map((s) => (
          <div key={s.name} className="border-t px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{s.name}</span>
              <Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.detail}</p>
            {s.status !== 'pass' && (
              onFix
                ? <Button variant="outline" size="sm" className="mt-2.5" onClick={() => onFix(s.name, s.detail)}><WrenchIcon />Demander un correctif à l’IA</Button>
                : <Button variant="outline" size="sm" className="mt-2.5" onClick={() => navigator.clipboard.writeText(`Test « ${s.name} » : ${s.detail}`).then(() => toast('Copié : à coller dans un commentaire de review'))}><ClipboardCopyIcon />Copier</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Décision prise sur un point à trancher, gardée dans ce navigateur pour ce test. */
const decisionKey = (runId: string | null, name: string) => `devpanel:test-decision:${runId ?? 'none'}:${name}`
function readDecision(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Un point à trancher : la question (formulée par le test, sinon son constat), une réponse par bouton,
 * ou une réponse libre. Une réponse qui demande un changement lance le correctif ; « garder » le marque comme tranché.
 */
function DecisionCard({ s, runId, onFix, onRetest }: { s: Scenario; runId: string | null; onFix?: (name: string, detail: string, decided?: string) => void; onRetest?: (name: string, note?: string) => void }) {
  const toast = useToast()
  const key = decisionKey(runId, s.name)
  const [decided, setDecided] = useState(() => readDecision(key))
  const [free, setFree] = useState<string | null>(null)
  const options = s.decision?.options ?? [{ label: 'C’est bon tel quel', fix: null }]
  const save = (label: string) => {
    setDecided(label)
    try { localStorage.setItem(key, label) } catch { /* stockage indisponible */ }
  }
  const choose = (o: { label: string; fix: string | null }) => {
    if (o.fix && !onFix) {
      void navigator.clipboard.writeText(`Test « ${s.name} » : ${s.decision?.question ?? s.detail}\nRéponse : ${o.label} — ${o.fix}`).then(() => toast('Copié : à coller dans un commentaire de review'))
      return save(o.label)
    }
    if (o.fix) onFix!(s.name, s.detail, `${o.label}. To do: ${o.fix}`)
    save(o.label)
  }
  return (
    <div className="flex flex-col gap-3 border-t border-amber-500/20 px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{s.name}</span>
        {decided && <Badge tone="green">Tranché : {decided}</Badge>}
      </div>
      {s.decision && <p className="text-[15px] font-semibold leading-snug">{s.decision.question}</p>}
      <p className={cn('text-sm', s.decision ? 'text-muted-foreground' : 'text-foreground')}>{s.detail}</p>
      {!decided && (
        <div className="flex flex-col gap-2">
          {s.decision && <span className="text-xs font-medium text-muted-foreground">Ta réponse</span>}
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <button key={o.label} type="button" onClick={() => choose(o)}
                className="flex flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-ring hover:bg-accent">
                <span className="font-medium">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.fix ? `Correctif : ${o.fix}` : 'Garder la PR telle quelle'}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {onFix && <Button size="sm" variant="ghost" onClick={() => setFree(free === null ? '' : null)}><PencilIcon />Autre réponse…</Button>}
            {onRetest && <Button size="sm" variant="ghost" onClick={() => onRetest(s.name)}><RotateCcwIcon />Retester ce point</Button>}
          </div>
          {free !== null && onFix && (
            <div className="flex flex-col gap-2">
              <Textarea aria-label={`Ta réponse à « ${s.name} »`} rows={2} value={free} onChange={(e) => setFree(e.target.value)} placeholder="Ex. : garde le choix au niveau transaction, mais affiche le bailleur dans le récapitulatif du Modelo 115." />
              <div><Button size="sm" disabled={!free.trim()} onClick={() => { onFix(s.name, s.detail, free.trim()); save(free.trim()) }}><WrenchIcon />Appliquer ma réponse</Button></div>
            </div>
          )}
        </div>
      )}
      {decided && <Button variant="link" size="sm" className="h-7 self-start px-0" onClick={() => { setDecided(null); try { localStorage.removeItem(key) } catch { /* stockage indisponible */ } }}>Changer de réponse</Button>}
    </div>
  )
}

/** Une mémoire des tests (projet ou branche) : lue au début de chaque test, complétée par l'agent, modifiable à la main. */
function TestMemory({ project, wtId, title, hint, help, placeholder }: { project: string; wtId?: string; title: string; hint: string; help: string; placeholder: string }) {
  const memory = useTestMemory(project, wtId)
  const save = useSaveTestMemory(project, wtId)
  const toast = useToast()
  const [text, setText] = useState('')
  useEffect(() => setText(memory.data?.text ?? ''), [memory.data?.text])
  const lessons = (memory.data?.text ?? '').split('\n').filter((l) => l.trim().startsWith('- ')).length
  return (
    <details className="group rounded-lg border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        <BrainIcon className="size-3.5 text-muted-foreground" />
        {title} <span className="text-muted-foreground">({hint}) · {lessons ? `${lessons} leçon(s)` : 'vide'}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t px-3 py-3">
        <p className="text-xs text-muted-foreground">{help} Lue au début de chaque test et complétée à la fin. Corrige ou retire ce qui est faux.</p>
        <Textarea aria-label={title} rows={6} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
        <div>
          <Button size="sm" variant="outline" disabled={save.isPending || text === (memory.data?.text ?? '')} onClick={() => save.mutate(text, { onSuccess: () => toast(`${title} enregistrée`), onError: (e) => toast(e.message, true) })}>
            {save.isPending && <Spinner />}Enregistrer
          </Button>
        </div>
      </div>
    </details>
  )
}
