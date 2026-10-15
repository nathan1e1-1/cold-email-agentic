export interface StoredSettings {
  googleClientId: string;
  redirectUri: string;
  aiProvider: 'gemini' | 'groq';
  mailingAddress: string;
  unsubscribeLine: string;
}

export const SECRET_KEYS = {
  googleClientSecret: 'google_client_secret',
  geminiApiKey: 'gemini_api_key',
  groqApiKey: 'groq_api_key',
} as const;

const STORAGE_KEY = 'coldemailagentic.settings';

const DEFAULTS: StoredSettings = {
  googleClientId: '',
  redirectUri: 'http://127.0.0.1:8765',
  aiProvider: 'groq',
  mailingAddress: '',
  unsubscribeLine: 'If you would rather not hear from me, just reply "unsubscribe".',
};

export function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StoredSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: StoredSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
