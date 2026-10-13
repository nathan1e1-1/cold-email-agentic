import { useCallback, useEffect, useState } from 'react'
import './App.css'
import type { Account, Thread } from './domain/types'
import { MockMailboxProvider } from './services/mockMailbox'

const provider = new MockMailboxProvider()

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function lastSender(thread: Thread): string {
  const last = thread.messages.at(-1)
  if (!last) return 'Unknown'
  return last.direction === 'outbound' ? 'You' : last.from.name ?? last.from.email
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Thread | null>(null)
  const [reply, setReply] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadThreads = useCallback(async () => {
    const list = await provider.listThreads()
    setThreads(list)
    return list
  }, [])

  const openThread = useCallback(async (id: string) => {
    setSelectedId(id)
    setReply('')
    setStatus(null)
    setSelected(await provider.getThread(id))
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const acc = await provider.connect()
        if (!active) return
        setAccount(acc)
        const list = await loadThreads()
        if (active && list.length > 0) await openThread(list[0].id)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      active = false
    }
  }, [loadThreads, openThread])

  const onSend = useCallback(async () => {
    if (!selected || reply.trim() === '') return
    setError(null)
    try {
      const sent = await provider.send(selected.id, reply.trim())
      await loadThreads()
      await openThread(selected.id)
      setStatus(`Sent to ${sent.to.map((a) => a.email).join(', ')} (simulated)`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selected, reply, loadThreads, openThread])

  const canSend = selected !== null && reply.trim() !== ''

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ColdEmailAgentic</div>
        <div className="account">
          {account ? (
            <>
              <span className="dot" aria-hidden="true" />
              <span>
                {account.displayName} &lt;{account.email}&gt;
              </span>
              <span className="badge">mock inbox</span>
            </>
          ) : (
            <span>Connecting…</span>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

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
                  onClick={() => void openThread(t.id)}
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
                      <span className="message-from">
                        {m.direction === 'outbound' ? 'You' : m.from.name ?? m.from.email}
                      </span>
                      <span className="message-date">{formatDate(m.date)}</span>
                    </div>
                    <div className="message-body">{m.bodyText}</div>
                  </li>
                ))}
              </ol>

              <div className="reply">
                {status && <div className="banner ok">{status}</div>}
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  rows={4}
                />
                <div className="reply-actions">
                  <span className="hint">Simulated send — no real email leaves the app yet.</span>
                  <button type="button" className="send" disabled={!canSend} onClick={() => void onSend()}>
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">Select a conversation</div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
