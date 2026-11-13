import { ClipboardCopyIcon, MessageCircleQuestionIcon, WrenchIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label as FieldLabel } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BranchAskOutput } from '../../../../shared/types.ts'
import { Markdown } from '../../components/Markdown.tsx'
import { useAction } from '../../data/runs.ts'
import { PromptMenu, RunPanel, SectionLabel, Spinner, useToast } from '../../ui.tsx'

/**
 * Échange avec l'IA sur le test qu'elle vient de faire : une question sur ce qui a été testé, un doute sur un résultat,
 * ou une modification à proposer. L'agent reprend la session du test, ne modifie rien, et ses propositions se lancent
 * comme correctifs (onFix, suivis sur place par fixFor) ; sans onFix (PR d'un autre), elles se copient pour la review.
 */
export function TestAsk({ project, wtId, testRunId, fixBusy, onFix, fixFor }: {
  project: string
  wtId: string
  testRunId: string
  fixBusy: boolean
  onFix?: (title: string, request: string) => void
  fixFor: (title: string) => ReactNode
}) {
  const ask = useAction<BranchAskOutput>('test-ask', { project, worktree: wtId, ref: testRunId })
  const toast = useToast()
  const [text, setText] = useState('')
  const [followUp, setFollowUp] = useState('')
  const r = ask.result
  const send = async (request: string, previousRunId?: string) => {
    if (!request.trim()) return
    const id = await ask.start({ extra: request.trim(), resumeFrom: testRunId, previousRunId })
    if (id) {
      setText('')
      setFollowUp('')
    }
  }
  return (
    <section aria-label="Questionner l’IA sur ce test" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><MessageCircleQuestionIcon className="size-4" /></div>
        <div className="min-w-0">
          <p className="font-semibold">Questionner l’IA sur ce test</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Ce qu’elle a vraiment vérifié, pourquoi un scénario échoue, un cas à couvrir, une modification à faire : elle reprend le contexte du test, répond sans rien modifier, et propose les modifications à lancer.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`test-ask-${wtId}`}>Ta question ou ta demande</FieldLabel>
        <Textarea id={`test-ask-${wtId}`} rows={3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Ex. : as-tu testé le cas d’une liste vide ? · pourquoi le total affiché diffère-t-il de la base ? · propose un correctif pour le message d’erreur du formulaire." />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!text.trim() || ask.busy} onClick={() => void send(text)}>
            {ask.busy ? <Spinner /> : <MessageCircleQuestionIcon />}Envoyer
          </Button>
          <PromptMenu items={[['test-ask', 'Question sur un test']]} />
        </div>
      </div>
      <RunPanel id={ask.id} events={ask.events} running={ask.running} run={ask.run} label="L’IA reprend son test pour répondre" onStop={ask.stop} action={ask} />
      {r && !ask.busy && (
        <div className="flex flex-col gap-4 border-t border-dashed pt-4">
          {ask.run?.request && (
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <SectionLabel>Ta demande</SectionLabel>
              <p className="whitespace-pre-line">{ask.run.request}</p>
            </div>
          )}
          <Markdown text={r.summary} className="text-[15px] leading-relaxed font-medium" />
          {r.sections.map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1.5">
              <SectionLabel>{sec.title}</SectionLabel>
              <Markdown text={sec.body} className="text-sm leading-relaxed" />
            </section>
          ))}
          {r.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{r.files.join(' · ')}</p>}
          {r.followUps.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel className="mb-0">Modifications proposées</SectionLabel>
              {r.followUps.map((f) => (
                <div key={f.title} className="flex flex-col gap-3 rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">{f.title}</p>
                      <p className="text-muted-foreground">{f.request}</p>
                    </div>
                    {onFix
                      ? <Button size="sm" variant="outline" disabled={fixBusy} title="Un agent applique cette modification ; rien n’est commité avant ton accord." onClick={() => onFix(f.title, f.request)}><WrenchIcon />Lancer cette modification</Button>
                      : <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(`${f.title} : ${f.request}`).then(() => toast('Copié : à coller dans un commentaire de review'))}><ClipboardCopyIcon />Copier</Button>}
                  </div>
                  <div className="empty:hidden">{fixFor(f.title)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={`test-ask-more-${wtId}`}>Préciser <span className="font-normal text-muted-foreground">(l’IA reprend avec tout le contexte)</span></FieldLabel>
            <Textarea id={`test-ask-more-${wtId}`} rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Ex. : et si l’utilisateur n’a pas les droits ?" />
            <div><Button size="sm" variant="outline" disabled={!followUp.trim() || ask.busy} onClick={() => void send(followUp, ask.id ?? undefined)}>Continuer l’échange</Button></div>
          </div>
        </div>
      )}
    </section>
  )
}
