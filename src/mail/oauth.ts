import type { HttpClient } from './httpClient';

export interface OAuthEndpoints {
  authEndpoint: string;
  tokenEndpoint: string;
  extraAuthParams?: Record<string, string>;
}

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
};

export const MICROSOFT_ENDPOINTS = (tenant = 'common'): OAuthEndpoints => {
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(tenant)) {
    throw new Error('Invalid Microsoft tenant');
  }
  return {
    authEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    extraAuthParams: { prompt: 'consent' },
  };
};

export const OUTLOOK_SCOPES = [
  'offline_access', 'User.Read', 'Mail.Read', 'Mail.Send', 'Mail.ReadWrite',
];

export interface OAuthStorageKeys { refresh: string; access: string; expiry: string }
export const GOOGLE_STORAGE: OAuthStorageKeys = {
  refresh: 'gmail.refresh_token', access: 'gmail.access_token', expiry: 'gmail.access_expires_at',
};
export const OUTLOOK_STORAGE: OAuthStorageKeys = {
  refresh: 'outlook.refresh_token', access: 'outlook.access_token', expiry: 'outlook.access_expires_at',
};

export const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

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
  endpoints?: OAuthEndpoints;
  storage?: OAuthStorageKeys;
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
  endpoints?: OAuthEndpoints;
}): string {
  const endpoints = params.endpoints ?? GOOGLE_ENDPOINTS;
  const query = new URLSearchParams({
    ...(endpoints.extraAuthParams ?? {}),
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: (params.scopes ?? DEFAULT_SCOPES).join(' '),
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
  });
  return `${endpoints.authEndpoint}?${query.toString()}`;
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
    url: params.endpoints?.tokenEndpoint ?? GOOGLE_ENDPOINTS.tokenEndpoint,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseTokenResponse(res.body, now, null);
}

export async function refreshAccessToken(
  params: { refreshToken: string; tokenEndpoint?: string } & RefreshConfig,
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
    url: params.tokenEndpoint ?? GOOGLE_ENDPOINTS.tokenEndpoint,
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
  private storage: OAuthStorageKeys;
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
    this.storage = deps.config.storage ?? GOOGLE_STORAGE;
  }

  async auth(): Promise<void> {
    const { verifier, challenge } = await createPkce();
    const url = buildAuthUrl({
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      challenge,
      scopes: this.config.scopes,
      endpoints: this.config.endpoints,
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
      await this.secrets.set(this.storage.refresh, tokens.refreshToken);
    }
    await this.secrets.set(this.storage.access, tokens.accessToken);
    await this.secrets.set(this.storage.expiry, String(tokens.expiresAt));
  }

  private async loadRefreshToken(): Promise<string | null> {
    if (this.refreshToken === undefined) {
      this.refreshToken = await this.secrets.get(this.storage.refresh);
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
      const stored = await this.secrets.get(this.storage.access);
      const expiry = Number((await this.secrets.get(this.storage.expiry)) ?? '0');
      if (stored && this.clock() < expiry - 60_000) {
        this.accessToken = stored;
        this.expiresAt = expiry;
        return stored;
      }
    }

    const refresh = await this.loadRefreshToken();
    if (!refresh) throw new Error('Not authenticated');
    const tokens = await refreshAccessToken(
      {
        refreshToken: refresh,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        tokenEndpoint: this.config.endpoints?.tokenEndpoint,
      },
      this.http,
      this.clock(),
    );
    if (tokens.refreshToken && tokens.refreshToken !== refresh) {
      this.refreshToken = tokens.refreshToken;
      await this.secrets.set(this.storage.refresh, tokens.refreshToken);
    }
    this.accessToken = tokens.accessToken;
    this.expiresAt = tokens.expiresAt;
    await this.secrets.set(this.storage.access, tokens.accessToken);
    await this.secrets.set(this.storage.expiry, String(tokens.expiresAt));
    return tokens.accessToken;
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshToken = null;
    await this.secrets.delete(this.storage.refresh);
    await this.secrets.delete(this.storage.access);
    await this.secrets.delete(this.storage.expiry);
  }
}
