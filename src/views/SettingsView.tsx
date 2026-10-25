import { useState } from 'react'
import { loadSettings, saveSettings, SECRET_KEYS, type StoredSettings } from '../services/appSettings'
import { setSecret } from '../services/secrets'
import { applyTheme, loadTheme, saveTheme, type Theme } from '../services/theme'

export function SettingsView({ onSaved, onReconnect }: { onSaved: () => void; onReconnect: () => void }) {
  const [settings, setSettings] = useState<StoredSettings>(loadSettings())
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [clientSecret, setClientSecret] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [groqKey, setGroqKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      saveSettings(settings)
      if (clientSecret) await setSecret(SECRET_KEYS.googleClientSecret, clientSecret)
      if (geminiKey) await setSecret(SECRET_KEYS.geminiApiKey, geminiKey)
      if (groqKey) await setSecret(SECRET_KEYS.groqApiKey, groqKey)
      setClientSecret(''); setGeminiKey(''); setGroqKey('')
      setSaved(true)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const setThemeMode = (dark: boolean) => {
    const next: Theme = dark ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
    saveTheme(next)
  }

  return (
    <div className="view settings-view">
      <header className="page-head">
        <div className="page-head-main">
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">Credentials, AI keys, and writing preferences. Secrets are stored locally in a 0600 file on this Mac.</p>
        </div>
      </header>

      <div className="card settings-card">
        <div className="card-head">
          <div className="card-head-main">
            <span className="card-title">Appearance</span>
            <span className="card-sub">Choose how the app looks</span>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="settings-row-title">Dark mode</span>
            <span className="settings-row-sub">Use the darker palette across the app</span>
          </div>
          <label className="toggle switch">
            <input
              type="checkbox"
              aria-label="Dark mode"
              checked={theme === 'dark'}
              onChange={(e) => setThemeMode(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span className="switch-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </label>
        </div>
      </div>

      <div className="card settings-card">
        <div className="card-head">
          <div className="card-head-main">
            <span className="card-title">Gmail</span>
            <span className="card-sub">OAuth credentials for sending and syncing</span>
          </div>
        </div>
        <label className="field">
          <span>Google Client ID</span>
          <input
            value={settings.googleClientId}
            onChange={(e) => setSettings({ ...settings, googleClientId: e.target.value })}
            placeholder="1234-abc.apps.googleusercontent.com"
          />
        </label>
        <label className="field">
          <span>Google Client Secret <em>· stored locally, leave blank to keep</em></span>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" />
        </label>
        <label className="field">
          <span>OAuth redirect URI</span>
          <input value={settings.redirectUri} onChange={(e) => setSettings({ ...settings, redirectUri: e.target.value })} />
        </label>
        <div className="settings-actions">
          <button type="button" className="btn btn-secondary" onClick={onReconnect}>Reconnect Gmail</button>
        </div>
      </div>

      <div className="card settings-card">
        <div className="card-head">
          <div className="card-head-main">
            <span className="card-title">AI drafter</span>
            <span className="card-sub">Choose the model that writes your replies</span>
          </div>
        </div>
        <label className="field">
          <span>Provider</span>
          <select
            value={settings.aiProvider}
            onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value === 'groq' ? 'groq' : 'gemini' })}
          >
            <option value="groq">Groq (free — recommended)</option>
            <option value="gemini">Gemini (free tier)</option>
          </select>
        </label>
        <label className="field">
          <span>Groq API key <em>· stored locally, leave blank to keep</em></span>
          <input type="password" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} placeholder="gsk_…" />
        </label>
        <label className="field">
          <span>Gemini API key <em>· stored locally, optional</em></span>
          <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIza…" />
        </label>
      </div>

      <div className="card settings-card">
        <div className="card-head">
          <div className="card-head-main">
            <span className="card-title">Writing</span>
            <span className="card-sub">Defaults applied to generated drafts</span>
          </div>
        </div>
        <label className="field">
          <span>Signature <em>· appended to generated drafts</em></span>
          <input
            value={settings.signature}
            onChange={(e) => setSettings({ ...settings, signature: e.target.value })}
            placeholder="— Nathan"
          />
        </label>
      </div>

      {error && <div className="banner error">{error}</div>}
      {saved && !error && <div className="banner ok">Saved.</div>}

      <div className="view-actions">
        <button type="button" className="send" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
