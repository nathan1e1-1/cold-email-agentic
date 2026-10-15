import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import type { Account, Thread, TonePreset } from './domain/types'
import type { AiProvider } from './ai/aiProvider'
import type { MailboxProvider } from './services/mailbox'
import { createAiProvider, createMailboxProvider } from './services/providerFactory'
import { SettingsDialog } from './SettingsDialog'
import { ThreadList } from './components/ThreadList'
import { ReaderPane } from './components/ReaderPane'
import { DraftPanel } from './components/DraftPanel'

function App() {
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
  const startedRef = useRef(false)

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

  const openThread = useCallback(async (box: MailboxProvider, id: string) => {
    setSelectedId(id); setStatus(null); setDraft(''); setInstruction('')
    setSelected(await box.getThread(id))
  }, [])

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
      setThreads(await mailbox.listThreads())
      setSelected(await mailbox.getThread(selected.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [mailbox, selected, draft])

  const handleGenerate = useCallback(() => {
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
        <div className="topbar-right">
          <span className="account">
            {account ? (
              <>
                <span className="dot" aria-hidden="true" />
                <span className="account-email">{account.email}</span>
              </>
            ) : (
              <span>Not connected</span>
            )}
          </span>
          <button type="button" className="chip ghost" disabled={busy !== null} onClick={() => void connect()}>
            {account ? 'Refresh' : 'Connect Gmail'}
          </button>
          <button type="button" className="chip ghost" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      {busy && <div className="banner">{busy}</div>}
      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner ok">{status}</div>}

      <div className="workspace">
        <ThreadList
          threads={threads}
          selectedId={selectedId}
          onSelect={(id) => { if (mailbox) void openThread(mailbox, id) }}
        />

        <main className="reader">
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
              />
            </>
          ) : (
            <div className="empty">
              {busy ?? (account ? 'Select a conversation' : 'Connect Gmail to load your inbox.')}
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); void connect() }}
        />
      )}
    </div>
  )
}

export default App
