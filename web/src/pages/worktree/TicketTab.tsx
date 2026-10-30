import { ArrowUpRightIcon, CheckCircle2Icon, LaptopIcon, PlayIcon, TicketPlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TicketStatus } from '../../components/TicketStatus.tsx'
import type { LocalTicket, PrPrepareOutput, Project } from '../../../../shared/types.ts'
import { useCreatePr, useDismissInbox, usePromoteLocalTicket, useRemoveLocalTicket, useRemoveWorktree } from '../../data/mutations.ts'
import { useBranches } from '../../data/queries.ts'
import { useAction } from '../../data/runs.ts'
import { Badge, ErrorBox, Pill, PromptMenu, RunPanel, SectionLabel, Spinner, plural, useToast } from '../../ui.tsx'
import { go } from '../../router.ts'
import type { TabProps } from '../Worktree.tsx'
import { CommitCard } from './CommitCard.tsx'
import { TicketAgent } from './TicketAgent.tsx'

export function TicketTab({ project, detail, wtId }: TabProps) {
  const { worktree: w, ticket, pr } = detail
  // Ticket local (proposition gardée sur le Mac) : tient lieu de ticket tant qu'il n'y en a pas sur Linear.
  const local = !ticket ? w.localTicket : null
  const ticketDone = ticket?.statusType === 'completed' || ticket?.statusType === 'canceled'

  return (
    <section className="flex flex-col gap-5" aria-label="Ticket">
      {ticketDone && !w.merged && <DoneNotice project={project} detail={detail} wtId={wtId} />}
      <div className="flex flex-wrap items-start gap-5">
        {ticket ? (
          <article className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
              <TicketStatus project={project} ticket={ticket} />
              <span className="text-xs text-muted-foreground">{ticket.priority}</span>
            </div>
            <h2 className="text-lg leading-snug font-semibold">{ticket.title}</h2>
            <div>
              <SectionLabel>Description</SectionLabel>
              <p className="text-sm leading-relaxed whitespace-pre-line">{ticket.description || <span className="text-muted-foreground">Pas de description.</span>}</p>
            </div>
            <Button variant="link" size="sm" className="h-auto self-start px-0" asChild>
              <a href={ticket.url} target="_blank" rel="noreferrer">Ouvrir dans Linear<ArrowUpRightIcon /></a>
            </Button>
          </article>
        ) : local ? (
          <LocalTicketCard project={project} wtId={wtId} local={local} />
        ) : (
          <article className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5 rounded-xl border border-dashed p-5">
            <h2 className="font-semibold">{w.ticketId ? `Ticket ${w.ticketId} introuvable` : 'Pas de ticket Linear'}</h2>
            <p className="text-sm text-muted-foreground">{w.ticketId ? 'Vérifie que LINEAR_API_KEY est configurée.' : 'Ce worktree a été créé depuis une branche. Décris la modification à faire : l’IA part des commits et du diff de la branche.'}</p>
          </article>
        )}

        {ticket || local || w.kind === 'review' ? <TicketAgent {...{ project, detail, wtId }} /> : <TicketAgent {...{ project, detail, wtId }} mode="change" />}
      </div>

      {/* Avec un ticket : une modification hors ticket reste possible, avec son propre plan. */}
      {(ticket || local) && w.kind !== 'review' && <div className="flex"><TicketAgent {...{ project, detail, wtId }} mode="change" /></div>}

      {w.kind !== 'review' && <CommitCard {...{ project, detail, wtId }} />}
      {!pr && w.kind !== 'review' && !ticketDone && !w.merged && <CreatePrCard {...{ project, detail, wtId }} />}
    </section>
  )
}

function DoneNotice({ project, detail, wtId }: TabProps) {
  const remove = useRemoveWorktree(project.id)
  const toast = useToast()
  const busy = remove.isPending
  const dirty = detail.dirtyFiles.length
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">Ticket {detail.ticket?.status.toLowerCase()} dans Linear</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dirty ? `Il reste ${plural(dirty, 'fichier non commité', 'fichiers non commités')} : commite-les ou annule-les avant de supprimer le worktree.` : 'Ce worktree n’est plus utile. La branche est conservée.'}
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" disabled={busy || dirty > 0} onClick={() => {
        if (!confirm(`Supprimer le worktree ${detail.worktree.path} ?`)) return
        remove.mutate(wtId, {
          onSuccess: () => {
            toast('Worktree supprimé')
            go({ page: 'overview', project: project.id })
          },
          onError: (e) => toast(e.message, true),
        })
      }}>{busy ? <Spinner /> : <Trash2Icon />}Supprimer le worktree</Button>
    </div>
  )
}

