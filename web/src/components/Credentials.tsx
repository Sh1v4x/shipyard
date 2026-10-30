import { LogInIcon, LogOutIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Credentials } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useClaudeAuth, useGithubBrowserLogin, useSaveCredentials } from '../data/mutations.ts'
import { useCredentials, useGithubBrowser } from '../data/queries.ts'
import { Badge, Spinner, useToast } from '../ui.tsx'

/** Réglages › Connexions : Claude Code, clé Linear et jeton GitHub (vérifiés avant d'être enregistrés dans .env.local). */
export function CredentialsSection() {
  // Connexion Claude en cours dans le Terminal : l'état est relu jusqu'à ce que le compte change.
  const [waiting, setWaiting] = useState<string | null>(null)
  const creds = useCredentials(waiting !== null)
  const c = creds.data
  useEffect(() => {
    if (waiting === null || !c?.claude.loggedIn) return
    if (`${c.claude.email}` !== waiting) setWaiting(null)
  }, [c, waiting])
  return (
    <>
      {creds.isLoading && <Spinner />}
      {c && (
        <>
          <ClaudeField claude={c.claude} waiting={waiting !== null} onLogin={() => setWaiting(`${c.claude.loggedIn ? c.claude.email : ''}`)} onDone={() => setWaiting(null)} />
          <KeyField
            title="Linear"
            status={c.linear.configured ? <Badge tone={c.linear.user ? 'green' : 'red'}>{c.linear.user ? `Connecté · ${c.linear.user}` : 'Clé refusée par Linear'}</Badge> : <Badge tone="amber">Non configuré</Badge>}
            current={c.linear.hint}
            help="Clé API personnelle : Linear › Settings › Security & access › Personal API keys."
            placeholder="lin_api_…"
            field="linearKey"
          />
          <KeyField
            title="GitHub"
            status={<Badge tone={c.github.login ? 'green' : 'red'}>{c.github.login ? `Connecté · ${c.github.login}` : 'Non connecté'}</Badge>}
            current={c.github.source === 'token' ? c.github.hint : null}
            help={c.github.source === 'token'
              ? 'Jeton personnel utilisé à la place de la connexion de gh. Le retirer revient à la connexion de gh.'
              : 'Utilise la connexion de gh (gh auth login dans un terminal). Tu peux la remplacer par un jeton personnel : GitHub › Settings › Developer settings › Personal access tokens, avec les droits repo, read:org et workflow.'}
            placeholder="ghp_… ou github_pat_…"
            field="githubToken"
            removeLabel="Revenir à la connexion gh"
          />
          <GithubBrowserField />
        </>
      )}
    </>
  )
}

function KeyField({ title, status, current, help, placeholder, field, removeLabel = 'Retirer la clé' }: {
  title: string
  status: ReactNode
  current: string | null
  help: string
  placeholder: string
  field: 'linearKey' | 'githubToken'
  removeLabel?: string
}) {
  const save = useSaveCredentials()
  const toast = useToast()
  const [value, setValue] = useState('')
  const submit = (next: string | null) =>
    save.mutate({ [field]: next }, {
      onSuccess: () => {
        setValue('')
        toast(next ? `${title} : clé vérifiée et enregistrée` : `${title} : clé retirée`)
      },
      onError: (e) => toast(e.message, true),
    })
  return (
    <div className="flex flex-col gap-2 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        {status}
        {current && <span className="font-mono text-xs text-muted-foreground">clé {current}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) submit(value) }}>
        <Input type="password" autoComplete="off" spellCheck={false} aria-label={`Nouvelle clé ${title}`} className="max-w-md flex-1 font-mono text-xs" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" disabled={!value.trim() || save.isPending}>{save.isPending && <Spinner />}{current ? 'Remplacer' : 'Enregistrer'}</Button>
        {current && <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => confirm(`${removeLabel} ?`) && submit(null)}>{removeLabel}</Button>}
      </form>
    </div>
  )
}

/** Claude Code : fait tourner les agents (claude -p) sur ton abonnement, sans clé API. */
function ClaudeField({ claude, waiting, onLogin, onDone }: { claude: Credentials['claude']; waiting: boolean; onLogin: () => void; onDone: () => void }) {
  const auth = useClaudeAuth()
  const toast = useToast()
  const account = [claude.email, claude.org, claude.plan && `abonnement ${claude.plan}`].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Claude Code</span>
        {!claude.installed ? <Badge tone="red">Non installé</Badge> : claude.loggedIn ? <Badge tone="green">Connecté{claude.method ? ` · ${claude.method}` : ''}</Badge> : <Badge tone="amber">Non connecté</Badge>}
        {claude.version && <span className="font-mono text-xs text-muted-foreground">{claude.version}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {!claude.installed
          ? 'La commande claude est introuvable : installe Claude Code (docs.anthropic.com/claude-code), puis reviens ici.'
          : claude.loggedIn
            ? `Les agents tournent sur ce compte : ${account}. Aucune clé API n’est nécessaire.`
            : 'Connecte ton compte Claude : les agents utiliseront ton abonnement, sans clé API.'}
      </p>
      {claude.installed && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={claude.loggedIn ? 'outline' : 'default'} disabled={auth.isPending || waiting} onClick={() => auth.mutate('login', {
            onSuccess: () => {
              onLogin()
              toast('Termine la connexion dans la fenêtre Terminal qui vient de s’ouvrir.')
            },
            onError: (e) => toast(e.message, true),
          })}>
            {waiting ? <Spinner /> : <LogInIcon />}{claude.loggedIn ? 'Changer de compte' : 'Se connecter'}
          </Button>
          {claude.loggedIn && (
            <Button variant="ghost" disabled={auth.isPending} onClick={() => confirm('Déconnecter Claude Code ? Les agents ne pourront plus se lancer avant une nouvelle connexion.') && auth.mutate('logout', {
              onSuccess: () => toast('Claude Code déconnecté'),
              onError: (e) => toast(e.message, true),
            })}>
              <LogOutIcon />Se déconnecter
            </Button>
          )}
          {waiting && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              En attente de la connexion dans le Terminal…
              <Button variant="link" size="sm" className="h-auto px-0" onClick={onDone}>Arrêter d’attendre</Button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Chrome de Shipyard connecté à GitHub : sert à déposer la vidéo du test dans la description d'une PR,
 * ce que l'API de GitHub ne permet pas. Connexion faite une fois, gardée dans son profil.
 */
function GithubBrowserField() {
  const state = useGithubBrowser()
  const login = useGithubBrowserLogin()
  const toast = useToast()
  const user = state.data?.user
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Vidéos des tests sur GitHub</span>
        {state.isFetching ? <Spinner className="size-3.5" /> : user ? <Badge tone="green">Connecté · {user}</Badge> : <Badge tone="amber">Non connecté</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        À la création d’une PR, Shipyard dépose la vidéo du dernier test dans sa description, avec un lecteur. GitHub ne le permet pas par l’API : Shipyard passe par son propre Chrome, connecté une fois à ton compte.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={user ? 'outline' : 'default'} disabled={login.isPending} onClick={() => login.mutate(undefined, {
          onSuccess: () => toast('Connecte-toi à GitHub dans la fenêtre Chrome qui vient de s’ouvrir, ferme-la, puis clique sur Vérifier.'),
          onError: (e) => toast(e.message, true),
        })}>{login.isPending ? <Spinner /> : <LogInIcon />}{user ? 'Changer de compte' : 'Se connecter'}</Button>
        <Button variant="ghost" disabled={state.isFetching} onClick={() => void state.refetch()}>Vérifier</Button>
      </div>
    </div>
  )
}
