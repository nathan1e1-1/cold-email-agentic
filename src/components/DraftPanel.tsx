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
}

export function DraftPanel({
  ai, generating, draft, onDraftChange, tone, onToneChange,
  instruction, onInstructionChange, onGenerate, onSend, canSend,
}: Props) {
  return (
    <div className="draft-panel">
      <div className="draft-head">
        <span className="draft-title">AI draft</span>
        {ai && (
          <span className={`badge privacy-${ai.descriptor.privacy}`}>
            {ai.descriptor.privacy === 'local' ? 'local model' : 'may use content'}
          </span>
        )}
        {generating && <span className="hint">generating…</span>}
        {!ai && <span className="hint">add an AI key in Settings</span>}
      </div>

      <div className="tones">
        {TONE_PRESETS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tone ? 'tone active' : 'tone'}
            disabled={generating}
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
        placeholder="The agent's draft appears here…"
        rows={5}
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
        <button type="button" className="send" disabled={!canSend || generating} onClick={onSend}>
          Send
        </button>
      </div>

      <span className="hint">Sends a real reply from your Gmail account.</span>
    </div>
  )
}
