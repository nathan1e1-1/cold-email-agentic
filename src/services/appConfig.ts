import { loadSettings, SECRET_KEYS } from './appSettings';
import { getSecret } from './secrets';

export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string | undefined;
  redirectUri: string;
  aiProvider: 'gemini' | 'groq';
  geminiApiKey: string;
  groqApiKey: string;
}

export async function appConfig(): Promise<AppConfig> {
  const env = import.meta.env as Record<string, string | undefined>;
  const stored = loadSettings();

  const [clientSecret, geminiKey, groqKey] = await Promise.all([
    getSecret(SECRET_KEYS.googleClientSecret),
    getSecret(SECRET_KEYS.geminiApiKey),
    getSecret(SECRET_KEYS.groqApiKey),
  ]);

  return {
    googleClientId: stored.googleClientId || env.VITE_GOOGLE_CLIENT_ID || '',
    googleClientSecret: clientSecret || env.VITE_GOOGLE_CLIENT_SECRET || undefined,
    redirectUri: stored.redirectUri || env.VITE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:8765',
    aiProvider: stored.aiProvider ?? (env.VITE_AI_PROVIDER === 'groq' ? 'groq' : 'gemini'),
    geminiApiKey: geminiKey || env.VITE_GEMINI_API_KEY || '',
    groqApiKey: groqKey || env.VITE_GROQ_API_KEY || '',
  };
}
