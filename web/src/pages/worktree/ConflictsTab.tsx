import { GitPullRequestArrowIcon, PlayIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import type { BaseSyncOutput, DirtyTriageOutput, MergeFinishOutput } from '../../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useApplyDirty, useMergeAction } from '../../data/mutations.ts'
import { useAction, useResolveConflicts } from '../../data/runs.ts'
import { Badge, Pill, PromptMenu, RunPanel, Spinner, SuccessBox, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

const RISK = { aucun: 'green', faible: 'gray', 'à vérifier': 'amber' } as const
const CHECK = { pass: 'green', fail: 'red', skip: 'gray' } as const

export function ConflictsTab({ project, detail, wtId }: TabProps) {
  const pr = detail.pr!
  const merge = detail.merge
  const base = merge?.base ?? pr.base
  const resolve = useResolveConflicts(project.id, wtId)
  // « Récupérer <base> » : fusion, conflits résolus par l'IA, SDK, commit et push, en une tâche suivie.
  const sync = useAction<BaseSyncOutput>('base-sync', { project: project.id, worktree: wtId, ref: 'base-sync' })
  const canSync = (!merge || base === pr.base) && (detail.behindBase > 0 || !!merge || sync.busy)
  const showSync = sync.run && (sync.running || sync.run.status !== 'success' || Date.now() - Date.parse(sync.run.endedAt ?? sync.run.startedAt) < 600_000)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  // Valider et pousser : tâche suivie côté serveur, elle continue si je change de page et se retrouve au retour.
  const finish = useAction<MergeFinishOutput>('merge-finish', { project: project.id, worktree: wtId, ref: 'merge' })
  const finishedAfter = finish.run && (!resolve.run || finish.run.startedAt > resolve.run.startedAt)
  const done = finishedAfter && finish.result ? finish.result.url : null
  const mergeAction = useMergeAction(project.id, wtId)
  const busy = mergeAction.isPending ? 'abort' : finish.busy ? 'finish' : null
  const toast = useToast()
  const out = merge ? resolve.result : null


  const reply = async () => {
    const lines = (out?.questions ?? []).filter((q) => answers[q.id]?.trim()).map((q) => `- ${q.file} · ${q.question} → ${answers[q.id].trim()}`)
    const feedback = [lines.join('\n'), notes.trim() ? `Other instructions:\n${notes.trim()}` : ''].filter(Boolean).join('\n\n')
    if (!feedback) return toast('Réponds à au moins une question', true)
    setAnswers({})
    setNotes('')
    await resolve.start({ feedback, previousRunId: resolve.id })
  }

  const call = async (what: 'abort' | 'finish') => {
    if (what === 'finish') {
      await finish.start()
      return
    }
    if (!confirm(`Annuler la fusion de ${base} ? Les résolutions faites dans les fichiers en conflit seront perdues.`)) return
    mergeAction.mutate('abort', { onSuccess: () => toast('Fusion annulée'), onError: (e) => toast(e.message, true) })
  }

  return (
    <section className="flex flex-col gap-4" aria-label={`À jour avec ${pr.base}`}>
      <Card className="flex-row flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 basis-80">
          {merge ? (
            <>
              <p className="font-semibold">Fusion de <span className="font-mono text-[13px]">origin/{base}</span> en cours</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {plural(merge.conflicted.length, 'fichier en conflit', 'fichiers en conflit')} · {merge.remaining.length ? `${merge.remaining.length} avec des conflits encore en place` : 'plus aucun marqueur de conflit'}
              </p>
            </>
          ) : pr.conflicts ? (
            <>
              <p className="font-semibold">La PR est en conflit avec <span className="font-mono text-[13px]">{base}</span></p>
              <p className="mt-1 text-sm text-muted-foreground">
                L’IA fusionne <span className="font-mono text-xs">origin/{base}</span> dans la branche sans commiter, analyse les deux côtés et résout ce qui est sûr. En cas de doute, elle laisse le conflit en place et te pose la question. Rien n’est commité ni poussé avant « Valider et pousser ».
              </p>
            </>
          ) : detail.behindBase > 0 ? (
            <>
              <p className="font-semibold"><span className="font-mono text-[13px]">{base}</span> a {plural(detail.behindBase, 'commit', 'commits')} d’avance sur la branche</p>
              <p className="mt-1 text-sm text-muted-foreground">
                « Récupérer {base} » fusionne <span className="font-mono text-xs">origin/{base}</span>, résout les conflits avec l’IA, met les SDK à jour, commite (hooks compris) et pousse.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">La branche est à jour avec <span className="font-mono text-[13px]">{base}</span> et sans conflit.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PromptMenu items={[['conflict-resolve', 'Résoudre les conflits']]} />
          {canSync && (
            <Button size="sm" variant={pr.conflicts || merge ? 'outline' : 'default'} disabled={sync.busy || busy != null} onClick={() => void sync.start()}>
              {sync.busy ? <Spinner /> : <GitPullRequestArrowIcon />}{merge ? `Reprendre la récupération de ${pr.base}` : `Récupérer ${pr.base}`}{!merge && detail.behindBase > 0 && ` · ${plural(detail.behindBase, 'commit', 'commits')}`}
            </Button>
          )}
          {/* Fusion déjà faite en local mais pas poussée (push refusé, interrompu…) : GitHub voit encore le conflit. */}
          {!merge && pr.conflicts && (
            <Button size="sm" variant="outline" disabled={finish.busy || busy != null} onClick={() => finish.start()} title="Pousse les commits locaux ; si la branche distante a avancé, ses commits sont d’abord intégrés">
              {finish.busy && <Spinner />}Pousser la branche
            </Button>
          )}
          {(merge || pr.conflicts) && (
            <Button size="sm" disabled={resolve.busy || busy != null || (!merge && detail.dirtyFiles.length > 0)} onClick={() => resolve.start()}>
              {resolve.busy ? <Spinner /> : <PlayIcon />}{out ? 'Relancer l’analyse' : 'Résoudre avec l’IA'}
            </Button>
          )}
        </div>
      </Card>

      {showSync && <RunPanel id={sync.id} events={sync.events} running={sync.running} run={sync.run} label={`Récupération de ${pr.base} : fusion, conflits, commit et push`} onStop={sync.stop} action={sync} />}

      {/* Fichiers non commités : la fusion ne peut pas démarrer. L'IA dit pour chacun s'il faut le garder ou l'annuler. */}
      {!merge && pr.conflicts && detail.dirtyFiles.length > 0 && <DirtyTriage project={project.id} wtId={wtId} files={detail.dirtyFiles} onReady={() => resolve.start()} />}

      <RunPanel id={resolve.id} events={resolve.events} running={resolve.running} run={resolve.run} label="Résolution des conflits" onStop={resolve.stop} action={resolve} />

      {finishedAfter && finish.id && !done && <RunPanel id={finish.id} events={finish.events} running={finish.running} run={finish.run} label="Commit de fusion et push" onStop={finish.stop} defaultOpen />}
      {/* Commit refusé par le hook (typecheck, lint…) : un agent lit la sortie, corrige, puis Shipyard retente le commit et pousse. */}
      {finishedAfter && finish.failed && merge && !finish.busy && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => finish.start({ autofix: true })}><SparklesIcon />Corriger avec l’IA et pousser</Button>
          <PromptMenu items={[['merge-fix', 'Corriger une fusion refusée']]} />
          <span className="text-xs text-muted-foreground">L’IA lit la sortie du hook, corrige ce qui bloque (conflit de sens entre les deux côtés, fichier généré périmé, lint), puis le commit est retenté.</span>
        </div>
      )}
      {/* Commit fait mais push interrompu : la fusion n'est plus « en cours », il ne reste qu'à pousser. */}
      {finishedAfter && finish.failed && !merge && (
        <div><Button size="sm" disabled={finish.busy} onClick={() => finish.start()}>{finish.busy && <Spinner />}Relancer le push</Button></div>
      )}
      {done !== null && (
        <SuccessBox>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">Fusion commitée et poussée.</span>
            {done && <a href={done} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">Voir le commit ↗</a>}
          </span>
        </SuccessBox>
      )}

      {out && (
        <>
          <p className="text-sm leading-relaxed">{out.summary}</p>

          {out.questions.length > 0 && (
            <Card className="gap-4 border-amber-500/40">
              <CardHeader>
                <CardTitle>Questions</CardTitle>
                <CardDescription>Ces conflits sont restés en place dans les fichiers : l’IA attend ta décision.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {out.questions.map((q) => (
                  <div key={q.id} className="flex flex-col gap-2 border-t pt-3">
                    <span className="font-mono text-xs break-all text-muted-foreground">{q.file}</span>
                    <span className="text-sm font-medium whitespace-pre-wrap">{q.question}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((o) => (
                        <Pill key={o} active={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</Pill>
                      ))}
                    </div>
                    <Input aria-label={`Réponse libre : ${q.question}`} placeholder="Ou réponds librement…" value={q.options.includes(answers[q.id]) ? '' : answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                  </div>
                ))}
                <div className="flex flex-col gap-2">
                  <FieldLabel htmlFor="conflict-notes">Autres consignes</FieldLabel>
                  <Textarea id="conflict-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div>
                  <Button size="sm" disabled={resolve.busy} onClick={reply}>{resolve.busy && <Spinner />}Répondre et continuer</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="gap-3">
            <CardHeader><CardTitle>Fichiers</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {out.files.map((f) => (
                <div key={f.file} className="flex flex-col gap-1.5 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs break-all">{f.file}</span>
                    <Badge tone={f.status === 'résolu' ? 'green' : 'amber'}>{f.status}</Badge>
                    <Badge tone={RISK[f.risk]}>Risque : {f.risk}</Badge>
                    {merge?.remaining.includes(f.file) && <Badge tone="red">marqueurs présents</Badge>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{f.resolution}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {out.checks.length > 0 && (
            <Card className="gap-3">
              <CardHeader><CardTitle>Vérifications</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                {out.checks.map((c) => (
                  <div key={c.name} className="flex items-start gap-2 text-sm">
                    <Badge tone={CHECK[c.status]}>{c.status}</Badge>
                    <span><span className="font-medium">{c.name}</span> <span className="text-muted-foreground">{c.detail}</span></span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {merge && (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span className="min-w-0 flex-1 basis-72 text-sm text-muted-foreground">
            {merge.remaining.length
              ? `Encore en conflit : ${merge.remaining.join(', ')}`
              : 'Plus aucun conflit : relis les fichiers dans ton éditeur si besoin, puis valide. Le commit de fusion est poussé sur la branche.'}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy != null || resolve.running} onClick={() => call('abort')}>{busy === 'abort' && <Spinner />}Annuler la fusion</Button>
            <Button size="sm" disabled={busy != null || resolve.running || merge.remaining.length > 0} onClick={() => call('finish')}>{busy === 'finish' && <Spinner />}Valider et pousser</Button>
          </span>
        </Card>
      )}
    </section>
  )
}

type Choice = 'commit' | 'discard'

/**
 * Avant de fusionner, avec des fichiers non commités : l'IA les lit et recommande pour chacun de le commiter ou de l'annuler.
 * Je confirme fichier par fichier, puis Shipyard applique et lance la résolution des conflits.
 */
function DirtyTriage({ project, wtId, files, onReady }: { project: string; wtId: string; files: { status: string; path: string }[]; onReady: () => void }) {
  const triage = useAction<DirtyTriageOutput>('dirty-triage', { project, worktree: wtId, ref: 'dirty' })
  const apply = useApplyDirty(project, wtId)
  const toast = useToast()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [title, setTitle] = useState<string | null>(null)
  const out = triage.result
  // Recommandations valables seulement pour les fichiers encore non commités.
  const reco = new Map((out?.files ?? []).map((f) => [f.path, f]))
  const choiceOf = (path: string): Choice | undefined => choices[path] ?? (reco.get(path)?.verdict === 'ask' ? undefined : (reco.get(path)?.verdict as Choice | undefined))
  const undecided = files.filter((f) => !choiceOf(f.path))
  const toCommit = files.filter((f) => choiceOf(f.path) === 'commit').map((f) => f.path)
  const toDiscard = files.filter((f) => choiceOf(f.path) === 'discard').map((f) => f.path)
  const commitTitle = title ?? out?.commitTitle ?? ''

  const run = () => {
    if (toDiscard.length && !confirm(`${toDiscard.length} fichier(s) seront définitivement annulés :\n${toDiscard.join('\n')}`)) return
    apply.mutate({ commit: toCommit, discard: toDiscard, title: toCommit.length ? commitTitle : null }, {
      onSuccess: (r) => {
        toast(r.remaining ? `Il reste ${r.remaining} fichier(s) non commité(s)` : 'Worktree propre : résolution des conflits lancée')
        if (!r.remaining) onReady()
      },
      onError: (e) => toast(e.message, true),
    })
  }

  return (
    <Card className="gap-4 border-amber-500/40">
      <CardHeader>
        <CardTitle className="text-base">{plural(files.length, 'fichier non commité', 'fichiers non commités')} bloque(nt) la fusion</CardTitle>
        <CardDescription>Chaque fichier doit être commité ou annulé avant de fusionner. L’IA lit les modifications et dit pour chacun s’il est utile.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={out ? 'outline' : 'default'} disabled={triage.busy} onClick={() => { setChoices({}); setTitle(null); void triage.start() }}>
            {triage.busy ? <Spinner /> : <SparklesIcon />}{out ? 'Réanalyser' : 'Analyser avec l’IA'}
          </Button>
          <PromptMenu items={[['dirty-triage', 'Trier les fichiers non commités']]} />
        </div>
        <RunPanel id={triage.id} events={triage.events} running={triage.running} run={triage.run} label="L’IA lit les fichiers non commités" onStop={triage.stop} />
        {out && <p className="text-sm">{out.summary}</p>}
        <ul className="flex flex-col divide-y rounded-lg border">
          {files.map((f) => {
            const r = reco.get(f.path)
            const c = choiceOf(f.path)
            return (
              <li key={f.path} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs break-all"><span className="text-muted-foreground">{f.status}</span> {f.path}</p>
                  {r && <p className="mt-0.5 text-xs text-muted-foreground">{r.verdict === 'ask' && <Badge tone="amber" className="mr-1">À trancher</Badge>}{r.reason}</p>}
                </div>
                <div className="flex gap-1.5">
                  <Pill active={c === 'commit'} onClick={() => setChoices({ ...choices, [f.path]: 'commit' })}>Commiter</Pill>
                  <Pill active={c === 'discard'} onClick={() => setChoices({ ...choices, [f.path]: 'discard' })}>Annuler</Pill>
                </div>
              </li>
            )
          })}
        </ul>
        {toCommit.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`dirty-title-${wtId}`}>Titre du commit</FieldLabel>
            <Input id={`dirty-title-${wtId}`} className="font-mono text-xs" value={commitTitle} onChange={(e) => setTitle(e.target.value)} placeholder="fix(web): …" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={apply.isPending || undecided.length > 0 || (toCommit.length > 0 && !commitTitle.trim())} onClick={run}>
            {apply.isPending && <Spinner />}Appliquer et résoudre les conflits
          </Button>
          <span className="text-xs text-muted-foreground">
            {undecided.length ? `${plural(undecided.length, 'fichier', 'fichiers')} sans décision.` : [toCommit.length && `${toCommit.length} commité(s)`, toDiscard.length && `${toDiscard.length} annulé(s)`].filter(Boolean).join(' · ')}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
