import type { HttpClient } from './httpClient';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

const REFRESH_KEY = 'gmail.refresh_token';
const ACCESS_KEY = 'gmail.access_token';
const EXPIRY_KEY = 'gmail.access_expires_at';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Authenticator {
  auth(): Promise<void>;
  isAuthed(): Promise<boolean>;
  getAccessToken(): Promise<string>;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
}

export interface RefreshConfig {
  clientId: string;
  clientSecret?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomVerifier();
  return { verifier, challenge: await challengeFor(verifier) };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scopes?: string[];
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: (params.scopes ?? DEFAULT_SCOPES).join(' '),
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${query.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function parseTokenResponse(body: string, now: number, priorRefresh: string | null): TokenSet {
  let json: TokenResponse;
  try {
    json = JSON.parse(body) as TokenResponse;
  } catch {
    throw new Error('OAuth: malformed token response');
  }
  if (json.error || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? 'OAuth token error');
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? priorRefresh,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeCode(
  params: { code: string; verifier: string } & OAuthConfig,
  http: HttpClient,
  now = Date.now(),
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.verifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
  }).toString();
  const res = await http.request({
    method: 'POST',
    url: TOKEN_ENDPOINT,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseTokenResponse(res.body, now, null);
}

export async function refreshAccessToken(
  params: { refreshToken: string } & RefreshConfig,
  http: HttpClient,
  now = Date.now(),
): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    refresh_token: params.refreshToken,
    grant_type: 'refresh_token',
    ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
  }).toString();
  const res = await http.request({
    method: 'POST',
    url: TOKEN_ENDPOINT,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseTokenResponse(res.body, now, params.refreshToken);
}

export type ConsentRunner = (authUrl: string) => Promise<{ code: string }>;

export class OAuthAuthenticator implements Authenticator {
  private http: HttpClient;
  private secrets: SecretStore;
  private config: OAuthConfig;
  private runConsent: ConsentRunner;
  private clock: () => number;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshToken: string | null | undefined;

  constructor(deps: {
    http: HttpClient;
    secrets: SecretStore;
    config: OAuthConfig;
    runConsent: ConsentRunner;
    now?: () => number;
  }) {
    this.http = deps.http;
    this.secrets = deps.secrets;
    this.config = deps.config;
    this.runConsent = deps.runConsent;
    this.clock = deps.now ?? Date.now;
  }

  async auth(): Promise<void> {
    const { verifier, challenge } = await createPkce();
    const url = buildAuthUrl({
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      challenge,
      scopes: this.config.scopes,
    });
    const { code } = await this.runConsent(url);
    const tokens = await exchangeCode(
      { ...this.config, code, verifier },
      this.http,
      this.clock(),
    );
    this.accessToken = tokens.accessToken;
    this.expiresAt = tokens.expiresAt;
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      await this.secrets.set(REFRESH_KEY, tokens.refreshToken);
    }
    await this.secrets.set(ACCESS_KEY, tokens.accessToken);
    await this.secrets.set(EXPIRY_KEY, String(tokens.expiresAt));
  }

  private async loadRefreshToken(): Promise<string | null> {
    if (this.refreshToken === undefined) {
      this.refreshToken = await this.secrets.get(REFRESH_KEY);
    }
    return this.refreshToken;
  }

  async isAuthed(): Promise<boolean> {
    return (await this.loadRefreshToken()) !== null;
  }

  // The access token is cached in memory so the secret store is read at most
  // once per session, instead of on every Gmail request.
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.clock() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    if (!this.accessToken) {
      const stored = await this.secrets.get(ACCESS_KEY);
      const expiry = Number((await this.secrets.get(EXPIRY_KEY)) ?? '0');
      if (stored && this.clock() < expiry - 60_000) {
        this.accessToken = stored;
        this.expiresAt = expiry;
        return stored;
      }
    }

    const refresh = await this.loadRefreshToken();
    if (!refresh) throw new Error('Not authenticated');
    const tokens = await refreshAccessToken(
      { refreshToken: refresh, clientId: this.config.clientId, clientSecret: this.config.clientSecret },
      this.http,
      this.clock(),
    );
    this.accessToken = tokens.accessToken;
    this.expiresAt = tokens.expiresAt;
    await this.secrets.set(ACCESS_KEY, tokens.accessToken);
    await this.secrets.set(EXPIRY_KEY, String(tokens.expiresAt));
    return tokens.accessToken;
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshToken = null;
    await this.secrets.delete(REFRESH_KEY);
    await this.secrets.delete(ACCESS_KEY);
    await this.secrets.delete(EXPIRY_KEY);
  }
}
