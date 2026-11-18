import { describe, expect, it } from 'vitest'
import { coversTicket, ticketIdFrom, ticketIdsFrom, worktreeTicketIds } from './text.ts'

describe('ticketIdFrom', () => {
  it('lit l’identifiant dans une URL Linear', () => {
    expect(ticketIdFrom('https://linear.app/acme/issue/ENG-142/add-bank-sync-retry')).toBe('ENG-142')
    expect(ticketIdFrom(' https://linear.app/acme/issue/tcl-1584 ')).toBe('TCL-1584')
  })

  it('accepte un identifiant seul ou dans une phrase', () => {
    expect(ticketIdFrom('eng-7')).toBe('ENG-7')
    expect(ticketIdFrom('le ticket ENG-142, urgent')).toBe('ENG-142')
  })

  it('renvoie null sans identifiant', () => {
    expect(ticketIdFrom('')).toBeNull()
    expect(ticketIdFrom('https://linear.app/acme/project/roadmap')).toBeNull()
    expect(ticketIdFrom('feature-x')).toBeNull()
  })
})

describe('ticketIdsFrom', () => {
  it('lit plusieurs tickets, URL et identifiants mêlés, sans doublon et dans l’ordre', () => {
    expect(ticketIdsFrom('ENG-142 eng-143')).toEqual(['ENG-142', 'ENG-143'])
    expect(ticketIdsFrom('https://linear.app/acme/issue/ENG-142/add-retry-2, ENG-9\nENG-142')).toEqual(['ENG-142', 'ENG-9'])
    expect(ticketIdsFrom('ENG-1+ENG-2;ENG-3')).toEqual(['ENG-1', 'ENG-2', 'ENG-3'])
  })

  it('renvoie une liste vide sans identifiant', () => {
    expect(ticketIdsFrom('  ')).toEqual([])
  })
})

describe('tickets d’un worktree', () => {
  it('donne le ticket principal puis les tickets associés', () => {
    expect(worktreeTicketIds({ ticketId: 'ENG-1', extraTicketIds: ['ENG-2'] })).toEqual(['ENG-1', 'ENG-2'])
    expect(worktreeTicketIds({ ticketId: null })).toEqual([])
  })

  it('un ticket associé compte comme pris par le worktree', () => {
    const w = { ticketId: 'ENG-1', extraTicketIds: ['ENG-2'] }
    expect(coversTicket(w, 'ENG-2')).toBe(true)
    expect(coversTicket(w, 'ENG-3')).toBe(false)
  })
})
