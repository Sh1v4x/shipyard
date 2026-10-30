import { listPrompts, loadPrompt, resetPrompt, savePrompt } from '../lib/prompts.ts'
import { promptVersions, versionDiff } from '../lib/promptHistory.ts'
import { createRule, listRules, resetRule, ruleBody, saveRule } from '../lib/rules.ts'
import { Hono } from 'hono'
import { promptCosts } from '../lib/claude.ts'
import { jsonBody } from '../http.ts'
import * as inputs from '../inputs.ts'

export const promptsRoutes = new Hono()

const COST_DAYS = 30

promptsRoutes.get('/prompts', async (c) => {
  const costs = promptCosts(COST_DAYS)
  const prompts = (await listPrompts()).map((p) => ({ ...p, cost: costs.get(p.key) ?? null }))
  return c.json([...prompts, ...(await listRules())])
})

promptsRoutes.put('/rules/:key', async (c) => {
  const b = await jsonBody(c, inputs.saveRuleInput)
  saveRule(c.req.param('key'), b.content, b.projects)
  return c.json({ ok: true })
})

promptsRoutes.post('/rules/:key/reset', async (c) => {
  resetRule(c.req.param('key'))
  return c.json({ ok: true })
})

promptsRoutes.post('/rules', async (c) => {
  const b = await jsonBody(c, inputs.createRuleInput)
  return c.json({ key: createRule(b.name, b.projects ?? ['all']) })
})

promptsRoutes.put('/prompts/:key', async (c) => {
  savePrompt(c.req.param('key'), (await jsonBody(c, inputs.savePromptInput)).content)
  return c.json({ ok: true })
})

promptsRoutes.get('/prompts/:key/history', (c) => {
  loadPrompt(c.req.param('key'))
  return c.json(promptVersions('prompt', c.req.param('key')))
})
promptsRoutes.get('/rules/:key/history', (c) => {
  ruleBody(c.req.param('key'))
  return c.json(promptVersions('rule', c.req.param('key')))
})
promptsRoutes.get('/prompts/:key/history/:version', async (c) =>
  c.json(await versionDiff('prompt', c.req.param('key'), c.req.param('version'), loadPrompt(c.req.param('key')).body)))
promptsRoutes.get('/rules/:key/history/:version', async (c) =>
  c.json(await versionDiff('rule', c.req.param('key'), c.req.param('version'), ruleBody(c.req.param('key')))))

promptsRoutes.post('/prompts/:key/reset', async (c) => {
  resetPrompt(c.req.param('key'))
  return c.json({ ok: true })
})
