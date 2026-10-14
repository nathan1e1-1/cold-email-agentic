import { useCallback, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import type { MailboxProvider } from './services/mailbox'
import { createAiProvider, createMailboxProvider, type MailboxMode } from './services/providerFactory'
import { SettingsDialog } from './SettingsDialog'
import { ThreadList } from './components/ThreadList'
import { ReaderPane } from './components/ReaderPane'
import { DraftPanel } from './components/DraftPanel'

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
  const [showSettings, setShowSettings] = useState(false)

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
        const box = await createMailboxProvider(nextMode)
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

  const handleTone = useCallback(
    (next: TonePreset) => {
      setTone(next)
      if (selected && ai && account) void generate(ai, account, selected, next, {})
    },
    [selected, ai, account, generate],
  )

  const handleRegenerate = useCallback(() => {
    if (selected && ai && account) {
      void generate(ai, account, selected, tone, {
        instruction: instruction || undefined,
        priorDraft: draft || undefined,
      })
    }
  }, [selected, ai, account, tone, instruction, draft, generate])

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
            <button type="button" className="chip" onClick={() => setShowSettings(true)}>Settings</button>
          </span>
        </div>
      </header>

      {busy && <div className="banner">{busy}</div>}
      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner ok">{status}</div>}

      <div className="workspace">
        <ThreadList
          threads={threads}
          selectedId={selectedId}
          onSelect={(id) => { if (mailbox && account) void openThread(mailbox, id, ai, account) }}
        />

        <main className="reader">
          {selected ? (
            <>
              <ReaderPane thread={selected} />
              <DraftPanel
                ai={ai}
                mode={mode}
                generating={generating}
                draft={draft}
                onDraftChange={setDraft}
                tone={tone}
                onToneChange={handleTone}
                instruction={instruction}
                onInstructionChange={setInstruction}
                onRegenerate={handleRegenerate}
                onSend={() => void onSend()}
                canSend={canSend}
              />
            </>
          ) : (
            <div className="empty">
              {busy ?? (account ? 'Select a conversation' : 'Click “Gmail” to connect, or “Mock” to try it out.')}
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); void connect(mode) }}
        />
      )}
    </div>
  )
}

export default App
