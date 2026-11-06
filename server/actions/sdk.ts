
import type { Run, SdkActionOutput } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import { startJob } from '../lib/claude.ts'
import { sdkStatus } from '../lib/sdk.ts'
import { type WorktreeAction, type WorktreeActions, assertClean } from './context.ts'
import { publishSdk, updateSdk } from './sdkTools.ts'

async function sdkPackageAction({ kind, input, d, scope, cwd }: WorktreeAction): Promise<Run> {
  // SDK privé (GitHub Packages) en retard : le mettre à jour dans la branche, ou le faire publier par son dépôt
  // source puis le mettre à jour. Le commit poussé relance la CI.
  const st = (await sdkStatus(cwd, true)).find((s) => s.name === input.sdk)
  if (!st) throw new HttpError(404, `Paquet ${input.sdk ?? '?'} introuvable dans les dépendances`)
  await assertClean(d, `mettre à jour ${st.name}`)
  if (kind === 'sdk-update') {
    if (!st.latest) throw new HttpError(409, `Aucune version publiée de ${st.name} n’est accessible`)
    if (st.locked === st.latest) throw new HttpError(409, `${st.name} est déjà en ${st.latest}`)
    return startJob({ kind, title: `${st.name} → ${st.latest}`, scope: { ...scope, ref: st.name } }, async (ctx): Promise<SdkActionOutput> =>
      ({ version: st.latest, url: await updateSdk(ctx, d, st.name, st.latest!) }))
  }
  const wf = st.workflow
  if (!wf || !st.sourceRepo || !st.sourceBranch) throw new HttpError(409, `Workflow de publication de ${st.name} introuvable`)
  if (!wf.dispatchable) throw new HttpError(409, `${wf.file} (${st.sourceRepo}) ne se lance pas à la demande : il lui faut workflow_dispatch`)
  return startJob({ kind, title: `Publier ${st.name}`, scope: { ...scope, ref: st.name } }, async (ctx): Promise<SdkActionOutput> => {
    const version = await publishSdk(ctx, st)
    if (st.locked === version || !d.pr?.mine) return { version, url: null }
    return { version, url: await updateSdk(ctx, d, st.name, version) }
  })
}

export const sdkActions: WorktreeActions = {
  'sdk-update': sdkPackageAction,
  'sdk-publish': sdkPackageAction,
}
