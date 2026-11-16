import { describe, expect, it } from 'vitest'
import { ticketIdFrom } from './text.ts'

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
