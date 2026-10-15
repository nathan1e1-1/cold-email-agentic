import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import { buildSystemPrompt, buildUserPrompt } from './ai/prompt'
import type { MailboxProvider } from './services/mailbox'
import { createAiProvider, createMailboxProvider } from './services/providerFactory'
import { Sidebar, type ActivityItem, type View } from './components/Sidebar'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { ThreadList } from './components/ThreadList'
import { ReaderPane } from './components/ReaderPane'
import { DraftPanel } from './components/DraftPanel'

const VIEW_TITLE: Record<View, string> = { dashboard: 'Dashboard', inbox: 'Inbox', settings: 'Settings' }

const COLLAPSE_KEY = 'coldemailagentic.sidebarCollapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function App() {
  const [view, setView] = useState<View>('inbox')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed)
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
  const [draftsThisSession, setDraftsThisSession] = useState(0)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [testMode, setTestMode] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const activityIdRef = useRef(0)

  const pushActivity = useCallback((item: Omit<ActivityItem, 'id'>) => {
    activityIdRef.current += 1
    setActivity((prev) => [{ id: activityIdRef.current, ...item }, ...prev].slice(0, 50))
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore storage failures */
      }
      return next
    })
  }, [])

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
          thread, ownEmail: acc.ownEmail, tone: nextTone,
          instruction: opts.instruction, priorDraft: opts.priorDraft,
        }))
        setDraftsThisSession((n) => n + 1)
        pushActivity({ kind: 'draft', subject: thread.subject, tone: nextTone, at: Date.now(), threadId: thread.id })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setGenerating(false)
      }
    },
    [pushActivity],
  )

  const openThread = useCallback(async (box: MailboxProvider, id: string) => {
    setSelectedId(id); setStatus(null); setDraft(''); setInstruction('')
    setSelected(await box.getThread(id))
  }, [])

  const openThreadById = useCallback((threadId: string) => {
    setView('inbox')
    if (mailbox) void openThread(mailbox, threadId)
  }, [mailbox, openThread])

  const connect = useCallback(async () => {
    setError(null); setStatus(null); setThreads([]); setSelected(null); setSelectedId(null)
    setDraft(''); setInstruction('')
    setBusy('Connecting to Gmail…')
    try {
      const box = await createMailboxProvider()
      const acc = await box.connect()
      let aiProvider: AiProvider | null = null
      try {
        aiProvider = await createAiProvider()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      setMailbox(box); setAi(aiProvider); setAccount(acc)
      setBusy('Loading threads…')
      const list = await box.listThreads()
      setThreads(list)
      setBusy(null)
      if (list.length > 0) await openThread(box, list[0].id)
    } catch (err) {
      setBusy(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [openThread])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void connect()
  }, [connect])

  const onSend = useCallback(async () => {
    if (!mailbox || !selected || draft.trim() === '') return
    setError(null)
    try {
      const sent = await mailbox.send(selected.id, draft.trim())
      setStatus(`Sent to ${sent.to.map((a) => a.email).join(', ')}`)
      pushActivity({ kind: 'sent', subject: selected.subject, tone, at: Date.now(), threadId: selected.id })
      setThreads(await mailbox.listThreads())
      setSelected(await mailbox.getThread(selected.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mailbox, selected, draft, tone, pushActivity])

  const handleGenerate = useCallback(() => {
    if (selected && ai && account) {
      void generate(ai, account, selected, tone, {
        instruction: instruction || undefined,
        priorDraft: draft || undefined,
      })
    }
  }, [selected, ai, account, tone, instruction, draft, generate])

  const promptText = useMemo(() => {
    if (!selected) return null
    const system = buildSystemPrompt({ tone })
    const user = buildUserPrompt({ thread: selected, tone, instruction: instruction || undefined })
    return `SYSTEM\n${system}\n\nUSER\n${user}`
  }, [selected, tone, instruction])

  const recipient = useMemo(() => {
    if (!selected) return ''
    const lastInbound = [...selected.messages].reverse().find((m) => m.direction === 'inbound')
    const addr = lastInbound?.from
      ?? selected.participants.find((p) => p.email.toLowerCase() !== (account?.ownEmail ?? '').toLowerCase())
    if (!addr) return ''
    return addr.name ? `${addr.name} <${addr.email}>` : addr.email
  }, [selected, account])

  const replySubject = useMemo(
    () => (selected ? (selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`) : ''),
    [selected],
  )

  const sentThisSession = useMemo(() => activity.filter((a) => a.kind === 'sent').length, [activity])
  const canSend = mailbox !== null && selected !== null && draft.trim() !== ''

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        account={account}
        activity={activity}
        onOpenThread={openThreadById}
        busy={busy}
        onConnect={() => void connect()}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <div className="main">
        <header className="topbar">
          <span className="view-heading">{VIEW_TITLE[view]}</span>
          <div className="topbar-right">
            {draftsThisSession > 0 && <span className="badge">{draftsThisSession} drafts</span>}
            <label className="toggle">
              <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
              Test mode
            </label>
          </div>
        </header>

        {busy && <div className="banner">{busy}</div>}
        {error && <div className="banner error">{error}</div>}
        {status && <div className="banner ok">{status}</div>}

        <div className="content">
          {view === 'dashboard' && (
            <DashboardView
              account={account}
              threadCount={threads.length}
              draftsThisSession={draftsThisSession}
              sentThisSession={sentThisSession}
              activity={activity}
              aiLabel={ai?.descriptor.label ?? null}
              aiPrivacy={ai?.descriptor.privacy ?? null}
              onOpenThread={openThreadById}
              onGoInbox={() => setView('inbox')}
            />
          )}

          {view === 'inbox' && (
            <div className="workspace">
              <ThreadList
                threads={threads}
                selectedId={selectedId}
                onSelect={(id) => { if (mailbox) void openThread(mailbox, id) }}
              />
              <section className="reader">
                {selected ? (
                  <>
                    <ReaderPane thread={selected} />
                    <DraftPanel
                      ai={ai}
                      generating={generating}
                      draft={draft}
                      onDraftChange={setDraft}
                      tone={tone}
                      onToneChange={setTone}
                      instruction={instruction}
                      onInstructionChange={setInstruction}
                      onGenerate={handleGenerate}
                      onSend={() => void onSend()}
                      canSend={canSend}
                      testMode={testMode}
                      promptText={promptText}
                      to={recipient}
                      subject={replySubject}
                    />
                  </>
                ) : (
                  <div className="empty">
                    {busy ?? (account ? 'Select a conversation' : 'Connect Gmail to load your inbox.')}
                  </div>
                )}
              </section>
            </div>
          )}

          {view === 'settings' && <SettingsView onSaved={() => void connect()} />}
        </div>
      </div>
    </div>
  )
}

export default App
