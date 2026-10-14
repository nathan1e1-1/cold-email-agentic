export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string | undefined;
  redirectUri: string;
  aiProvider: 'gemini' | 'groq';
  geminiApiKey: string;
  groqApiKey: string;
}

export function appConfig(): AppConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    googleClientId: env.VITE_GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: env.VITE_GOOGLE_CLIENT_SECRET || undefined,
    redirectUri: env.VITE_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:8765',
    aiProvider: env.VITE_AI_PROVIDER === 'groq' ? 'groq' : 'gemini',
    geminiApiKey: env.VITE_GEMINI_API_KEY ?? '',
    groqApiKey: env.VITE_GROQ_API_KEY ?? '',
  };
}
