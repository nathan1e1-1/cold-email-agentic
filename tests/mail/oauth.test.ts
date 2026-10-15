import { describe, it, expect } from 'vitest';
import {
  challengeFor, createPkce, buildAuthUrl, exchangeCode, refreshAccessToken,
  OAuthAuthenticator, type SecretStore,
} from '../../src/mail/oauth';
import { FakeHttpClient } from './fakeHttp';

// RFC 7636 Appendix B test vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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

describe('oauth', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    expect(await challengeFor(VERIFIER)).toBe(CHALLENGE);
  });

  it('createPkce returns a url-safe verifier and its challenge', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(await challengeFor(verifier));
  });

  it('builds an auth URL with PKCE and offline access', () => {
    const url = buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:9/cb', challenge: 'CH' });
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('client_id')).toBe('cid');
    expect(q.get('code_challenge')).toBe('CH');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('scope')).toContain('gmail.readonly');
    expect(q.get('scope')).toContain('gmail.send');
  });

  it('exchanges a code for tokens', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    });
    const tokens = await exchangeCode(
      { code: 'c', verifier: VERIFIER, redirectUri: 'r', clientId: 'cid' },
      http,
      1000,
    );
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600_000 });
    expect(http.requests[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(http.requests[0].body).toContain('code_verifier=');
  });

  it('throws on a token error response', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 400,
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' }),
    });
    await expect(
      exchangeCode({ code: 'c', verifier: VERIFIER, redirectUri: 'r', clientId: 'cid' }, http),
    ).rejects.toThrow(/bad code/);
  });

  it('refreshes keeping the refresh token', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT2', expires_in: 60 }),
    });
    const tokens = await refreshAccessToken({ refreshToken: 'RT', clientId: 'cid' }, http, 5000);
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.expiresAt).toBe(5000 + 60_000);
  });

  it('OAuthAuthenticator stores tokens on auth and returns a cached token', async () => {
    const secrets = memSecrets();
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    });
    const auth = new OAuthAuthenticator({
      http,
      secrets,
      config: { clientId: 'cid', redirectUri: 'r' },
      runConsent: async () => ({ code: 'c' }),
      now: () => 1000,
    });
    await auth.auth();
    expect(await auth.isAuthed()).toBe(true);
    expect(await auth.getAccessToken()).toBe('AT');
    expect(http.requests.length).toBe(1);
  });

  it('OAuthAuthenticator refreshes an expired access token', async () => {
    let clock = 1000;
    const secrets = memSecrets({
      'gmail.refresh_token': 'RT',
      'gmail.access_token': 'OLD',
      'gmail.access_expires_at': '2000',
    });
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'NEW', expires_in: 3600 }),
    });
    const auth = new OAuthAuthenticator({
      http,
      secrets,
      config: { clientId: 'cid', redirectUri: 'r' },
      runConsent: async () => ({ code: 'c' }),
      now: () => clock,
    });
    expect(await auth.getAccessToken()).toBe('NEW');
    clock = 999_999;
    expect(await auth.getAccessToken()).toBe('NEW');
    expect(http.requests.length).toBe(1);
  });

  it('OAuthAuthenticator throws when not authenticated', async () => {
    const auth = new OAuthAuthenticator({
      http: new FakeHttpClient(),
      secrets: memSecrets(),
      config: { clientId: 'cid', redirectUri: 'r' },
      runConsent: async () => ({ code: 'c' }),
    });
    await expect(auth.getAccessToken()).rejects.toThrow(/Not authenticated/);
  });

  it('caches the access token so the keychain is not read per request', async () => {
    let reads = 0;
    const secrets: SecretStore = {
      get: async (key) => {
        reads += 1;
        const store: Record<string, string> = {
          'gmail.access_token': 'AT',
          'gmail.access_expires_at': String(Date.now() + 3_600_000),
        };
        return store[key] ?? null;
      },
      set: async () => {},
      delete: async () => {},
    };
    const auth = new OAuthAuthenticator({
      http: new FakeHttpClient(),
      secrets,
      config: { clientId: 'cid', redirectUri: 'r' },
      runConsent: async () => ({ code: 'c' }),
    });
    expect(await auth.getAccessToken()).toBe('AT');
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    expect(await auth.getAccessToken()).toBe('AT');
    expect(reads).toBe(afterFirst);
  });
});
