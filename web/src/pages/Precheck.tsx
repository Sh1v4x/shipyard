import { CheckCircle2Icon, CheckIcon, ChevronRightIcon, ClipboardCheckIcon, ExternalLinkIcon, GitBranchIcon, GitBranchPlusIcon, OctagonAlertIcon, PlusIcon, SendIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import type { PrecheckOutput, Project } from '../../../shared/types.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '../components/Markdown.tsx'
import { useApprovePrecheck } from '../data/mutations.ts'
import { useProjectOverview, useProjects, useRuns } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Badge, Pill, PromptMenu, RunPanel, SectionLabel, Spinner, useToast } from '../ui.tsx'
import { coversTicket, slugify, ticketIdsFrom } from '../../../shared/text.ts'
import { PlanBody } from './worktree/TicketAgent.tsx'

const VERDICT = {
  faisable: { label: 'Faisable', tone: 'green', icon: CheckCircle2Icon },
  réserves: { label: 'Faisable, avec des réserves', tone: 'amber', icon: TriangleAlertIcon },
  bloqué: { label: 'Bloqué en l’état', tone: 'red', icon: OctagonAlertIcon },
} as const

const CONFIDENCE = { forte: 'Confiance forte', moyenne: 'Confiance moyenne', faible: 'Confiance faible' } as const

/**
 * Pre-check d'un ticket, avant tout worktree : l'IA lit le ticket et le code, juge la faisabilité, estime la charge
 * et propose un plan. J'échange avec elle (réponses à ses questions, ajustements), puis j'approuve : la branche et le
 * worktree sont créés, et le travail démarre sur ce plan, avec ce que le pre-check a établi.
 */
export function PrecheckPage({ project, ticket }: { project: Project; ticket?: string }) {
  const check = useAction<PrecheckOutput>('precheck', { project: project.id, ref: ticket })
  const recent = useRuns({ project: project.id, kind: 'precheck' })
  const overview = useProjectOverview(project.id)
  const [source, setSource] = useState(ticket ?? '')
  const [extra, setExtra] = useState('')
  // Plusieurs tickets liés se font ensemble : le premier donne son nom à la branche, les autres s'y associent.
  const [typed, ...typedExtra] = ticketIdsFrom(source)
  const info = overview.data?.tickets.find((t) => t.id === ticket)
  const together = check.run?.input?.extraTickets ?? []
  // Un pre-check par ticket : les précédents restent ouvrables.
  const others = [...new Set((recent.data ?? []).map((r) => r.scope.ref).filter((r): r is string => !!r && r !== ticket))].slice(0, 8)

  const launch = async () => {
    if (!typed) return
    const id = await check.start({ ref: typed, ticketId: typed, extraTickets: typedExtra, extra: extra.trim() })
    if (id && typed !== ticket) go({ page: 'precheck', project: project.id, ticket: typed })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pre-check d’un ticket</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Donne un ticket (ou plusieurs tickets liés, à faire ensemble) : l’IA le lit, explore le code de {project.name}, vérifie que c’est faisable et estime la charge, en suivant les règles de dev et de review de l’équipe. Tu échanges avec elle, puis tu approuves : la branche et le worktree sont créés et elle se met au travail avec ce qu’elle a appris. Rien n’est créé avant ton accord.
          </p>
        </div>
        <PromptMenu items={[['precheck', 'Pre-check d’un ticket']]} />
      </div>

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="precheck-ticket" className="flex-wrap">Ticket Linear <span className="font-normal text-muted-foreground">(plusieurs si tu les fais ensemble, dans le même worktree et la même PR)</span></FieldLabel>
          <Input id="precheck-ticket" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://linear.app/equipe/issue/ENG-142/… ou ENG-142 · ENG-142 ENG-143 pour deux tickets liés"
            onKeyDown={(e) => { if (e.key === 'Enter' && typed && !check.busy) void launch() }} />
          {source.trim() && !typed && <p className="text-xs text-red-600 dark:text-red-400">Aucun identifiant de ticket dans ce texte (attendu : une URL Linear ou ENG-142).</p>}
          {typedExtra.length > 0 && <p className="text-xs text-muted-foreground">Un seul pre-check, un seul plan et un seul worktree pour <span className="font-mono">{[typed, ...typedExtra].join(' + ')}</span>. La branche porte <span className="font-mono">{typed}</span>.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="precheck-extra">Consigne <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
          <Textarea id="precheck-extra" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)}
            placeholder="Ex. : seulement la partie web · vérifie surtout que l’API expose déjà ce champ · on veut éviter une migration…" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!typed || check.busy} onClick={() => void launch()}>
            {check.starting ? <Spinner /> : <ClipboardCheckIcon />}{ticket && typed === ticket && check.id ? 'Relancer le pre-check' : 'Lancer le pre-check'}
          </Button>
          {ticket && <Button variant="outline" asChild><a href={href({ page: 'precheck', project: project.id })}><PlusIcon />Autre ticket</a></Button>}
          <span className="text-sm text-muted-foreground">Lecture seule : aucun fichier modifié, aucune branche créée.</span>
        </div>
        {others.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="text-xs text-muted-foreground">Pre-checks précédents</span>
            {others.map((id) => <Pill key={id} active={false} className="font-mono text-xs" onClick={() => go({ page: 'precheck', project: project.id, ticket: id })}>{id}</Pill>)}
          </div>
        )}
      </section>

      {ticket && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{ticket}</span>
            {info && <span className="min-w-0 text-sm">{info.title}</span>}
            {info && <a href={info.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">Linear<ExternalLinkIcon className="size-3.5" /></a>}
            {together.length > 0 && <Badge tone="blue">avec {together.join(', ')}</Badge>}
          </div>
          <RunPanel id={check.id} events={check.events} running={check.running} run={check.run} label="L’IA lit le ticket et explore le code" onStop={check.stop} action={check} />
          {check.result && !check.busy && check.id && (
            <PrecheckResult project={project} ticket={ticket} runId={check.id} out={check.result} note={check.run?.note ?? null} approved={check.run?.decision === 'approved'}
              worktree={overview.data?.worktrees.find((w) => coversTicket(w, ticket))?.id ?? null}
              onSend={(feedback) => check.start({ ticketId: ticket, feedback, previousRunId: check.id })} />
          )}
        </>
      )}
    </div>
  )
}

