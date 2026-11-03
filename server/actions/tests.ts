import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ActionKind, ManualTestOutput, MultiTestOutput, TestOutput, RunVideo, RunScope, Project, Run, WorktreeDetail } from '../../shared/types.ts'
import { HttpError, VIDEOS_DIR } from '../lib/config.ts'
import { androidDevice, ensurePlaywrightFfmpeg, startAndroidRecorder, toMp4, trimAroundActions, videoDuration, type AndroidRecorder } from '../lib/video.ts'
import { getRun, listRuns, onRunEnd, startJob, startRun, type RunSpec } from '../lib/claude.ts'
import { run } from '../lib/exec.ts'
import * as gh from '../lib/github.ts'
import { addTestLessons, branchTestMemory, projectTestMemory } from '../lib/testMemory.ts'
import { startManualEnv, stopManualEnv } from '../lib/manualEnv.ts'
import * as schemas from '../schemas.ts'
import { linkedWorktrees, worktreeDetail } from '../services.ts'
import { platformOf } from '../lib/platform.ts'
import { baseVars, type WorktreeActions, captureContext, reposOf, specFrom } from './context.ts'

/**
 * Test filmé d'un worktree : le navigateur par Playwright (outils vidéo), l'émulateur Android par Shipyard (adb screenrecord).
 * Contexte d'une session à l'autre : mémoire du projet et de la branche, dernier test de ce worktree, consignes.
 * others : les autres worktrees testés en même temps (fonctionnalité répartie sur plusieurs dépôts).
 */
const testSubject = (d: WorktreeDetail) =>
  `${d.pr ? `PR #${d.pr.number} (${d.pr.title})` : `the branch ${d.worktree.branch ?? d.worktree.head.slice(0, 7)} (no PR yet)`} of the repository ${d.project.name}`

const testConsigne = (consigne: string) => (consigne ? `## The user's instructions for this test (take priority)\n\n${consigne}` : '')

/** Mémoires des tests (projet, puis branche), communes au test par l'IA et à la préparation du test manuel. */
function testMemoryVar(project: string, wtId: string): string {
  const memoryProject = projectTestMemory(project)
  const memoryBranch = branchTestMemory(wtId)
  return [
    memoryProject && `## Project test memory (all branches)\n\nWhat previous tests learned: apply it directly, without rediscovering it.\n\n${memoryProject}`,
    memoryBranch && `## Test memory for this branch\n\nSpecific to the work in progress (data, screens, pitfalls of this code):\n\n${memoryBranch}`,
  ].filter(Boolean).join('\n\n')
}

/** Leçons renvoyées par l'agent (ancien format : texte seul, rangé dans la mémoire de branche, la plus prudente). */
function saveLessons(project: string, wtId: string, lessons: TestOutput['lessons'] | string[] | undefined) {
  const list = (lessons ?? []).map((l) => (typeof l === 'string' ? { scope: 'branch' as const, text: l } : l))
  if (list.length) addTestLessons(project, wtId, list)
}

