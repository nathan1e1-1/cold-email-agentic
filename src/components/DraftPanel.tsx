import { useRef, useState } from 'react'
import type { AiProvider } from '../ai/aiProvider'
import type { TonePreset } from '../domain/types'
import { TONE_PRESETS } from '../domain/types'

interface Props {
  ai: AiProvider | null
  generating: boolean
  draft: string
  onDraftChange: (value: string) => void
  tone: TonePreset
  onToneChange: (tone: TonePreset) => void
  instruction: string
  onInstructionChange: (value: string) => void
  onGenerate: () => void
  onSend: () => void
  canSend: boolean
  testMode: boolean
  promptText: string | null
  to: string
  subject: string
  onDisableTestMode: () => void
  open: boolean
  onToggle: (open: boolean) => void
}

export function DraftPanel({
  ai, generating, draft, onDraftChange, tone, onToneChange,
  instruction, onInstructionChange, onGenerate, onSend, canSend, testMode, promptText, to, subject,
  onDisableTestMode, open, onToggle,
}: Props) {
  const [showPrompt, setShowPrompt] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  const toggle = () => {
    if (open) setShowPrompt(false)
    onToggle(!open)
  }

  return (
    <div className={open ? 'composer' : 'composer collapsed'}>
      <div className="composer-topbar">
        <span className="composer-title">Reply to thread</span>
        {ai && (
          <span className={`badge privacy-${ai.descriptor.privacy}`}>
            {ai.descriptor.privacy === 'local' ? 'local model' : 'may use content'}
          </span>
        )}
        {open && generating && <span className="hint">generating…</span>}
        {open && !ai && <span className="hint">add an AI key in Settings</span>}
        <span className="spacer" />
        {open && promptText && (
          <button type="button" className="linkbtn" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? 'Hide prompt' : 'Preview prompt'}
          </button>
        )}
        <button
          type="button"
          id="reply-toggle"
          className="linkbtn"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? 'Minimize' : 'Expand'}
        </button>
      </div>

      {open && (
        <>
          <div className="composer-fields">
            <div className="composer-field">
              <span className="field-label">To</span>
              <span className="field-value">{to || '—'}</span>
            </div>
            <div className="composer-field">
              <span className="field-label">Subject</span>
              <span className="field-value">{subject || '—'}</span>
            </div>
          </div>

          <div className="composer-body">
            {showPrompt && promptText && <pre className="prompt-preview">{promptText}</pre>}

            <div className="tones" role="group" aria-label="Tone">
              {TONE_PRESETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={t === tone ? 'tone active' : 'tone'}
                  disabled={generating}
                  aria-pressed={t === tone}
                  onClick={() => onToneChange(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <textarea
              ref={draftRef}
              id="reply-draft"
              className="draft-text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="Click Generate to draft a reply…"
              aria-label="Draft reply"
              rows={7}
            />

            <div className="draft-controls">
              <input
                className="instruction"
                value={instruction}
                onChange={(e) => onInstructionChange(e.target.value)}
                placeholder="Nudge: shorter, warmer, ask about timing…"
              />
              <button type="button" className="regen" disabled={generating || !ai} onClick={onGenerate}>
                Generate
              </button>
              <button type="button" className="send" disabled={!canSend || generating || testMode} onClick={onSend}>
                Send reply
              </button>
            </div>

            {testMode ? (
              <div className="callout">
                <span>Test mode is on — drafts are never sent.</span>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => { onDisableTestMode(); draftRef.current?.focus() }}
                >
                  Turn off Test mode
                </button>
              </div>
            ) : (
              <span className="hint">Sends a real reply from your mail account.</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
