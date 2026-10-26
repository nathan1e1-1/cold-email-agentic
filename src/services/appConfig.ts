import { hasStoredSettings, loadSettings, SECRET_KEYS } from './appSettings';
import { getSecret } from './secrets';

export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string | undefined;
  redirectUri: string;
  aiProvider: 'gemini' | 'groq';
  geminiApiKey: string;
  groqApiKey: string;
  mailProvider: 'gmail' | 'outlook';
  outlookClientId: string;
  outlookTenant: string;
  outlookRedirectUri: string;
}

export async function appConfig(): Promise<AppConfig> {
  const env = import.meta.env as Record<string, string | undefined>;
  const stored = loadSettings();
  const hasStored = hasStoredSettings();
  const storedOutlookClientId = stored.outlookClientId.trim();
  const storedOutlookTenant = stored.outlookTenant.trim();
  const storedOutlookRedirectUri = stored.outlookRedirectUri.trim();

  const [clientSecret, geminiKey, groqKey] = await Promise.all([
    getSecret(SECRET_KEYS.googleClientSecret),
    getSecret(SECRET_KEYS.geminiApiKey),
    getSecret(SECRET_KEYS.groqApiKey),
  ]);

  return {
    googleClientId: stored.googleClientId || env.VITE_GOOGLE_CLIENT_ID || '',
    googleClientSecret: clientSecret || env.VITE_GOOGLE_CLIENT_SECRET || undefined,
    redirectUri: stored.redirectUri || env.VITE_OAUTH_REDIRECT_URI || 'http://127.0.0.1:8765',
    aiProvider: stored.aiProvider ?? (env.VITE_AI_PROVIDER === 'gemini' ? 'gemini' : 'groq'),
    geminiApiKey: geminiKey || env.VITE_GEMINI_API_KEY || '',
    groqApiKey: groqKey || env.VITE_GROQ_API_KEY || '',
    mailProvider: hasStored
      ? stored.mailProvider
      : (env.VITE_MAIL_PROVIDER === 'outlook' ? 'outlook' : 'gmail'),
    outlookClientId: storedOutlookClientId || (env.VITE_OUTLOOK_CLIENT_ID || '').trim(),
    outlookTenant: hasStored && storedOutlookTenant
      ? storedOutlookTenant
      : ((env.VITE_OUTLOOK_TENANT || '').trim() || 'common'),
    outlookRedirectUri: hasStored && storedOutlookRedirectUri
      ? storedOutlookRedirectUri
      : ((env.VITE_OUTLOOK_REDIRECT_URI || '').trim() || 'http://localhost:8766'),
  };
}
