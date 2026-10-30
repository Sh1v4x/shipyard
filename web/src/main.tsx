import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { persistCache, queryClient, restoreCache } from './data/client.ts'
import { migrateBrowserTestState } from './data/runs.ts'
import { App } from './App.tsx'
import { ThemeProvider } from './theme.tsx'
import { ToastProvider } from './ui.tsx'
import './styles.css'

restoreCache()
persistCache()
void migrateBrowserTestState()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
