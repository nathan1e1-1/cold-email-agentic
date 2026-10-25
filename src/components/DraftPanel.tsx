import { useState } from 'react'
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
}

export function DraftPanel({
  ai, generating, draft, onDraftChange, tone, onToneChange,
  instruction, onInstructionChange, onGenerate, onSend, canSend, testMode, promptText, to, subject,
}: Props) {
  const [showPrompt, setShowPrompt] = useState(false)

  return (
    <div className="composer">
      <div className="composer-topbar">
        <span className="composer-title">Reply</span>
        {ai && (
          <span className={`badge privacy-${ai.descriptor.privacy}`}>
            {ai.descriptor.privacy === 'local' ? 'local model' : 'may use content'}
          </span>
        )}
        {generating && <span className="hint">generating…</span>}
        {!ai && <span className="hint">add an AI key in Settings</span>}
        <span className="spacer" />
        {promptText && (
          <button type="button" className="linkbtn" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? 'Hide prompt' : 'Preview prompt'}
          </button>
        )}
      </div>

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
            Send
          </button>
        </div>

        <span className="hint">
          {testMode
            ? 'Test mode is on — drafts are never sent. Generate freely.'
            : 'Sends a real reply from your Gmail account.'}
        </span>
      </div>
    </div>
  )
}