/** Résultat d'un pre-check, ou plan d'une modification rapide (ticket null) : faisabilité, charge, plan, échange, puis approbation. */
export function PrecheckResult({ project, ticket, runId, out, note, approved, worktree, onSend }: {
  project: Project
  /** null : modification rapide, sans ticket (la branche ne porte pas d'identifiant). */
  ticket: string | null
  runId: string
  out: PrecheckOutput
  /** Mon dernier message sur ce pre-check, auquel répond out.reply. */
  note: string | null
  approved: boolean
  /** Worktree déjà créé pour ce ticket dans ce projet. */
  worktree: string | null
  onSend: (feedback: string) => Promise<string | null>
}) {
  const projects = useProjects()
  const approve = useApprovePrecheck(project.id)
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [branchEdit, setBranchEdit] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[] | null>(null)
  const verdict = VERDICT[out.feasibility.verdict]
  // Dépôts où le ticket peut se développer : ce projet (toujours) et ceux de son groupe.
  const repos = [project, ...(projects.data ?? []).filter((p) => p.id !== project.id && !!project.group && p.group === project.group)]
  const proposed = repos.filter((r) => r.id === project.id || out.repos.some((n) => n.toLowerCase() === r.name.toLowerCase())).map((r) => r.id)
  const chosen = picked ?? proposed
  const branch = branchEdit ?? `${out.type}/${ticket ? `${ticket}-` : ''}${slugify(out.branch)}`
  const validBranch = /^[\w./-]+$/.test(branch)

  const send = async () => {
    if (!message.trim()) return
    if (await onSend(message.trim())) setMessage('')
  }

  const start = () =>
    approve.mutate({ run: runId, branch, projects: chosen }, {
      onSuccess: (r) => {
        toast('Worktree prêt : l’IA se met au travail.')
        go({ page: 'worktree', project: r.project, wt: r.worktree, tab: 'ticket' })
      },
      onError: (e) => toast(e.message, true),
    })

  return (
    <>
      {note && out.reply && (
        <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-sm">
          <p><span className="font-medium">Toi :</span> <span className="whitespace-pre-wrap">{note}</span></p>
          <p><span className="font-medium">Agent :</span> <span className="whitespace-pre-wrap">{out.reply}</span></p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-xs">
          <SectionLabel className="mb-0">Faisabilité</SectionLabel>
          <p className="flex items-center gap-2 font-semibold"><verdict.icon className="size-4" /><Badge tone={verdict.tone}>{verdict.label}</Badge></p>
          <p className="text-sm leading-relaxed">{out.feasibility.details}</p>
          {out.feasibility.blockers.length > 0 && (
            <ul className="m-0 list-disc pl-5 text-sm">{out.feasibility.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          )}
        </section>
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-xs">
          <SectionLabel className="mb-0">Charge estimée</SectionLabel>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight">{out.estimate.size}</span>
            <span className="font-medium">{out.estimate.effort}</span>
            <span className="text-sm text-muted-foreground">· {CONFIDENCE[out.estimate.confidence]}</span>
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{out.estimate.rationale}</p>
        </section>
      </div>

      {out.findings.trim() && (
        <details className="group rounded-xl border bg-card shadow-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
            Ce que l’IA a trouvé dans le code <span className="text-sm font-normal text-muted-foreground">(transmis au travail)</span>
          </summary>
          <div className="border-t px-5 py-4"><Markdown text={out.findings} className="text-sm leading-relaxed" /></div>
        </details>
      )}

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
        <PlanBody plan={out} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs">
        <FieldLabel htmlFor="precheck-message" className="flex-wrap">Échanger avec l’IA <span className="font-normal text-muted-foreground">(réponds à ses questions, pose les tiennes, demande un ajustement : elle reprend avec tout le contexte)</span></FieldLabel>
        <Textarea id="precheck-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
          placeholder="Ex. : question 1 : oui, sur le mobile aussi · pourquoi une migration ? · laisse l’export de côté, ça fera un autre ticket." />
        <div><Button variant="outline" disabled={!message.trim()} onClick={() => void send()} title="⌘ + Entrée"><SendIcon />Envoyer</Button></div>
      </section>

      {approved ? (
        <Alert variant="success">
          <CheckCircle2Icon />
          <AlertTitle>{ticket ? 'Pre-check approuvé' : 'Plan approuvé'}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-current">
            Le worktree est créé et le travail a été lancé sur ce plan.
            {worktree && <span><Button size="sm" variant="outline" asChild><a href={href({ page: 'worktree', project: project.id, wt: worktree, tab: 'ticket' })}><GitBranchIcon />Ouvrir le worktree</a></Button></span>}
          </AlertDescription>
        </Alert>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs">
          <div>
            <h2 className="font-semibold">Approuver et lancer le travail</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {worktree
                ? 'Un worktree existe déjà pour ce ticket : il est repris tel quel, et le travail y démarre sur ce plan.'
                : 'Shipyard crée la branche et le worktree, puis l’IA suit ce plan : captures avant, code, captures après, audit. Rien n’est commité avant ton accord.'}
            </p>
          </div>
          {!worktree && (
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="precheck-branch">Branche</FieldLabel>
              <Input id="precheck-branch" className="font-mono text-[13px]" value={branch} onChange={(e) => setBranchEdit(e.target.value)} />
              {!validBranch && <p className="text-xs text-red-600 dark:text-red-400">Nom de branche invalide : lettres, chiffres, tirets, points et barres obliques seulement.</p>}
            </div>
          )}
          {repos.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Dépôts <span className="font-normal text-muted-foreground">(un worktree dans chacun, liés entre eux)</span></span>
              <div className="flex flex-wrap gap-2">
                {repos.map((r) => (
                  <Pill key={r.id} active={chosen.includes(r.id)} disabled={r.id === project.id} className="font-mono text-xs"
                    onClick={() => setPicked(chosen.includes(r.id) ? chosen.filter((x) => x !== r.id) : [...chosen, r.id])}>{r.name}</Pill>
                ))}
              </div>
            </div>
          )}
          {out.feasibility.verdict === 'bloqué' && (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription>L’IA juge {ticket ? 'le ticket bloqué' : 'la demande bloquée'} en l’état. Réponds d’abord à ses questions, ou approuve en connaissance de cause.</AlertDescription>
            </Alert>
          )}
          {out.feasibility.verdict !== 'bloqué' && out.questions.length > 0 && (
            <p className="text-sm text-muted-foreground">Des questions restent ouvertes : sans réponse, l’IA retiendra son hypothèse et le dira dans son audit.</p>
          )}
          <div>
            <Button disabled={approve.isPending || !validBranch} onClick={start}>
              {approve.isPending ? <Spinner /> : worktree ? <CheckIcon /> : <GitBranchPlusIcon />}
              {worktree ? 'Approuver et lancer le travail' : 'Approuver : créer le worktree et lancer le travail'}
            </Button>
          </div>
        </section>
      )}
    </>
  )
}
