import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import { buildSystemPrompt, buildUserPrompt } from './ai/prompt'
import type { MailboxProvider, ThreadPage } from './services/mailbox'
import { mergeThreadPages } from './services/mailbox'
import { excludeOwnEmail, isRelevantThread, recentRecipientEmails } from './mail/outreach'
import { AUTO_REFRESH_TICK_MS, shouldAutoRefresh } from './mail/autoRefresh'
import { createAiProvider, createMailboxProvider } from './services/providerFactory'
import { Sidebar, type ActivityItem, type View } from './components/Sidebar'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { TrashView } from './views/TrashView'
import { BoardView } from './views/BoardView'
import { ensureCardForThread } from './services/kanban'
import { loadSettings } from './services/appSettings'
import { onGlobalError } from './services/errorBus'
import { getRepository } from './db/repositoryFactory'
import type { Repository } from './db/repository'
import { ThreadList } from './components/ThreadList'
import { ComposePanel } from './components/ComposePanel'
import { ReaderPane } from './components/ReaderPane'
import { DraftPanel } from './components/DraftPanel'
import { initials } from './lib/format'

const VIEW_TITLE: Record<View, string> = {
  board: 'Board',
  inbox: 'Inbox',
  dashboard: 'Dashboard',
  trash: 'Trash',
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

const isPermissionError = (msg: string) => /40[13]|insufficient|permission/i.test(msg)
const RECONNECT_HINT = 'Reconnect Gmail in Settings to enable deleting, then try again.'

async function persistThreads(r: Repository, acc: Account, list: Thread[]): Promise<void> {
  const accountRow = await r.upsertAccount({
    provider: 'gmail', email: acc.email, ownEmail: acc.ownEmail, tokenRef: 'gmail', createdAt: Date.now(),
  })
  // Full, unwindowed set: older leads must keep their cards.
  const recipients = new Set((await r.listColdRecipients()).map((c) => c.email))
  const known = new Set(await r.listColdThreadIds())
  for (const thread of list) {
    if (!isRelevantThread(thread, recipients, known)) continue
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
  const [trashThreads, setTrashThreads] = useState<Thread[]>([])
  const [trashToken, setTrashToken] = useState<string | null>(null)
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashActionBusy, setTrashActionBusy] = useState(false)
  const [trashLoaded, setTrashLoaded] = useState(false)
  const [trashOverflowed, setTrashOverflowed] = useState(false)
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
  const selectedIdRef = useRef<string | null>(null)
  const autoBusyRef = useRef(false)
  const lastAutoRefreshRef = useRef(0)
  const busyRef = useRef<string | null>(null)

  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => onGlobalError((message) => setError(message)), [])

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
    box: MailboxProvider, r: Repository | null, pageToken?: string, includeSelf = testMode,
  ): Promise<ThreadPage> => {
    if (!r) return { threads: [], nextPageToken: null }
    // Windowed set — used ONLY to build the Gmail query.
    let recipients = recentRecipientEmails(await r.listColdRecipients(), Date.now())
    if (!includeSelf) {
      const acc = await r.getAccount()
      recipients = excludeOwnEmail(recipients, acc?.ownEmail)
    }
    const known = await r.listColdThreadIds()
    return box.listThreads({ pageToken, outreachRecipients: recipients, knownThreadIds: known })
  }, [testMode])

  const fetchTrash = useCallback(async (pageToken?: string, includeSelf = testMode): Promise<ThreadPage | null> => {
    if (!mailbox || !repo) return null
    let recipients = recentRecipientEmails(await repo.listColdRecipients(), Date.now())
    if (!includeSelf) {
      const acc = await repo.getAccount()
      recipients = excludeOwnEmail(recipients, acc?.ownEmail)
    }
    return mailbox.listThreads({ pageToken, outreachRecipients: recipients, trashed: true })
  }, [mailbox, repo, testMode])

  const reloadInbox = useCallback(async (includeSelf: boolean) => {
    if (!mailbox || !repo) return
    setBusy('Loading threads…')
    setError(null)
    try {
      const page = await fetchInbox(mailbox, repo, undefined, includeSelf)
      setThreads(page.threads)
      setNextPageToken(page.nextPageToken)
      setInboxOverflowed(page.overflowed ?? false)
      setSelected(null); setSelectedId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [mailbox, repo, fetchInbox])

  const onTestModeChange = useCallback((next: boolean) => {
    setTestMode(next)
    void reloadInbox(next)
  }, [reloadInbox])

  const openThreadById = useCallback((threadId: string) => {
    setComposing(false)
    setView('inbox')
    if (mailbox) void openThread(mailbox, threadId)
  }, [mailbox, openThread])

  const connect = useCallback(async (force = false) => {
    const request = ++inboxRequestRef.current
    setError(null); setStatus(null); setThreads([]); setSelected(null); setSelectedId(null); setNextPageToken(null)
    setInboxOverflowed(false)
    setDraft(''); setInstruction('')
    setBusy('Connecting to Gmail…')
    try {
      const box = await createMailboxProvider()
      const acc = await box.connect(force)
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

  // Silent auto-refresh: poll while visible (throttled) and refresh on focus,
  // so replies appear without the user pressing Refresh. Never shows a spinner
  // and never clears the current selection or draft.
  useEffect(() => {
    if (!mailbox || !repo) return
    let active = true

    const tick = async () => {
      const visibility = typeof document !== 'undefined' ? document.visibilityState : 'visible'
      if (busyRef.current) return
      if (!shouldAutoRefresh(visibility, lastAutoRefreshRef.current, Date.now(), autoBusyRef.current)) return
      autoBusyRef.current = true
      lastAutoRefreshRef.current = Date.now()
      try {
        const page = await fetchInbox(mailbox, repo, undefined, testMode)
        if (!active) return
        setThreads(page.threads)
        setNextPageToken(page.nextPageToken)
        setInboxOverflowed(page.overflowed ?? false)
        const id = selectedIdRef.current
        if (id) {
          const refreshed = await mailbox.getThread(id)
          if (active && refreshed) setSelected(refreshed)
        }
      } catch {
        /* silent: a manual Refresh surfaces the error */
      } finally {
        autoBusyRef.current = false
      }
    }

    const interval = window.setInterval(() => void tick(), AUTO_REFRESH_TICK_MS)
    const onFocus = () => void tick()
    const onVisibility = () => { if (document.visibilityState === 'visible') void tick() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mailbox, repo, fetchInbox, testMode])

  useEffect(() => {
    let active = true
    void getRepository()
      .then((r) => { if (active) setRepo(r) })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (view !== 'trash' || !mailbox || !repo) return
    let active = true
    void fetchTrash()
      .then((page) => {
        if (!active || !page) return
        setTrashThreads(page.threads)
        setTrashToken(page.nextPageToken)
        setTrashOverflowed(page.overflowed ?? false)
        setTrashLoaded(true)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : String(err))
        setTrashLoaded(true)
      })
    return () => { active = false }
  }, [view, mailbox, repo, fetchTrash])

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
    if (next === 'trash' && view !== 'trash') {
      setTrashBusy(false)
      setTrashLoaded(false)
      setError(null)
    }
    setView(next)
  }, [view])

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
      setThreads((prev) => mergeThreadPages(prev, page.threads))
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

  const loadMoreTrash = useCallback(async () => {
    if (!trashToken || trashBusy) return
    setTrashBusy(true)
    try {
      const page = await fetchTrash(trashToken)
      if (!page) return
      setTrashThreads((prev) => [...prev, ...page.threads])
      setTrashToken(page.nextPageToken)
      setTrashOverflowed(page.overflowed ?? false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTrashBusy(false)
    }
  }, [trashToken, trashBusy, fetchTrash])

  const trashSelected = useCallback(async () => {
    if (!mailbox || !repo || !selected || trashActionBusy) return
    const targetId = selected.id
    setTrashActionBusy(true)
    setError(null)
    try {
      await mailbox.trashThread(targetId)
      await repo.deleteThreadByProviderId(targetId)
      setThreads((prev) => prev.filter((t) => t.id !== targetId))
      setSelected((cur) => (cur?.id === targetId ? null : cur))
      setSelectedId((cur) => (cur === targetId ? null : cur))
      setActivity((prev) => prev.filter((a) => a.threadId !== targetId))
      setStatus('Moved to Trash')
      setBoardVersion((v) => v + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(isPermissionError(msg) ? RECONNECT_HINT : msg)
    } finally {
      setTrashActionBusy(false)
    }
  }, [mailbox, repo, selected, trashActionBusy])

  const restoreThread = useCallback(async (id: string) => {
    if (!mailbox || !repo || trashActionBusy) return
    const request = inboxRequestRef.current
    setError(null)
    setTrashActionBusy(true)
    try {
      await mailbox.untrashThread(id)
      setTrashThreads((prev) => prev.filter((t) => t.id !== id))
      const page = await fetchInbox(mailbox, repo)
      if (request !== inboxRequestRef.current) return
      setThreads(page.threads)
      setNextPageToken(page.nextPageToken)
      setInboxOverflowed(page.overflowed ?? false)
      if (account) {
        await persistThreads(repo, account, page.threads)
        setBoardVersion((v) => v + 1)
      }
      setStatus('Restored to Inbox')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(isPermissionError(msg) ? RECONNECT_HINT : msg)
    } finally {
      setTrashActionBusy(false)
    }
  }, [mailbox, repo, account, fetchInbox, trashActionBusy])

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
            <span className={account ? 'topbar-status connected' : 'topbar-status'}>
              <span className="status-dot" aria-hidden="true" />
              {account ? 'Synced' : 'Not connected'}
            </span>
            <label className="toggle switch">
              <input type="checkbox" checked={testMode} onChange={(e) => onTestModeChange(e.target.checked)} />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-label">Test mode</span>
            </label>
            <span className="topbar-avatar" aria-hidden="true" title={account?.email ?? 'Not connected'}>
              {initials(account?.email ?? 'ColdEmailAgentic')}
            </span>
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

          {view === 'trash' && (
            <TrashView
              threads={trashThreads}
              busy={trashActionBusy || trashBusy || busy !== null}
              ready={mailbox !== null && repo !== null}
              loading={!trashLoaded}
              overflowed={trashOverflowed}
              hasMore={trashToken !== null}
              onLoadMore={() => void loadMoreTrash()}
              onRestore={(id) => void restoreThread(id)}
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
                    <ReaderPane thread={selected} onTrash={() => void trashSelected()} trashBusy={trashActionBusy} />
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
            <SettingsView onSaved={() => { setSignature(loadSettings().signature); void connect() }} onReconnect={() => void connect(true)} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
