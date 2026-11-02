import { lazy } from 'react'

// Pages chargées à la demande : la vue d'ensemble s'affiche sans attendre le code des autres pages.
// Chaque loader peut être appelé en avance (survol d'un lien) pour précharger le code de la page.

export const loadWorktreePage = () => import('./Worktree.tsx')
export const WorktreePage = lazy(() => loadWorktreePage().then((m) => ({ default: m.WorktreePage })))
export const CreateWorktreePage = lazy(() => import('./CreateWorktree.tsx').then((m) => ({ default: m.CreateWorktreePage })))
export const AutomationsPage = lazy(() => import('./Automations.tsx').then((m) => ({ default: m.AutomationsPage })))
export const NewTicketPage = lazy(() => import('./NewTicket.tsx').then((m) => ({ default: m.NewTicketPage })))
export const PromptsPage = lazy(() => import('./Prompts.tsx').then((m) => ({ default: m.PromptsPage })))
export const NotesPage = lazy(() => import('./Notes.tsx').then((m) => ({ default: m.NotesPage })))
export const DailyPage = lazy(() => import('./Daily.tsx').then((m) => ({ default: m.DailyPage })))
export const StatsPage = lazy(() => import('./Stats.tsx').then((m) => ({ default: m.StatsPage })))
export const SettingsPage = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.SettingsPage })))
export const InsightsPage = lazy(() => import('./Insights.tsx').then((m) => ({ default: m.InsightsPage })))
export const InboxPage = lazy(() => import('./Inbox.tsx').then((m) => ({ default: m.InboxPage })))
