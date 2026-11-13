import { GitPullRequestArrowIcon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePullReviewBranch } from '../../data/mutations.ts'
import { useReviewBranch } from '../../data/queries.ts'
import { go } from '../../router.ts'
import { ErrorBox, Spinner, ago, plural, useToast } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

/**
 * « À jour » d'une review : l'auteur pousse ses correctifs sur la branche de la PR, mon worktree reste sur ce que j'avais
 * relu. Ici, ses nouveaux commits et un bouton pour les récupérer, avant de relancer la review sur le code à jour.
 */
export function ReviewSyncTab({ project, detail, wtId }: TabProps) {
  const q = useReviewBranch(project.id, wtId)
  const pull = usePullReviewBranch(project.id, wtId)
  const toast = useToast()
  const pr = detail.pr
  if (!pr) return null
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Récupération de la PR sur GitHub…</div>
  if (!q.data) return <ErrorBox error={q.error} />
  const { incoming, rewritten, dirty } = q.data
  const authors = [...new Set(incoming.map((c) => c.author))]
  const run = () => pull.mutate(undefined, {
    onSuccess: (r) => toast(r.pulled ? `${plural(r.pulled, 'commit récupéré', 'commits récupérés')} : le worktree est sur ${r.head}` : 'Déjà à jour'),
    onError: (e) => toast(e.message, true),
  })
  return (
    <section className="flex flex-col gap-4" aria-label="À jour">
      <Card className="flex-row flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1 basis-80">
          {incoming.length ? (
            <>
              <p className="font-semibold">La PR #{pr.number} a {plural(incoming.length, 'commit', 'commits')} que tu n’as pas en local</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Poussé(s) par {authors.join(', ')}. {rewritten
                  ? 'L’auteur a réécrit sa branche (force-push ou rebase) : le worktree se replace sur sa nouvelle version.'
                  : 'Le worktree avance sur la tête de la PR.'} Tu relis et tu testes ensuite le code à jour.
              </p>
              {dirty > 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{plural(dirty, 'fichier modifié', 'fichiers modifiés')} en local : annule-les (onglet Ticket) avant de récupérer.</p>}
            </>
          ) : (
            <p className="text-muted-foreground">Le worktree est à jour avec la PR #{pr.number} sur GitHub : tu relis bien sa dernière version.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching && <Spinner />}Vérifier</Button>
          {incoming.length > 0 && (
            <Button size="sm" disabled={pull.isPending || dirty > 0} onClick={run}>
              {pull.isPending ? <Spinner /> : <GitPullRequestArrowIcon />}Récupérer · {plural(incoming.length, 'commit', 'commits')}
            </Button>
          )}
        </div>
      </Card>
      {incoming.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <p className="border-b bg-muted/50 px-5 py-2.5 text-sm font-medium">Poussé depuis ton dernier passage</p>
          {incoming.map((c) => (
            <div key={c.sha} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-5 py-2.5 text-sm first:border-t-0">
              <span className="font-mono text-xs text-muted-foreground">{c.sha}</span>
              <span className="min-w-0 flex-1">{c.subject}</span>
              <span className="text-xs text-muted-foreground">{c.author} · {ago(c.at)}</span>
            </div>
          ))}
        </div>
      )}
      {!incoming.length && (
        <div>
          <Button size="sm" variant="outline" onClick={() => go({ page: 'worktree', project: project.id, wt: wtId, tab: 'review' })}><PlayIcon />Ouvrir la review</Button>
        </div>
      )}
    </section>
  )
}
