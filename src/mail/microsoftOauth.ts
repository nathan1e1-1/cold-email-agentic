import {
  MICROSOFT_ENDPOINTS, OUTLOOK_SCOPES, OUTLOOK_STORAGE, OAuthAuthenticator,
  type OAuthConfig,
} from './oauth';
import type { HttpClient } from './httpClient';
import type { ConsentRunner, SecretStore } from './oauth';

export function microsoftOAuthConfig(input: {
  clientId: string; tenant?: string; redirectUri: string;
}): OAuthConfig {
  return {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scopes: OUTLOOK_SCOPES,
    endpoints: MICROSOFT_ENDPOINTS(input.tenant || 'common'),
    storage: OUTLOOK_STORAGE,
  };
}

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function createMicrosoftAuthenticator(deps: {
  http: HttpClient;
  secrets: SecretStore;
  clientId: string;
  tenant?: string;
  redirectUri: string;
  runConsent: ConsentRunner;
  now?: () => number;
}): OAuthAuthenticator {
  const clientId = deps.clientId.trim();
  if (!GUID_RE.test(clientId)) throw new Error('Outlook Client ID must be a GUID');

  let redirect: URL;
  try {
    redirect = new URL(deps.redirectUri);
  } catch {
    throw new Error('Outlook redirect URI must be a loopback http URL');
  }
  if (
    redirect.protocol !== 'http:' ||
    (redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1')
  ) {
    throw new Error('Outlook redirect URI must be a loopback http URL');
  }
  if (redirect.port === '') throw new Error('Outlook redirect URI must include a port');

  return new OAuthAuthenticator({
    http: deps.http,
    secrets: deps.secrets,
    runConsent: deps.runConsent,
    now: deps.now,
    config: microsoftOAuthConfig({
      clientId,
      tenant: deps.tenant,
      redirectUri: deps.redirectUri,
    }),
  });
}
