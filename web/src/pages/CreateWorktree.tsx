import { GitBranchIcon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BranchNameOutput, Project } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useCreateBranch, useCreateWorktree } from '../data/mutations.ts'
import { useBranches, useProjectOverview } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Badge, ErrorBox, Pill, PromptMenu, Spinner, ticketTone, useToast } from '../ui.tsx'
import { slugify } from '../../../shared/text.ts'

type Mode = 'ticket' | 'existing' | 'new'
const PREFIXES = ['feat', 'fix', 'refactor', 'chore']

export function CreateWorktreePage({ project, ticketId, initialMode }: { project: Project; ticketId?: string; initialMode?: string }) {
  const ov = useProjectOverview(project.id)
  const branches = useBranches(project.id)
  const createWorktree = useCreateWorktree(project.id)
  const createBranch = useCreateBranch(project.id)
  const toast = useToast()
  const [mode, setMode] = useState<Mode>((initialMode as Mode) ?? (ticketId || project.team ? 'ticket' : 'new'))
  const [ticket, setTicket] = useState<string | undefined>(ticketId)
  const [prefix, setPrefix] = useState('feat')
  const [name, setName] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [existing, setExisting] = useState<string | null>(null)
  const [base, setBase] = useState(project.baseBranch)
  const busy = createWorktree.isPending || createBranch.isPending
  const [error, setError] = useState<unknown>(null)

  const t = ov.data?.tickets.find((x) => x.id === ticket)
  const naming = useAction<BranchNameOutput>('branch-name', { project: project.id, ref: ticket })

  // Choisir un ticket lance la proposition de nom par l'IA (sauf si un nom existe déjà pour ce ticket).
  useEffect(() => {
    if (!t) return
    setPrefix(t.type)
    setName(null)
    if (!naming.loading && !naming.id && !naming.busy) void naming.start({ ticketId: t.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, naming.loading])

  const candidates = (ov.data?.tickets ?? []).filter((x) => x.statusType !== 'completed' && x.statusType !== 'canceled' && !ov.data?.worktrees.some((w) => w.ticketId === x.id))
  const suggested = t && naming.result ? `${prefix}/${t.id}-${slugify(naming.result.slug)}` : ''
  const usedBranches = new Set(ov.data?.worktrees.map((w) => w.branch))
  // Jamais main / master comme base quand le dépôt a develop (le serveur le refuse aussi).
  const bases = useMemo(() => {
    const all = (branches.data ?? []).filter((b) => ['main', 'master', 'develop', 'dev', 'staging'].includes(b) || b.startsWith('release/'))
    return all.includes('develop') ? all.filter((b) => b !== 'main' && b !== 'master') : all
  }, [branches.data])

  let branch = ''
  if (mode === 'ticket') branch = name ?? suggested
  if (mode === 'new') branch = slug ? `${prefix}/${slug}` : ''
  if (mode === 'existing') branch = existing ?? ''
  const dir = mode === 'ticket' && t ? t.id : branch.split('/').pop() || '<dossier>'
  const cmd = mode === 'existing'
    ? `git worktree add ${project.worktreeRoot}/${dir} ${branch || '<branche>'}`
    : `git worktree add ${project.worktreeRoot}/${dir} -b ${branch || '<branche>'} origin/${base}`

  const create = () => {
    setError(null)
    createWorktree.mutate({ mode, branch, base, ticketId: t?.id }, {
      onSuccess: (r) => {
        toast(`Worktree créé : ${r.path}`)
        go({ page: 'worktree', project: project.id, wt: r.id })
      },
      onError: setError,
    })
  }

  const branchOnly = () => {
    setError(null)
    createBranch.mutate({ branch, base }, {
      onSuccess: () => {
        toast(`Branche ${branch} créée sur GitHub depuis ${base}`)
        setExisting(branch)
        setMode('existing')
      },
      onError: setError,
    })
  }

  return (
    <Card className="max-w-3xl gap-0 py-0" aria-label="Nouveau worktree">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Nouveau worktree</h1>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{project.repo} → {project.worktreeRoot}</p>
        </div>
        <Button variant="ghost" size="icon" asChild>
          <a href={href({ page: 'overview', project: project.id })} aria-label="Fermer"><XIcon /></a>
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 py-6">
        <div className="flex flex-wrap gap-2">
          {([['ticket', 'Depuis un ticket Linear'], ['existing', 'Depuis une branche existante'], ['new', 'Nouvelle branche']] as const).map(([k, label]) => (
            <Pill key={k} active={mode === k} onClick={() => setMode(k)}>{label}</Pill>
          ))}
        </div>

        {mode === 'ticket' && (
          <Field label="Ticket Linear">
            {!project.team && <p className="text-sm text-muted-foreground">Aucune équipe Linear liée à ce projet. Lie-en une depuis la vue d’ensemble, ou crée le worktree depuis une branche.</p>}
            {project.team && candidates.length === 0 && <p className="text-sm text-muted-foreground">Tous les tickets ouverts ont déjà un worktree.</p>}
            {candidates.length > 0 && (
              <div className="flex max-h-80 flex-col gap-1 overflow-auto rounded-lg border p-1">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={ticket === c.id}
                    onClick={() => setTicket(c.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                      ticket === c.id && 'border-ring bg-accent',
                    )}
                  >
                    <span className="min-w-20 font-mono text-xs font-medium">{c.id}</span>
                    <span className="min-w-0 flex-1">{c.title}</span>
                    <Badge tone={ticketTone(c.statusType)}>{c.status}</Badge>
                  </button>
                ))}
              </div>
            )}
            {t && (
              <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400"><SparklesIcon className="size-3.5" />Nom proposé par l’IA</span>
                  <PromptMenu items={[['branch-name', 'Nom de branche']]} />
                </div>
                {naming.busy ? <span className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400"><Spinner />Traduction et raccourcissement du titre…</span>
                  : naming.failed ? (
                    <span className="text-sm text-red-600 dark:text-red-400">
                      La proposition a échoué. Écris le nom à la main ou{' '}
                      <Button variant="link" size="sm" className="h-auto p-0 text-red-600 dark:text-red-400" onClick={() => naming.start({ ticketId: t.id })}>réessaie</Button>.
                    </span>
                  )
                  : <span className="font-mono text-sm font-medium break-all">{suggested}</span>}
                {naming.result && !naming.busy && (
                  <Button variant="ghost" size="sm" className="w-fit" onClick={() => naming.start({ ticketId: t.id })}><RefreshCwIcon />Proposer un autre nom</Button>
                )}
              </div>
            )}
          </Field>
        )}

        {mode === 'existing' && (
          <Field label="Branche distante">
            {branches.isLoading && <Spinner className="text-muted-foreground" />}
            <div className="flex max-h-80 flex-col gap-1 overflow-auto rounded-lg border p-1">
              {(branches.data ?? []).filter((b) => !usedBranches.has(b) && !bases.includes(b)).map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={existing === b}
                  onClick={() => setExisting(b)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-accent',
                    existing === b && 'border-ring bg-accent',
                  )}
                >
                  <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="break-all">{b}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        {mode !== 'existing' && (
          <>
            <Field label="Type">
              <div className="flex flex-wrap gap-2">
                {PREFIXES.map((p) => (
                  <Pill key={p} active={prefix === p} onClick={() => {
                    setPrefix(p)
                    if (name != null) setName(`${p}/${name.replace(/^[^/]*\//, '')}`)
                  }}>{p}</Pill>
                ))}
              </div>
            </Field>
            {mode === 'ticket' ? (
              <Field label="Nom de la branche" htmlFor="c-name">
                <Input id="c-name" className="font-mono text-[13px]" value={branch} onChange={(e) => setName(e.target.value)} placeholder="feat/ENG-1-short-name" />
              </Field>
            ) : (
              <Field label="Nom de la branche" htmlFor="c-slug" hint="Court et en anglais. Les espaces deviennent des tirets.">
                <div className="flex h-9 overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
                  <span className="flex items-center border-r bg-muted px-3 font-mono text-[13px] text-muted-foreground">{prefix}/</span>
                  <input id="c-slug" className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[13px] outline-none placeholder:text-muted-foreground" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="onboarding-checklist" />
                </div>
              </Field>
            )}
            <Field label="Partir de">
              <div className="flex flex-wrap gap-2">
                {(bases.length ? bases : [project.baseBranch]).map((b) => (
                  <Pill key={b} className="font-mono text-xs" active={base === b} onClick={() => setBase(b)}>{b}</Pill>
                ))}
              </div>
            </Field>
          </>
        )}

        <div className="overflow-x-auto rounded-lg bg-terminal px-4 py-3 font-mono text-xs leading-relaxed text-terminal-foreground">
          <div><span className="text-zinc-500">$ </span>git fetch origin</div>
          <div className="whitespace-pre-wrap break-all"><span className="text-zinc-500">$ </span>{cmd}</div>
        </div>
        <ErrorBox error={error} />
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t py-4">
        <Button disabled={busy || !branch} onClick={create}>{busy && <Spinner />}Créer le worktree</Button>
        {mode === 'new' && <Button variant="outline" disabled={busy || !slug} onClick={branchOnly}>Créer seulement la branche</Button>}
        <Button variant="ghost" asChild>
          <a href={href({ page: 'overview', project: project.id })}>Annuler</a>
        </Button>
      </CardFooter>
    </Card>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel> : <span className="text-sm font-medium">{label}</span>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