async function testSpec(d: WorktreeDetail, wtId: string, opts: { consigne: string; kind: ActionKind; title: string; scope: RunScope; others: { name: string; path: string }[] }): Promise<RunSpec> {
  const id = randomUUID()
  const dir = join(VIDEOS_DIR, id)
  mkdirSync(dir, { recursive: true })
  const repos = opts.others.length ? [{ name: d.project.name, platform: platformOf(d.worktree.path) }] : await reposOf(d)
  const webRepos = repos.filter((r) => r.platform === 'web').map((r) => r.name)
  const web = webRepos.length > 0
  const android = repos.some((r) => r.platform === 'android')
  if (web) await ensurePlaywrightFfmpeg()
  const emulatorBefore = android ? !!(await androidDevice()) : false
  recordings.set(id, { dir, android: android ? startAndroidRecorder(dir, id.slice(0, 8)) : null, emulatorBefore })

  const last = [...listRuns({ project: d.project.id, worktree: wtId, kind: 'test', status: 'success' }, 1), ...listRuns({ project: d.project.id, worktree: wtId, kind: 'test-part', status: 'success' }, 1)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  const lastRun = last ? getRun(last.id) : null
  const lastOut = lastRun?.structured as TestOutput | null
  const previous = lastOut?.scenarios ? [
    `## Last test of this worktree (${new Date(lastRun!.startedAt).toLocaleString('en-US')})`,
    lastRun!.request ? `Instructions given then: ${lastRun!.request}` : '',
    `Suite: ${lastOut.suite.summary}`,
    ...lastOut.scenarios.map((sc) => `- [${sc.status}] ${sc.name}: ${sc.detail}`),
    'Do not repeat the same mistakes: a scenario left in warn or fail must this time be triggered and verified.',
  ].filter(Boolean).join('\n') : ''
  const part = opts.others.length ? [
    '## Test spread over several repositories',
    `The feature touches several repositories, each tested by its own agent, one after the other. You test **${d.project.name}**, in this worktree: its scenarios and its video.`,
    `The others: ${opts.others.map((o) => `${o.name} (${o.path})`).join(', ')}. You can read their code, and start one of these apps if a scenario of ${d.project.name} depends on it (link from one to the other, API call); stop it at the end.`,
    `A scenario that belongs to the other repository is not "out of scope": it is tested by its own agent. Do not list it here.`,
  ].join('\n') : ''
  return specFrom('test', {
    ...baseVars(d), capture: await captureContext(d, 'test', null, opts.others.length > 0), video: videoGuide(webRepos, android, dir),
    subject: testSubject(d),
    consigne: testConsigne(opts.consigne),
    memory: testMemoryVar(d.project.id, wtId),
    previous,
    part,
  }, {
    id, kind: opts.kind, title: opts.title, scope: opts.scope, cwd: d.worktree.path, schema: schemas.testSchema, request: opts.consigne || null,
    addDirs: opts.others.map((o) => o.path),
    onSuccess: async (r) => {
      saveLessons(d.project.id, wtId, (r.structured as TestOutput | null)?.lessons)
    },
    mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--caps', 'devtools', '--viewport-size', '1280,720', '--output-dir', dir] } },
  })
}

/** Vidéos montées pour un run de test : une par plateforme (et par app), la courte de préférence. */
function testVideos(runId: string): { file: string; label: string }[] {
  const dir = join(VIDEOS_DIR, runId)
  let list: RunVideo[] = []
  try {
    list = existsSync(join(dir, 'videos.json')) ? (JSON.parse(readFileSync(join(dir, 'videos.json'), 'utf8')) as RunVideo[]) : []
  } catch { /* liste illisible : pas de vidéo */ }
  const groups = [...new Set(list.map((v) => `${v.platform}|${v.label ?? ''}`))]
  return groups.map((g) => {
    const vs = list.filter((v) => `${v.platform}|${v.label ?? ''}` === g)
    const v = vs.find((x) => x.short) ?? vs[0]
    return { file: join(dir, v.file), label: [v.platform === 'android' ? 'Android' : 'Navigateur', v.label].filter(Boolean).join(' · ') }
  })
}

/** Ajoute le bloc vidéo à la fin de la section Tests de la description (sinon à la fin). */
function withVideos(body: string, videos: { label: string; url: string }[]): string {
  const block = ['🎥 **Vidéo du test**', ...videos.map((v) => (videos.length > 1 ? `${v.label}\n\n${v.url}` : v.url))].join('\n\n')
  const lines = body.split('\n')
  const start = lines.findIndex((l) => /^#{1,6}\s.*test/i.test(l))
  if (start < 0) return `${body.trimEnd()}\n\n${block}\n`
  const level = lines[start].match(/^#+/)![0].length
  let end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= level)
  if (end < 0) end = lines.length
  return [...lines.slice(0, end), '', block, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * PR créée : dépose la vidéo du dernier test de l'IA sur GitHub, par le Chrome de Shipyard, et la place dans la description,
 * sous la section Tests. Rien à faire (null) s'il n'y a pas de vidéo.
 */
export function attachTestVideo(project: Project, worktree: string, prUrl: string): Run | null {
  const last = listRuns({ worktree, kind: 'test', status: 'success' }, 1)[0]
  const test = last && getRun(last.id)
  if (!test) return null
  const st = test.structured as TestOutput | MultiTestOutput | null
  const runIds = st && 'parts' in st ? st.parts.map((p) => p.runId).filter((x): x is string => !!x) : [test.id]
  const videos = runIds.flatMap(testVideos)
  if (!videos.length) return null
  const num = Number(prUrl.match(/\/pull\/(\d+)/)?.[1])
  return startJob({ kind: 'pr-video', title: `Vidéo du test dans la PR #${num}`, scope: { project: project.id, worktree, pr: num } }, async (ctx) => {
    const done: { label: string; url: string }[] = []
    for (const v of videos) {
      if (statSync(v.file).size > 100 * 1_048_576) throw new Error(`Vidéo trop lourde pour GitHub (plus de 100 Mo) : ${v.label}`)
      done.push({ label: v.label, url: await gh.uploadToGithub(prUrl, v.file, (text) => ctx.log({ t: 'info', text })) })
      ctx.log({ t: 'info', text: `Vidéo déposée : ${v.label}` })
    }
    // Description illisible (GitHub ne répond pas) : on ne l'écrase surtout pas.
    const body = await gh.prBody(project.repo, num)
    if (!body) throw new Error(`Description de la PR illisible : rien n’a été modifié. Vidéo déposée : ${done.map((d) => d.url).join(' ')}`)
    await gh.setPrBody(project.repo, num, withVideos(body, done))
    ctx.log({ t: 'info', text: 'Description de la PR mise à jour' })
    return { urls: done.map((d) => d.url) }
  })
}

/** Enregistrements en cours, par run de test : dossier, filmeur Android, et si l'émulateur tournait avant le test. */
const recordings = new Map<string, { dir: string; android: AndroidRecorder | null; emulatorBefore: boolean }>()

/** Consigne vidéo du prompt de test, selon les plateformes du worktree. */
function videoGuide(webRepos: string[], android: boolean, dir: string): string {
  const web = webRepos.length > 0
  return [
    '## Test video',
    'The test is recorded so it can be shared: it must clearly show each scenario. Shipyard also makes a short version that keeps only the moments around your actions.',
    web && (webRepos.length > 1
      ? [
        `- Web: one video per app (${webRepos.join(', ')}). For each app, once it is open in the browser: \`browser_video_show_actions\`, then \`browser_start_video\` with filename \`${dir}/video-<app name>.webm\` (e.g. \`${dir}/video-${webRepos[0]}.webm\`).`,
        '- At the start of each scenario, call `browser_video_chapter` with the scenario name (title) and what it checks in one sentence (description).',
        '- When this app\'s scenarios are done, call `browser_stop_video` before moving on to the next app. Close the browser and stop the apps only after the last video.',
      ]
      : [
        '- Web: once the app is open in the browser (before the first scenario), call `browser_video_show_actions` then `browser_start_video` without a file name.',
        '- At the start of each scenario, call `browser_video_chapter` with the scenario name (title) and what it checks in one sentence (description).',
        '- After the last scenario, call `browser_stop_video`, and only then close the browser and stop the app.',
      ]).concat([
        '- If `browser_start_video` fails (missing ffmpeg: install it with the command given in the error), call `browser_stop_video` then `browser_start_video` again before the first scenario: a scenario played without a running recording has no video.',
      ]).join('\n'),
    android && '- Android: Shipyard itself records the emulator screen as soon as it is ready. Do not start a recording yourself, and do not stop the emulator at the end: Shipyard retrieves the video, then stops it if it was not running before the test.',
  ].filter(Boolean).join('\n')
}

/** Une action visible à l'écran : outil Playwright de navigation ou d'interaction, ou commande adb qui agit sur l'émulateur. */
const isWebAction = (name: string) => name.startsWith('mcp__playwright__browser_') && !/video|snapshot|console|network|tabs_list/.test(name)

const isAndroidAction = (name: string, summary: string) => name === 'Bash' && /adb\b.*\b(input|am start|monkey|screencap|uiautomator)/.test(summary)

/** Fin d'un test : récupère les vidéos, monte la version courte autour des actions, écrit la liste. */
async function finishRecording(r: Run) {
  const rec = recordings.get(r.id)
  if (!rec) return
  recordings.delete(r.id)
  const videos: RunVideo[] = []
  const tools = r.events.filter((e): e is Extract<Run['events'][number], { t: 'tool' }> => e.t === 'tool' && typeof e.at === 'number')
  const add = async (file: string, platform: RunVideo['platform'], short: boolean, label?: string) => {
    if (!existsSync(file)) return
    videos.push({ file: basename(file), platform, short, durationSec: Math.round(await videoDuration(file)), sizeBytes: statSize(file), ...(label ? { label } : {}) })
  }

  // Web : une vidéo par browser_start_video, alignée sur l'heure de cet appel.
  const starts = tools.filter((e) => e.name === 'mcp__playwright__browser_start_video').map((e) => e.at!)
  // Dans l'ordre de création (= ordre des browser_start_video), libellé tiré du nom (video-<app>.webm).
  const webms = readdirSync(rec.dir).filter((f) => /^video-.*\.webm$/.test(f)).sort((a, b) => statSync(join(rec.dir, a)).birthtimeMs - statSync(join(rec.dir, b)).birthtimeMs)
  for (const [i, f] of webms.entries()) {
    const label = f.match(/^video-(?!\d{4}-)(.+)\.webm$/)?.[1] ?? (webms.length > 1 ? `vidéo ${i + 1}` : undefined)
    const full = join(rec.dir, f)
    const from = starts[i] ?? starts.at(-1) ?? Date.parse(r.startedAt)
    const to = starts[i + 1] ?? Infinity
    const actions = tools.filter((e) => isWebAction(e.name) && e.at! >= from && e.at! < to).map((e) => (e.at! - from) / 1000)
    const mp4 = join(rec.dir, `web-${i}.mp4`)
    if (await toMp4(full, mp4).catch(() => false)) await add(mp4, 'web', false, label)
    else await add(full, 'web', false, label)
    const short = join(rec.dir, `web-${i}-court.mp4`)
    if (await trimAroundActions(full, short, actions).catch(() => false)) await add(short, 'web', true, label)
  }

  // Android : la vidéo de l'émulateur, alignée sur le début de l'enregistrement.
  if (rec.android) {
    const got = await rec.android.stop().catch(() => null)
    if (got) {
      await add(got.file, 'android', false)
      const actions = tools.filter((e) => isAndroidAction(e.name, e.summary)).map((e) => (e.at! - got.startedAt) / 1000)
      const short = join(rec.dir, 'android-court.mp4')
      if (await trimAroundActions(got.file, short, actions).catch(() => false)) await add(short, 'android', true)
      if (!rec.emulatorBefore && got.serial.startsWith('emulator')) await run('adb', ['-s', got.serial, 'emu', 'kill']).catch(() => undefined)
    }
  }
  writeFileSync(join(rec.dir, 'videos.json'), JSON.stringify(videos, null, 2))
}

const statSize = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

onRunEnd((run) => {
  if (recordings.has(run.id)) void finishRecording(run).catch((e: Error) => console.error(`Vidéo du test ${run.id} : ${e.message}`))
})

export const testsActions: WorktreeActions = {
  test: async ({ kind, input, d, scope }) => {
    const consigne = input.extra?.trim() ?? ''
    const linked = await linkedWorktrees(d.worktree)
    const label = (x: WorktreeDetail) => (x.pr ? `#${x.pr.number}` : x.worktree.branch ?? '')
    if (!linked.length) {
      return startRun(await testSpec(d, input.worktree!, { consigne, kind, title: `Tests ${label(d)}`.trim(), scope, others: [] }))
    }
    // Worktrees liés : un agent par worktree, dans son dépôt, l'un après l'autre (ports, base locale, émulateur unique).
    // Ce run rassemble leurs résultats et leurs vidéos.
    const targets = [
      { d, wtId: input.worktree! },
      ...(await Promise.all(linked.map(async (l) => ({ d: await worktreeDetail(l.project, l.worktree.id, true), wtId: l.worktree.id })))),
    ]
    const only = input.testOnly?.length ? new Set(input.testOnly) : null
    const selected = targets.filter((t) => !only || only.has(t.wtId))
    if (!selected.length) throw new HttpError(400, 'Aucun worktree à tester')
    const names = selected.map((t) => t.d.project.name)
    return startJob({ kind, title: `Tests ${label(d)} · ${names.join(' + ')}`.trim(), scope }, async (ctx): Promise<MultiTestOutput> => {
      const parts: MultiTestOutput['parts'] = []
      for (const t of targets) {
        if (ctx.cancelled()) break
        if (!selected.includes(t)) {
          // Pas retesté cette fois (correctif d'un seul côté) : on reprend son dernier résultat.
          const prev = listRuns({ project: t.d.project.id, worktree: t.wtId, kind: 'test-part' }, 5).find((x) => x.status !== 'running')
          const run = prev ? getRun(prev.id) : null
          if (run) parts.push({
            project: t.d.project.id, projectName: t.d.project.name, worktree: t.wtId, platform: platformOf(t.d.worktree.path), runId: run.id,
            output: run.status === 'success' ? (run.structured as TestOutput | null) : null,
            error: run.status === 'success' ? null : run.status === 'cancelled' ? 'Arrêté' : 'Échec', carriedAt: run.startedAt,
          })
          continue
        }
        ctx.log({ t: 'info', text: `Test de ${t.d.project.name} (${t.d.worktree.path})…` })
        const others = targets.filter((o) => o !== t).map((o) => ({ name: o.d.project.name, path: o.d.worktree.path }))
        const spec = await testSpec(t.d, t.wtId, { consigne, kind: 'test-part', title: `Tests · ${t.d.project.name}`, scope: { project: t.d.project.id, worktree: t.wtId, ref: 'test-part' }, others })
        const r = await ctx.runChild(spec)
        const error = r.status === 'success' ? null : r.events.filter((e) => e.t === 'error').at(-1)?.text ?? (r.status === 'cancelled' ? 'Arrêté' : 'Échec')
        ctx.log(error ? { t: 'error', text: `${t.d.project.name} : ${error}` } : { t: 'info', text: `${t.d.project.name} : terminé` })
        parts.push({ project: t.d.project.id, projectName: t.d.project.name, worktree: t.wtId, platform: platformOf(t.d.worktree.path), runId: r.id, output: r.structured as TestOutput | null, error })
      }
      return { parts }
    })
  },
  'test-manual': async ({ kind, input, project, d, scope, cwd, vars }) => {
    // L'environnement précédent libère ses ports avant que l'agent ne cherche les siens.
    await stopManualEnv(input.worktree!)
    const consigne = input.extra?.trim() ?? ''
    const repos = await reposOf(d)
    const wtId = input.worktree!
    return startRun(
      specFrom('test-manual', {
        ...vars, subject: testSubject(d), consigne: testConsigne(consigne), memory: testMemoryVar(project.id, wtId),
        repos: repos.map((r) => `- ${r.name}: ${r.path} (${r.platform === 'android' ? 'mobile app, Android emulator' : 'web'})`).join('\n'),
      }, {
        kind, title: `Test manuel ${d.pr ? `#${d.pr.number}` : d.worktree.branch ?? ''}`.trim(), scope, cwd, schema: schemas.manualTestSchema, request: consigne || null,
        addDirs: repos.slice(1).map((r) => r.path),
        onSuccess: async (r) => {
          const out = r.structured as ManualTestOutput
          saveLessons(project.id, wtId, out.lessons)
          r.events.push({ t: 'info', text: `Lancement de ${out.services.map((x) => x.name).join(', ') || 'rien'}…` })
          await startManualEnv(wtId, r.id, out, repos.map((x) => x.path))
          if (out.url) r.events.push({ t: 'info', text: `Ouvert dans Chrome : ${out.url}` })
        },
      }),
    )
  },
  'test-check': async ({ kind, input, scope, cwd, vars }) => {
    // Une étape du test manuel : l'agent lance sa commande de vérification et compare à l'attendu.
    if (!input.command?.trim()) throw new HttpError(400, 'Aucune commande à exécuter')
    return startRun(
      specFrom('test-check', { ...vars, step: input.step ?? 'test step', command: input.command.trim(), expected: input.expected ?? '' }, {
        kind, title: `Vérifier : ${input.step ?? 'étape du test'}`, scope, cwd, schema: schemas.testCheckSchema,
      }),
    )
  },
}
