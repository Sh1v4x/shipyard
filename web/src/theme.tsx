import { MonitorIcon, MoonIcon, SunIcon, ZapIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'devpanel:theme'
/** Thème cyberpunk : par-dessus le sombre, activé dans Réglages › Apparence. Lu aussi par web/index.html (pas de flash au chargement). */
const CYBER_KEY = 'devpanel:cyber'

interface ThemeState { theme: Theme; setTheme: (t: Theme) => void; cyber: boolean; setCyber: (v: boolean) => void }
const ThemeCtx = createContext<ThemeState>({ theme: 'system', setTheme: () => undefined, cyber: false, setCyber: () => undefined })
export const useTheme = () => useContext(ThemeCtx)

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function readCyber(): boolean {
  try {
    return localStorage.getItem(CYBER_KEY) === '1'
  } catch {
    return false
  }
}

/** Applique .dark (et .cyber) sur <html> ; en mode « système », suit la préférence de l'OS en direct. Le cyber est toujours sombre. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read)
  const [cyber, setCyberState] = useState(readCyber)

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const root = document.documentElement
      root.classList.toggle('dark', cyber || theme === 'dark' || (theme === 'system' && mq.matches))
      root.classList.toggle('cyber', cyber)
    }
    apply()
    if (theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, cyber])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(KEY, t) } catch { /* stockage indisponible */ }
  }
  const setCyber = (v: boolean) => {
    setCyberState(v)
    try { localStorage.setItem(CYBER_KEY, v ? '1' : '0') } catch { /* stockage indisponible */ }
  }

  return <ThemeCtx.Provider value={{ theme, setTheme, cyber, setCyber }}>{children}</ThemeCtx.Provider>
}

export function ThemeToggle() {
  const { theme, setTheme, cyber, setCyber } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Changer de thème">
          {cyber ? <ZapIcon /> : (
            <>
              <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light" disabled={cyber}><SunIcon />Clair</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" disabled={cyber}><MoonIcon />Sombre</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" disabled={cyber}><MonitorIcon />Système</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={cyber} onCheckedChange={(v) => setCyber(v === true)}>Cyberpunk</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
