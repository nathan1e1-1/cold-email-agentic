import { useCallback, useEffect, useRef, useState } from 'react'
import type { TonePreset } from '../domain/types'
import { TONE_PRESETS } from '../domain/types'
import type { AiProvider } from '../ai/aiProvider'
import { parseColdDraft } from '../ai/prompt'
import type { MailboxProvider } from '../services/mailbox'
import type { Repository } from '../db/repository'
import { SettingsService } from '../services/settings'
import { sendGuard, duplicateWarning, type GuardReason } from '../mail/sendGuard'

function guardMessage(reason: GuardReason): string {
  switch (reason) {
    case 'do_not_contact':
      return 'This address has opted out (do not contact).'
    case 'rate_limit_day':
      return 'Daily cold-send limit reached.'
    case 'rate_limit_minute':
      return 'Slow down — too many cold sends this minute.'
  }
}

interface Props {
  ai: AiProvider | null
  mailbox: MailboxProvider | null
  repo: Repository | null
  ownEmail: string
  signature: string
  testMode: boolean
  onSent: (subject: string, to: string, duplicate: boolean, close: boolean) => void
  onError: (message: string) => void
  onCancel: () => void
}

export function ComposePanel({ ai, mailbox, repo, ownEmail, signature, testMode, onSent, onError, onCancel }: Props) {
  const [to, setTo] = useState('')
  const [context, setContext] = useState('')
  const [tone, setTone] = useState<TonePreset>('professional')
  const [instruction, setInstruction] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const generate = useCallback(
    async (priorDraft?: string) => {
      if (!ai) { setError('Add an AI key in Settings.'); return }
      if (!to.trim()) { setError('Enter a recipient address first.'); return }
      setGenerating(true); setError(null)
      try {
        const text = await ai.generate({
          mode: 'cold',
          contact: { name: '', email: to.trim(), notes: context.trim() },
          ownEmail,
          tone,
          instruction: instruction || undefined,
          priorDraft,
          signature: signature || undefined,
        })
        const parsed = parseColdDraft(text)
        if (parsed.subject) setSubject(parsed.subject)
        setBody(parsed.body)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setGenerating(false)
      }
    },
    [ai, to, context, ownEmail, tone, instruction, signature],
  )

  const send = useCallback(async () => {
    if (!mailbox || !repo || !to.trim() || !body.trim() || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setError(null)
    const report = (message: string) => {
      if (aliveRef.current) setError(message)
      else onError(message)
    }
    try {
      const guard = await sendGuard(repo, new SettingsService(repo), {
        kind: 'cold', toEmail: to.trim(), now: Date.now(),
      })
      if (!guard.ok) { report(guardMessage(guard.reason)); return }
      const duplicate = await duplicateWarning(repo, to.trim())
      const { threadId } = await mailbox.sendNew({
        to: { email: to.trim() },
        subject: subject.trim() || '(no subject)',
        bodyText: body.trim(),
      })
      try {
        const existing = await repo.getContactByEmail(to.trim())
        if (!existing) {
          await repo.upsertContact({ name: '', email: to.trim(), notes: context.trim(), doNotContact: false })
        }
      } catch {
        // Contact tracking is best-effort.
      }
      try {
        await repo.recordSend(Date.now(), 'cold', to.trim(), threadId)
      } catch {
        onError('Sent, but could not record it locally — replies may not appear here.')
      }
      onSent(subject.trim() || '(no subject)', to.trim(), duplicate, aliveRef.current)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report(message)
    } finally {
      sendingRef.current = false
      if (aliveRef.current) setSending(false)
    }
  }, [mailbox, repo, to, subject, body, context, onSent, onError])

  return (
    <div className="composer">
      <div className="composer-topbar">
        <span className="composer-title">New cold email</span>
        {testMode && <span className="badge">test mode</span>}
      </div>
      <div className="composer-body">
        <label className="field">
          <span>To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="dana@acme.com" />
        </label>
        <label className="field">
          <span>Why are you reaching out? <em>optional</em></span>
          <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="met at the AI meetup; want to ask about their agent tooling" />
        </label>
        <div className="tones" role="group" aria-label="Tone">
          {TONE_PRESETS.map((t) => (
            <button key={t} type="button" className={t === tone ? 'tone active' : 'tone'} disabled={generating} aria-pressed={t === tone} onClick={() => setTone(t)}>
              {t}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Generate to fill, or type your own" />
        </label>
        <textarea className="draft-text" aria-label="Body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Click Generate to draft a first-touch email…" rows={8} />
        <div className="draft-controls">
          <input className="instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Nudge: shorter, warmer, ask a question…" />
          <button type="button" className="btn btn-ghost btn-sm" disabled={sending} onClick={onCancel}>Cancel</button>
          <button type="button" className="regen" disabled={generating || !ai} onClick={() => void generate(body || undefined)}>Generate</button>
          <button type="button" className="send" disabled={!mailbox || !repo || sending || generating || testMode || !to.trim() || !body.trim()} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
        {error && <div className="banner error">{error}</div>}
        {testMode && <span className="hint">Test mode is on — nothing is sent. Turn it off to send for real.</span>}
      </div>
    </div>
  )
}
