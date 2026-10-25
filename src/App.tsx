import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import { buildSystemPrompt, buildUserPrompt } from './ai/prompt'
import type { MailboxProvider, ThreadPage } from './services/mailbox'
import { isOutreachThread, recentRecipientEmails } from './mail/outreach'
import { createAiProvider, createMailboxProvider } from './services/providerFactory'
import { Sidebar, type ActivityItem, type View } from './components/Sidebar'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { BoardView } from './views/BoardView'
import { ensureCardForThread } from './services/kanban'
import { loadSettings } from './services/appSettings'
import { getRepository } from './db/repositoryFactory'
import type { Repository } from './db/repository'
import { ThreadList } from './components/ThreadList'
import { ComposePanel } from './components/ComposePanel'
import { ReaderPane } from './components/ReaderPane'
import { DraftPanel } from './components/DraftPanel'

const VIEW_TITLE: Record<View, string> = {
  board: 'Board',
  inbox: 'Inbox',
  dashboard: 'Dashboard',
  settings: 'Settings',
}

const COLLAPSE_KEY = 'coldemailagentic.sidebarCollapsed'

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

async function persistThreads(r: Repository, acc: Account, list: Thread[]): Promise<void> {
  const accountRow = await r.upsertAccount({
    provider: 'gmail', email: acc.email, ownEmail: acc.ownEmail, tokenRef: 'gmail', createdAt: Date.now(),
  })
  // Full, unwindowed set: older leads must keep their cards.
  const recipients = new Set((await r.listColdRecipients()).map((c) => c.email))
  for (const thread of list) {
    if (!isOutreachThread(thread, recipients)) continue
    const saved = await r.upsertThread({ ...thread, accountId: accountRow.rowId })
    for (const message of thread.messages) await r.upsertMessage(saved.rowId, message)
    await ensureCardForThread(r, saved.rowId)
  }
}

