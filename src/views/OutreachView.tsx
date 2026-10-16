import { useCallback, useEffect, useState } from 'react'
import type { Contact, TonePreset } from '../domain/types'
import { TONE_PRESETS } from '../domain/types'
import type { AiProvider } from '../ai/aiProvider'
import { parseColdDraft } from '../ai/prompt'
import type { MailboxProvider } from '../services/mailbox'
import type { Repository } from '../db/repository'
import { SettingsService } from '../services/settings'
import { sendGuard, duplicateWarning, type GuardReason } from '../mail/sendGuard'

function guardMessage(reason: GuardReason): string {
  switch (reason) {
    case 'missing_mailing_address':
      return 'Add a mailing address in Settings before cold emailing.'
    case 'do_not_contact':
      return 'This address has opted out (do not contact).'
    case 'rate_limit_day':
      return 'Daily cold-send limit reached (25/day).'
    case 'rate_limit_minute':
      return 'Slow down — max 3 cold sends per minute.'
  }
}

interface Props {
  ai: AiProvider | null
  mailbox: MailboxProvider | null
  repo: Repository | null
  ownEmail: string
  testMode: boolean
  onSent: (subject: string, to: string) => void
}

export function OutreachView({ ai, mailbox, repo, ownEmail, testMode, onSent }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [context, setContext] = useState('')
  const [tone, setTone] = useState<TonePreset>('professional')
  const [instruction, setInstruction] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadContacts = useCallback(async () => {
    if (!repo) return
    setContacts(await repo.listContacts())
  }, [repo])

  useEffect(() => {
    if (!repo) return
    let active = true
    void repo.listContacts().then((list) => {
      if (active) setContacts(list)
    })
    return () => {
      active = false
    }
  }, [repo])

  const selectContact = useCallback((c: Contact) => {
    setName(c.name); setEmail(c.email); setContext(c.notes ?? '')
    setSubject(''); setBody(''); setInstruction(''); setStatus(null); setError(null)
  }, [])

  const reset = useCallback(() => {
    setName(''); setEmail(''); setContext(''); setInstruction('')
    setSubject(''); setBody(''); setStatus(null); setError(null)
  }, [])

  const generate = useCallback(
    async (priorDraft?: string) => {
      if (!ai) { setError('Add an AI key in Settings.'); return }
      if (!email.trim()) { setError('Enter an email address first.'); return }
      setGenerating(true); setError(null); setStatus(null)
      try {
        const text = await ai.generate({
          mode: 'cold',
          contact: { name: name.trim(), email: email.trim(), notes: context.trim() },
          ownEmail,
          tone,
          instruction: instruction || undefined,
          priorDraft,
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
    [ai, name, email, context, ownEmail, tone, instruction],
  )

  const send = useCallback(async () => {
    if (!mailbox || !repo || !email.trim() || !body.trim()) return
    setError(null); setStatus(null)
    const settings = new SettingsService(repo)
    const guard = await sendGuard(repo, settings, { kind: 'cold', toEmail: email.trim(), now: Date.now() })
    if (!guard.ok) { setError(guardMessage(guard.reason)); return }
    const duplicate = await duplicateWarning(repo, email.trim())
    const unsubscribeLine = (await settings.get('unsubscribe_line')).trim()
    const mailingAddress = (await settings.get('mailing_address')).trim()
    const footer = [mailingAddress, unsubscribeLine].filter(Boolean).join('\n')
    const fullBody = footer ? `${body.trim()}\n\n${footer}` : body.trim()
    try {
      await mailbox.sendNew({
        to: { name: name.trim() || undefined, email: email.trim() },
        subject: subject.trim() || '(no subject)',
        bodyText: fullBody,
        listUnsubscribeMailto: `mailto:${ownEmail}?subject=unsubscribe`,
      })
      await repo.upsertContact({ name: name.trim(), email: email.trim(), notes: context.trim(), doNotContact: false })
      await repo.recordSend(Date.now(), 'cold', email.trim())
      await loadContacts()
      onSent(subject.trim() || '(no subject)', email.trim())
      setStatus(`Sent to ${email.trim()}${duplicate ? ' (you had emailed this address before)' : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mailbox, repo, name, email, subject, body, context, ownEmail, loadContacts, onSent])

  return (
    <div className="workspace">
      <aside className="list">
        <div className="list-head">
          Outreach <span className="count">{contacts.length}</span>
        </div>
        <div className="list-search">
          <button type="button" className="chip ghost new-contact" onClick={reset}>+ New contact</button>
        </div>
        <ul>
          {contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={c.email === email ? 'thread selected' : 'thread'}
                onClick={() => selectContact(c)}
              >
                <span className="thread-main">
                  <span className="thread-top">
                    <span className="thread-sender">{c.name || c.email}</span>
                    {c.doNotContact && <span className="badge">opted out</span>}
                  </span>
                  <span className="thread-snippet">{c.notes || c.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="reader">
        <div className="composer">
          <div className="composer-topbar">
            <span className="composer-title">New outreach email</span>
            {testMode && <span className="badge">test mode</span>}
          </div>

          <div className="composer-body">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dana Rivera" />
            </label>
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dana@acme.com" />
            </label>
            <label className="field">
              <span>Why are you reaching out? <em>one line of context</em></span>
              <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="met at the AI meetup; want to ask about their agent tooling" />
            </label>

            <div className="tones">
              {TONE_PRESETS.map((t) => (
                <button key={t} type="button" className={t === tone ? 'tone active' : 'tone'} disabled={generating} onClick={() => setTone(t)}>
                  {t}
                </button>
              ))}
            </div>

            <label className="field">
              <span>Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Generate to fill, or type your own" />
            </label>

            <textarea
              className="draft-text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Click Generate to draft a first-touch email…"
              rows={8}
            />

            <div className="draft-controls">
              <input
                className="instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Nudge: shorter, warmer, ask a question…"
              />
              <button type="button" className="regen" disabled={generating || !ai} onClick={() => void generate(body || undefined)}>
                Generate
              </button>
              <button
                type="button"
                className="send"
                disabled={!mailbox || generating || testMode || !email.trim() || !body.trim()}
                onClick={() => void send()}
              >
                Send
              </button>
            </div>

            {status && <div className="banner ok">{status}</div>}
            {error && <div className="banner error">{error}</div>}
            {testMode && <span className="hint">Test mode is on — nothing is sent. Turn it off to send for real.</span>}
          </div>
        </div>
      </section>
    </div>
  )
}
