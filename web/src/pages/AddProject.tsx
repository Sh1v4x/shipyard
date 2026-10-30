import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { useAddProject } from '../data/mutations.ts'
import { useHealth, useTeams } from '../data/queries.ts'
import { go } from '../router.ts'
import { ErrorBox, Pill, Spinner, useToast } from '../ui.tsx'

export function AddProjectPage({ first = false }: { first?: boolean }) {
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [team, setTeam] = useState<string | null>(null)
  const add = useAddProject()
  const busy = add.isPending
  const [error, setError] = useState<unknown>(null)
  const health = useHealth()
  const teams = useTeams()
  const toast = useToast()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    add.mutate({ url, path: path || undefined, team: team ?? undefined }, {
      onSuccess: (p) => {
        toast(`${p.repo} ajouté`)
        go({ page: 'overview', project: p.id })
      },
      onError: setError,
    })
  }

  return (
    <form onSubmit={submit} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{first ? 'Ajoute ton premier projet' : 'Ajouter un projet'}</CardTitle>
          <CardDescription>Colle l’URL du dépôt GitHub. Le panel récupère ses PR ouvertes, les reviews qui te sont demandées, ses branches et l’état de la CI.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="p-url">URL GitHub</FieldLabel>
            <Input id="p-url" className="font-mono text-[13px]" type="text" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo" />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="p-path">Clone local <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
            <Input id="p-path" className="font-mono text-[13px]" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Documents/Github/mon-repo" />
            <p className="text-xs text-muted-foreground">Sans chemin, le panel cherche un clone dans tes dossiers habituels, sinon il clone le dépôt dans le dossier PROJECTS_ROOT de .env.local.</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Équipe Linear liée <span className="font-normal text-muted-foreground">(facultatif)</span></span>
            {!health.data?.linear ? (
              <p className="text-xs text-muted-foreground">Linear n’est pas connecté : ajoute LINEAR_API_KEY dans .env.local.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Pill active={team === null} onClick={() => setTeam(null)}>Aucune</Pill>
                {teams.data?.map((t) => (
                  <Pill key={t.key} active={team === t.key} onClick={() => setTeam(t.key)}>{t.key} · {t.name}</Pill>
                ))}
              </div>
            )}
          </div>
          <ErrorBox error={error} />
        </CardContent>
        <CardFooter className="border-t">
          <Button type="submit" disabled={busy || !url}>{busy && <Spinner />}{busy ? 'Récupération du dépôt…' : 'Ajouter le projet'}</Button>
        </CardFooter>
      </Card>
    </form>
  )
}
