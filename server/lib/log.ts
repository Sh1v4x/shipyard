/**
 * Échec toléré d'une source facultative (GitHub, Linear…) : on continue avec `fallback`, mais la cause
 * reste visible dans le terminal du serveur au lieu de passer pour une absence de données.
 */
export const warnOn =
  <T>(source: string, fallback: T) =>
  (e: unknown): T => {
    console.warn(`[${source}] ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
    return fallback
  }
