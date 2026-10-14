import type { AiProvider } from '../ai/aiProvider';
import { GeminiProvider } from '../ai/geminiProvider';
import { GroqProvider } from '../ai/groqProvider';
import { GmailProvider } from '../mail/gmailProvider';
import { OAuthAuthenticator } from '../mail/oauth';
import { TauriHttpClient } from '../mail/tauriHttp';
import { createTauriConsentRunner } from '../mail/tauriConsent';
import { appConfig } from './appConfig';
import { GmailMailboxAdapter } from './gmailMailboxAdapter';
import { keychainSecretStore } from './keychainSecretStore';
import type { MailboxProvider } from './mailbox';
import { MockMailboxProvider } from './mockMailbox';

export type MailboxMode = 'mock' | 'gmail';

export function createMailboxProvider(mode: MailboxMode): MailboxProvider {
  if (mode === 'mock') return new MockMailboxProvider();

  const cfg = appConfig();
  if (!cfg.googleClientId) throw new Error('Set VITE_GOOGLE_CLIENT_ID in .env to connect Gmail');

  const http = new TauriHttpClient();
  const createProvider = (ownEmail: string) => {
    const authenticator = new OAuthAuthenticator({
      http,
      secrets: keychainSecretStore,
      config: {
        clientId: cfg.googleClientId,
        clientSecret: cfg.googleClientSecret,
        redirectUri: cfg.redirectUri,
      },
      runConsent: createTauriConsentRunner(cfg.redirectUri),
    });
    return new GmailProvider({ http, auth: authenticator, ownEmail });
  };

  return new GmailMailboxAdapter(createProvider);
}

export function createAiProvider(): AiProvider {
  const cfg = appConfig();
  const http = new TauriHttpClient();
  if (cfg.aiProvider === 'groq' && cfg.groqApiKey) {
    return new GroqProvider({ http, apiKey: cfg.groqApiKey });
  }
  if (cfg.geminiApiKey) return new GeminiProvider({ http, apiKey: cfg.geminiApiKey });
  if (cfg.groqApiKey) return new GroqProvider({ http, apiKey: cfg.groqApiKey });
  throw new Error('Set VITE_GEMINI_API_KEY or VITE_GROQ_API_KEY in .env to draft replies');
}