function CreatePrCard({ project, detail, wtId }: TabProps) {
  const prep = useAction<PrPrepareOutput>('pr-prepare', { project: project.id, worktree: wtId })
  const branches = useBranches(project.id)
  const createPr = useCreatePr(project.id, wtId)
  const dismiss = useDismissInbox()
  const toast = useToast()
  const [draft, setDraft] = useState<PrPrepareOutput | null>(null)
  const [base, setBase] = useState(project.baseBranch)
  const busy = createPr.isPending
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (prep.result) setDraft(structuredClone(prep.result))
  }, [prep.result])

  const bases = (branches.data ?? []).filter((b) => ['main', 'master', 'develop', 'dev', 'staging'].includes(b) || b.startsWith('release/'))
  const { commitsAhead, dirtyFiles } = detail
  const nothing = !commitsAhead.length

  const submit = () => {
    if (!draft) return
    setError(null)
    createPr.mutate({ ...draft, commits: [], base }, {
      onSuccess: (r) => {
        toast(`PR créée${r.label ? ` avec le label « ${r.label} »` : ''} : ${r.url}${r.videoRunId ? '. La vidéo du test est en cours d’ajout à sa description.' : ''}`)
        if (prep.id) dismiss.mutate(prep.id)
      },
      onError: setError,
    })
  }

  return (
    <article className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Créer la PR</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{plural(commitsAhead.length, 'commit', 'commits')} sur la branche · {plural(dirtyFiles.length, 'fichier non commité', 'fichiers non commités')}</p>
        </div>
        <PromptMenu items={[['pr-prepare', 'Création de PR']]} />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_260px]">
          <SectionLabel>Commits sur la branche</SectionLabel>
          {commitsAhead.length ? commitsAhead.map((c) => <div key={c} className="py-0.5 font-mono text-xs">{c}</div>) : <p className="text-sm text-muted-foreground">Aucun commit pour l’instant.</p>}
        </div>
        <div className="min-w-0 flex-[1_1_260px]">
          <SectionLabel>Fichiers non commités</SectionLabel>
          {dirtyFiles.length ? dirtyFiles.map((f) => <div key={f.path} className="py-0.5 font-mono text-xs break-all"><span className="text-amber-600 dark:text-amber-400">{f.status}</span> {f.path}</div>) : <p className="text-sm text-muted-foreground">Rien à commiter.</p>}
        </div>
      </div>

      {!draft && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={prep.busy || nothing} onClick={() => void prep.start()}>
            {prep.busy ? <Spinner /> : <PlayIcon />}Préparer la PR avec l’IA
          </Button>
          {nothing && <span className="text-sm text-muted-foreground">Commite d’abord tes changements : la PR part des commits de la branche.</span>}
          {!nothing && dirtyFiles.length > 0 && <span className="text-sm text-amber-600 dark:text-amber-400">{plural(dirtyFiles.length, 'fichier non commité ne sera pas', 'fichiers non commités ne seront pas')} dans la PR.</span>}
        </div>
      )}
      <RunPanel id={prep.id} events={prep.events} running={prep.running} run={prep.run} label="Claude regroupe les changements et rédige la description" onStop={prep.stop} action={prep} />

      {draft && (
        <div className="flex flex-col gap-4 border-t border-dashed pt-4">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pr-title">Titre de la PR</FieldLabel>
            <Input id="pr-title" className="font-mono text-xs" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="pr-body">Description</FieldLabel>
            <Textarea id="pr-body" className="font-mono text-xs leading-relaxed [field-sizing:fixed]" rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Vers</span>
            {(bases.length ? bases : [project.baseBranch]).map((b) => <Pill key={b} className="font-mono" active={base === b} onClick={() => setBase(b)}>{b}</Pill>)}
          </div>
          <ErrorBox error={error} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !draft.title.trim()} onClick={submit}>{busy && <Spinner />}Pousser et créer la PR</Button>
            <Button size="sm" variant="outline" disabled={prep.busy} onClick={() => { setDraft(null); void prep.start() }}>Régénérer</Button>
          </div>
        </div>
      )}
    </article>
  )
}

/** Ticket local : la proposition d'origine, gardée sur le Mac ; on peut en faire un ticket Linear à tout moment. */
function LocalTicketCard({ project, wtId, local }: { project: Project; wtId: string; local: LocalTicket }) {
  const promote = usePromoteLocalTicket(project.id, wtId)
  const remove = useRemoveLocalTicket(project.id, wtId)
  const toast = useToast()
  return (
    <article className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="gray"><LaptopIcon className="size-3" />Ticket local</Badge>
        <Badge tone="blue">{local.category}</Badge>
        <span className="text-xs text-muted-foreground">créé le {new Date(local.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span>
      </div>
      <h2 className="text-lg leading-snug font-semibold">{local.title}</h2>
      <div>
        <SectionLabel>Constat</SectionLabel>
        <p className="text-sm leading-relaxed">{local.why}</p>
      </div>
      <div>
        <SectionLabel>À faire</SectionLabel>
        <p className="text-sm leading-relaxed whitespace-pre-line">{local.proposal}</p>
      </div>
      {local.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{local.files.join(', ')}</p>}
      {local.risk && <p className="text-sm text-amber-700 dark:text-amber-400">Risque : {local.risk}</p>}
      <p className="text-xs text-muted-foreground">Gardé uniquement dans Shipyard, sur ce Mac. Il disparaît avec le worktree.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!project.team || promote.isPending} title={project.team ? undefined : 'Aucune équipe Linear liée à ce projet'} onClick={() => {
          if (!confirm(`Créer le ticket « ${local.title} » dans Linear (équipe ${project.team}, en cours, assigné à toi) et le lier à ce worktree ? Le ticket local sera supprimé.`)) return
          promote.mutate(undefined, { onSuccess: (t) => toast(`Ticket ${t.id} créé dans Linear et lié au worktree`), onError: (e) => toast(e.message, true) })
        }}>{promote.isPending ? <Spinner /> : <TicketPlusIcon />}Créer le ticket Linear</Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={remove.isPending} onClick={() => {
          if (!confirm('Supprimer ce ticket local ? Le worktree et la branche sont gardés.')) return
          remove.mutate(undefined, { onSuccess: () => toast('Ticket local supprimé'), onError: (e) => toast(e.message, true) })
        }}><Trash2Icon />Supprimer le ticket local</Button>
      </div>
    </article>
  )
}
