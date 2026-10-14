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

export async function createMailboxProvider(mode: MailboxMode): Promise<MailboxProvider> {
  if (mode === 'mock') return new MockMailboxProvider();

  const cfg = await appConfig();
  if (!cfg.googleClientId) throw new Error('Add your Google Client ID in Settings (gear icon)');

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

export async function createAiProvider(): Promise<AiProvider> {
  const cfg = await appConfig();
  const http = new TauriHttpClient();
  if (cfg.aiProvider === 'groq' && cfg.groqApiKey) {
    return new GroqProvider({ http, apiKey: cfg.groqApiKey });
  }
  if (cfg.geminiApiKey) return new GeminiProvider({ http, apiKey: cfg.geminiApiKey });
  if (cfg.groqApiKey) return new GroqProvider({ http, apiKey: cfg.groqApiKey });
  throw new Error('Add a Gemini or Groq API key in Settings (gear icon)');
}
