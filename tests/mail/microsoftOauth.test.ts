import { describe, it, expect } from 'vitest';
import {
  MICROSOFT_ENDPOINTS, OUTLOOK_SCOPES, OUTLOOK_STORAGE,
  buildAuthUrl, exchangeCode, refreshAccessToken, type SecretStore,
} from '../../src/mail/oauth';
import { createMicrosoftAuthenticator } from '../../src/mail/microsoftOauth';
import { FakeHttpClient } from './fakeHttp';

const GUID = '11111111-1111-1111-1111-111111111111';
const LOOPBACK = 'http://127.0.0.1:8766';

function memSecrets(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return {
    get: async (k) => (m.has(k) ? (m.get(k) as string) : null),
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
  };
}

describe('microsoftOauth', () => {
  it('builds a Microsoft auth URL with offline scopes and consent', () => {
    const url = buildAuthUrl({
      clientId: 'cid',
      redirectUri: 'http://127.0.0.1:9/cb',
      challenge: 'CH',
      scopes: OUTLOOK_SCOPES,
      endpoints: MICROSOFT_ENDPOINTS('common'),
    });
    expect(
      url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    ).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('scope')).toContain('offline_access');
    expect(q.get('scope')).toContain('Mail.Send');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('access_type')).toBeNull();
  });

  it('exchanges a code at the Microsoft token endpoint without a client secret', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    });
    const tokens = await exchangeCode(
      {
        code: 'c',
        verifier: 'v',
        redirectUri: 'r',
        clientId: 'cid',
        endpoints: MICROSOFT_ENDPOINTS('common'),
      },
      http,
      1000,
    );
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600_000 });
    expect(http.requests[0].url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    );
    const body = new URLSearchParams(http.requests[0].body);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('code')).toBe('c');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('redirect_uri')).toBe('r');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_secret')).toBeNull();
  });

  it('refreshes at the Microsoft token endpoint', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT2', expires_in: 60 }),
    });
    const tokens = await refreshAccessToken(
      {
        refreshToken: 'RT',
        clientId: 'cid',
        tokenEndpoint: MICROSOFT_ENDPOINTS().tokenEndpoint,
      },
      http,
      5000,
    );
    expect(http.requests[0].url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    );
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.expiresAt).toBe(5000 + 60_000);
  });

  it('rejects invalid tenants instead of falling back', () => {
    expect(() => MICROSOFT_ENDPOINTS('common/../x')).toThrow('Invalid Microsoft tenant');
    expect(() => MICROSOFT_ENDPOINTS('..')).toThrow('Invalid Microsoft tenant');
  });

  it('accepts common, organizations, consumers, GUIDs, and domains', () => {
    for (const tenant of ['common', 'organizations', 'consumers', 'contoso.onmicrosoft.com', GUID]) {
      expect(MICROSOFT_ENDPOINTS(tenant).authEndpoint).toContain(`/${tenant}/`);
    }
  });

  it('rejects a client ID that is not a GUID', () => {
    expect(() =>
      createMicrosoftAuthenticator({
        http: new FakeHttpClient(),
        secrets: memSecrets(),
        clientId: 'cid',
        redirectUri: LOOPBACK,
        runConsent: async () => ({ code: 'c' }),
      }),
    ).toThrow('Outlook Client ID must be a GUID');
  });

  it('rejects a non-loopback redirect URI', () => {
    expect(() =>
      createMicrosoftAuthenticator({
        http: new FakeHttpClient(),
        secrets: memSecrets(),
        clientId: GUID,
        redirectUri: 'https://example.com/callback',
        runConsent: async () => ({ code: 'c' }),
      }),
    ).toThrow('Outlook redirect URI must be a loopback http URL');
  });

  it('requires an explicit loopback port', () => {
    const build = (redirectUri: string) => () =>
      createMicrosoftAuthenticator({
        http: new FakeHttpClient(),
        secrets: memSecrets(),
        clientId: GUID,
        redirectUri,
        runConsent: async () => ({ code: 'c' }),
      });

    expect(build('http://localhost')).toThrow('Outlook redirect URI must include a port');
    expect(build('http://localhost:8766')).not.toThrow();
  });

  it('stores tokens under outlook.* keys on auth', async () => {
    const secrets = memSecrets();
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    });
    const auth = createMicrosoftAuthenticator({
      http,
      secrets,
      clientId: GUID,
      redirectUri: LOOPBACK,
      tenant: 'common',
      runConsent: async () => ({ code: 'c' }),
      now: () => 1000,
    });

    await auth.auth();

    expect(await secrets.get(OUTLOOK_STORAGE.refresh)).toBe('RT');
    expect(await secrets.get(OUTLOOK_STORAGE.access)).toBe('AT');
    expect(await secrets.get(OUTLOOK_STORAGE.expiry)).toBe(String(1000 + 3600_000));
    expect(await auth.isAuthed()).toBe(true);
  });

  it('persists rotated refresh tokens when refreshing an access token', async () => {
    const secrets = memSecrets({ [OUTLOOK_STORAGE.refresh]: 'RT' });
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }),
    });
    const auth = createMicrosoftAuthenticator({
      http,
      secrets,
      clientId: GUID,
      redirectUri: LOOPBACK,
      runConsent: async () => ({ code: 'c' }),
      now: () => 1000,
    });

    expect(await auth.getAccessToken()).toBe('AT2');
    expect(http.requests[0].url).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    );
    expect(await secrets.get(OUTLOOK_STORAGE.access)).toBe('AT2');
    expect(await secrets.get(OUTLOOK_STORAGE.refresh)).toBe('RT2');
  });

  it('disconnect clears all outlook.* keys', async () => {
    const secrets = memSecrets({
      [OUTLOOK_STORAGE.refresh]: 'RT',
      [OUTLOOK_STORAGE.access]: 'AT',
      [OUTLOOK_STORAGE.expiry]: '999999',
    });
    const auth = createMicrosoftAuthenticator({
      http: new FakeHttpClient(),
      secrets,
      clientId: GUID,
      redirectUri: LOOPBACK,
      runConsent: async () => ({ code: 'c' }),
    });

    await auth.disconnect();

    expect(await secrets.get(OUTLOOK_STORAGE.refresh)).toBeNull();
    expect(await secrets.get(OUTLOOK_STORAGE.access)).toBeNull();
    expect(await secrets.get(OUTLOOK_STORAGE.expiry)).toBeNull();
  });
});