function App() {
  const [view, setView] = useState<View>('inbox')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsed)
  const [repo, setRepo] = useState<Repository | null>(null)
  const [boardVersion, setBoardVersion] = useState(0)
  const [mailbox, setMailbox] = useState<MailboxProvider | null>(null)
  const [ai, setAi] = useState<AiProvider | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [threads, setThreads] = useState<Thread[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
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
  const [signature, setSignature] = useState(() => loadSettings().signature)
  const [composing, setComposing] = useState(false)
  const [inboxOverflowed, setInboxOverflowed] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const inboxRequestRef = useRef(0)
  const loadingMoreRef = useRef(false)
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
      opts: { instruction?: string; priorDraft?: string; signature?: string } = {},
    ) => {
      setGenerating(true); setError(null); setStatus(null)
      try {
        setDraft(await aiProvider.generate({
          thread, ownEmail: acc.ownEmail, tone: nextTone,
          instruction: opts.instruction, priorDraft: opts.priorDraft, signature: opts.signature,
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

  const fetchInbox = useCallback(async (
    box: MailboxProvider, r: Repository | null, pageToken?: string,
  ): Promise<ThreadPage> => {
    if (!r) return { threads: [], nextPageToken: null }
    // Windowed set — used ONLY to build the Gmail query.
    const recipients = recentRecipientEmails(await r.listColdRecipients(), Date.now())
    return box.listThreads({ pageToken, outreachRecipients: recipients })
  }, [])

  const openThreadById = useCallback((threadId: string) => {
    setComposing(false)
    setView('inbox')
    if (mailbox) void openThread(mailbox, threadId)
  }, [mailbox, openThread])

  const connect = useCallback(async () => {
    const request = ++inboxRequestRef.current
    setError(null); setStatus(null); setThreads([]); setSelected(null); setSelectedId(null); setNextPageToken(null)
    setInboxOverflowed(false)
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
      let r: Repository | null = null
      try {
        r = await getRepository()
        setRepo(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }

      if (request === inboxRequestRef.current) setBusy('Loading threads…')
      const page = await fetchInbox(box, r)
      if (request !== inboxRequestRef.current) return
      setThreads(page.threads)
      setNextPageToken(page.nextPageToken)
      setInboxOverflowed(page.overflowed ?? false)
      setBusy(null)
      if (r) {
        try {
          await persistThreads(r, acc, page.threads)
          setBoardVersion((v) => v + 1)
        } catch (err) {
          if (request === inboxRequestRef.current) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }
      }
      if (request !== inboxRequestRef.current) return
      if (page.threads.length > 0) await openThread(box, page.threads[0].id)
    } catch (err) {
      if (request === inboxRequestRef.current) {
        setBusy(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [openThread, fetchInbox])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void connect()
  }, [connect])

  useEffect(() => {
    let active = true
    void getRepository()
      .then((r) => { if (active) setRepo(r) })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [])

  const onColdSent = useCallback((subject: string, to: string, duplicate: boolean, close: boolean) => {
    pushActivity({ kind: 'sent', subject, at: Date.now(), threadId: null })
    setStatus(`Sent to ${to}${duplicate ? ' (you had emailed this address before)' : ''}`)
    if (close) setComposing(false)
  }, [pushActivity])

  const startCompose = useCallback(() => {
    setView('inbox'); setComposing(true); setSelected(null); setSelectedId(null)
    setStatus(null); setError(null)
  }, [])

  const cancelCompose = useCallback(() => setComposing(false), [])

  const navigate = useCallback((next: View) => {
    if (next !== 'inbox') setComposing(false)
    setView(next)
  }, [])

  const onSend = useCallback(async () => {
    if (!mailbox || !selected || draft.trim() === '') return
    setError(null)
    const request = inboxRequestRef.current
    try {
      const sent = await mailbox.send(selected.id, draft.trim())
      setStatus(`Sent to ${sent.to.map((a) => a.email).join(', ')}`)
      pushActivity({ kind: 'sent', subject: selected.subject, tone, at: Date.now(), threadId: selected.id })
      if (request !== inboxRequestRef.current) return
      const page = await fetchInbox(mailbox, repo)
      if (request !== inboxRequestRef.current) return
      setThreads(page.threads)
      setNextPageToken(page.nextPageToken)
      setInboxOverflowed(page.overflowed ?? false)
      const fresh = await mailbox.getThread(selected.id)
      if (request !== inboxRequestRef.current) return
      setSelected(fresh)
    } catch (err) {
      if (request === inboxRequestRef.current) setError(err instanceof Error ? err.message : String(err))
    }
  }, [mailbox, selected, draft, tone, pushActivity, repo, fetchInbox])

  const handleGenerate = useCallback(() => {
    if (selected && ai && account) {
      void generate(ai, account, selected, tone, {
        instruction: instruction || undefined,
        priorDraft: draft || undefined,
        signature: signature || undefined,
      })
    }
  }, [selected, ai, account, tone, instruction, draft, signature, generate])

  const loadMore = useCallback(async () => {
    if (!mailbox || !nextPageToken || loadingMoreRef.current) return
    loadingMoreRef.current = true
    const request = inboxRequestRef.current
    setBusy('Loading more…')
    try {
      const page = await fetchInbox(mailbox, repo, nextPageToken)
      if (request !== inboxRequestRef.current) return
      setThreads((prev) => [...prev, ...page.threads])
      setNextPageToken(page.nextPageToken)
      setInboxOverflowed(page.overflowed ?? false)
      if (repo && account) {
        try {
          await persistThreads(repo, account, page.threads)
          setBoardVersion((v) => v + 1)
        } catch (err) {
          if (request === inboxRequestRef.current) setError(err instanceof Error ? err.message : String(err))
        }
      }
    } catch (err) {
      if (request === inboxRequestRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      loadingMoreRef.current = false
      if (request === inboxRequestRef.current) setBusy(null)
    }
  }, [mailbox, repo, account, nextPageToken, fetchInbox])

  const promptText = useMemo(() => {
    if (!selected) return null
    const system = buildSystemPrompt({ tone, signature: signature || undefined })
    const user = buildUserPrompt({ thread: selected, tone, instruction: instruction || undefined })
    return `SYSTEM\n${system}\n\nUSER\n${user}`
  }, [selected, tone, instruction, signature])

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
        onNavigate={navigate}
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
          {view === 'board' && (
            <BoardView repo={repo} onOpenThread={openThreadById} refreshKey={boardVersion} />
          )}

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
                onSelect={(id) => { setComposing(false); if (mailbox) void openThread(mailbox, id) }}
                hasMore={nextPageToken !== null}
                loadingMore={busy === 'Loading more…'}
                onLoadMore={() => void loadMore()}
                onCompose={startCompose}
                overflowed={inboxOverflowed}
                loading={busy !== null}
                emptyText="No replies yet — send a cold email."
              />
              <section className="reader">
                {composing ? (
                  <ComposePanel
                    ai={ai}
                    mailbox={mailbox}
                    repo={repo}
                    ownEmail={account?.ownEmail ?? ''}
                    signature={signature}
                    testMode={testMode}
                    onSent={onColdSent}
                    onError={setError}
                    onCancel={cancelCompose}
                  />
                ) : selected ? (
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

          {view === 'settings' && (
            <SettingsView onSaved={() => { setSignature(loadSettings().signature); void connect() }} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
