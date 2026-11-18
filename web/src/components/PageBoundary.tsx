import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Erreur pendant l'affichage d'une page (ou le chargement de son code) : sans ce garde-fou, React retire toute
 * l'application et laisse une page vide. Ici la navigation reste en place et l'erreur se lit, avec de quoi repartir.
 * `resetKey` (la route) remet la page d'aplomb dès qu'on navigue ailleurs.
 */
export class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; stack: string | null; key: string }> {
  state = { error: null as Error | null, stack: null as string | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey === state.key ? null : { error: null, stack: null, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page en erreur', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? null })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div>
          <p className="font-semibold">Cette page n’a pas pu s’afficher</p>
          <p className="mt-0.5 font-mono text-sm break-words">{error.message}</p>
        </div>
        {stack && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Où l’erreur s’est produite</summary>
            <pre className="mt-2 max-h-64 overflow-auto font-mono whitespace-pre-wrap">{stack.trim()}</pre>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => this.setState({ error: null, stack: null })}>Réessayer</Button>
          <Button size="sm" variant="outline" onClick={() => location.reload()}>Recharger la page</Button>
        </div>
      </div>
    )
  }
}
