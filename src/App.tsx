import { useCallback, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import { TONE_PRESETS } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import type { MailboxProvider } from './services/mailbox'
import { createAiProvider, createMailboxProvider, type MailboxMode } from './services/providerFactory'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function lastSender(thread: Thread): string {
  const last = thread.messages.at(-1)
  if (!last) return 'Unknown'
  return last.direction === 'outbound' ? 'You' : last.from.name ?? last.from.email
}

function App() {
  const [mode, setMode] = useState<MailboxMode>('mock')
  const [mailbox, setMailbox] = useState<MailboxProvider | null>(null)
  const [ai, setAi] = useState<AiProvider | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Thread | null>(null)
  const [draft, setDraft] = useState('')
  const [tone, setTone] = useState<TonePreset>('professional')
  const [instruction, setInstruction] = useState('')
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(
    async (
      aiProvider: AiProvider,
      acc: Account,
      thread: Thread,
      nextTone: TonePreset,
      opts: { instruction?: string; priorDraft?: string } = {},
    ) => {
      setGenerating(true); setError(null); setStatus(null)
      try {
        setDraft(await aiProvider.generate({
          thread,
          ownEmail: acc.ownEmail,
          tone: nextTone,
          instruction: opts.instruction,
          priorDraft: opts.priorDraft,
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setGenerating(false)
      }
    },
    [],
  )

  const openThread = useCallback(
    async (box: MailboxProvider, id: string, aiProvider: AiProvider | null, acc: Account) => {
      setSelectedId(id); setStatus(null); setDraft(''); setInstruction('')
      const thread = await box.getThread(id)
      setSelected(thread)
      if (thread && aiProvider) void generate(aiProvider, acc, thread, tone, {})
    },
    [generate, tone],
  )

  const connect = useCallback(
    async (nextMode: MailboxMode) => {
      setMode(nextMode)
      setError(null); setStatus(null); setThreads([]); setSelected(null); setSelectedId(null)
      setDraft(''); setInstruction('')
      setBusy('Connecting…')
      try {
        const box = createMailboxProvider(nextMode)
        const acc = await box.connect()
        let aiProvider: AiProvider | null = null
        try {
          aiProvider = createAiProvider()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
        setMailbox(box); setAi(aiProvider); setAccount(acc)
        setBusy('Loading threads…')
        const list = await box.listThreads()
        setThreads(list)
        setBusy(null)
        if (list.length > 0) await openThread(box, list[0].id, aiProvider, acc)
      } catch (err) {
        setBusy(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [openThread],
  )

  const onSend = useCallback(async () => {
    if (!mailbox || !selected || draft.trim() === '') return
    setError(null)
    try {
      const sent = await mailbox.send(selected.id, draft.trim())
      setStatus(`Sent to ${sent.to.map((a) => a.email).join(', ')}`)
      setThreads(await mailbox.listThreads())
      setSelected(await mailbox.getThread(selected.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mailbox, selected, draft])

  const canSend = mailbox !== null && selected !== null && draft.trim() !== ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ColdEmailAgentic</div>
        <div className="account">
          {account ? (
            <>
              <span className="dot" aria-hidden="true" />
              <span>{account.displayName} &lt;{account.email}&gt;</span>
              <span className="badge">{mode === 'mock' ? 'mock inbox' : 'gmail'}</span>
            </>
          ) : (
            <span>Not connected</span>
          )}
          <span className="modes">
            <button type="button" className={mode === 'mock' ? 'chip active' : 'chip'} disabled={busy !== null} onClick={() => void connect('mock')}>Mock</button>
            <button type="button" className={mode === 'gmail' ? 'chip active' : 'chip'} disabled={busy !== null} onClick={() => void connect('gmail')}>Gmail</button>
          </span>
        </div>
      </header>

      {busy && <div className="banner">{busy}</div>}
      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner ok">{status}</div>}

      <div className="workspace">
        <aside className="list">
          <div className="list-head">
            Inbox <span className="count">{threads.length}</span>
          </div>
          <ul>
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={t.id === selectedId ? 'thread selected' : 'thread'}
                  onClick={() => { if (mailbox && account) void openThread(mailbox, t.id, ai, account) }}
                >
                  <span className="thread-top">
                    <span className="thread-sender">{lastSender(t)}</span>
                    <span className="thread-date">{formatDate(t.lastMessageAt)}</span>
                  </span>
                  <span className="thread-subject">{t.subject}</span>
                  <span className="thread-snippet">{t.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="reader">
          {selected ? (
            <>
              <div className="reader-head">
                <h1>{selected.subject}</h1>
                <p className="participants">
                  {selected.participants.map((p) => p.name ?? p.email).join(', ')}
                </p>
              </div>

              <ol className="messages">
                {selected.messages.map((m) => (
                  <li key={m.id} className={`message ${m.direction}`}>
                    <div className="message-meta">
                      <span className="message-from">{m.direction === 'outbound' ? 'You' : m.from.name ?? m.from.email}</span>
                      <span className="message-date">{formatDate(m.date)}</span>
                    </div>
                    <div className="message-body">{m.bodyText}</div>
                  </li>
                ))}
              </ol>

              <div className="draft-panel">
                <div className="draft-head">
                  <span className="draft-title">AI draft</span>
                  {generating && <span className="hint">generating…</span>}
                  {!ai && <span className="hint">set an AI key in .env to draft</span>}
                </div>
                <div className="tones">
                  {TONE_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={t === tone ? 'tone active' : 'tone'}
                      disabled={generating}
                      onClick={() => { setTone(t); if (selected && ai && account) void generate(ai, account, selected, t, {}) }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  className="draft-text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="The agent's draft appears here…"
                  rows={5}
                />
                <div className="draft-controls">
                  <input
                    className="instruction"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Nudge: shorter, warmer, ask about timing…"
                  />
                  <button
                    type="button"
                    className="regen"
                    disabled={generating || !ai}
                    onClick={() => { if (selected && ai && account) void generate(ai, account, selected, tone, { instruction: instruction || undefined, priorDraft: draft || undefined }) }}
                  >
                    Regenerate
                  </button>
                  <button type="button" className="send" disabled={!canSend || generating} onClick={() => void onSend()}>
                    Send
                  </button>
                </div>
                <span className="hint">
                  {mode === 'gmail' ? 'Sends a real reply from your Gmail account.' : 'Simulated send (mock inbox).'}
                </span>
              </div>
            </>
          ) : (
            <div className="empty">{busy ?? 'Select a conversation'}</div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
