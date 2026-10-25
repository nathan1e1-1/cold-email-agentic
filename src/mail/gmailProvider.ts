import type { Thread } from '../domain/types';
import type { Authenticator } from './oauth';
import type { HttpClient } from './httpClient';
import type {
  DraftInput, GmailProfile, HistoryDelta, ListThreadsResult, MailProvider,
} from './mailProvider';
import { parseThread, type GmailThreadResource } from './gmailParse';
import { buildMime } from './mime';
import { utf8ToBase64Url } from './encoding';
import { mapWithConcurrency } from './concurrency';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_QUOTA_BACKOFF_MS = 60_000;

interface RequestOptions {
  body?: string;
  headers?: Record<string, string>;
}

function describeError(res: { status: number; body: string }): string {
  try {
    const json = JSON.parse(res.body) as { error?: { message?: string; status?: string } };
    if (json.error?.message) return `${json.error.status ?? res.status} — ${json.error.message}`;
  } catch {
    /* fall through to the raw body */
  }
  return `HTTP ${res.status} ${res.body.slice(0, 200)}`;
}

function ensureOk(res: { status: number; body: string }, context: string): void {
  if (res.status >= 400) throw new Error(`${context}: ${describeError(res)}`);
}

function isQuotaError(res: { status: number; body: string }): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  return /quota|rate ?limit|userRateLimit|Quota exceeded/i.test(res.body);
}

export class GmailProvider implements MailProvider {
  private http: HttpClient;
  private authenticator: Authenticator;
  private ownEmail: string;
  private concurrency: number;
  private maxRetries: number;
  private backoffMs: number;
  private throttleMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(deps: {
    http: HttpClient;
    auth: Authenticator;
    ownEmail: string;
    concurrency?: number;
    maxRetries?: number;
    backoffMs?: number;
    throttleMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.http = deps.http;
    this.authenticator = deps.auth;
    this.ownEmail = deps.ownEmail;
    this.concurrency = deps.concurrency ?? 3;
    this.maxRetries = deps.maxRetries ?? 4;
    this.backoffMs = deps.backoffMs ?? 3000;
    this.throttleMs = deps.throttleMs ?? 150;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async auth(): Promise<void> {
    await this.authenticator.auth();
  }

  async isAuthed(): Promise<boolean> {
    return this.authenticator.isAuthed();
  }

  private async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<{ status: number; body: string }> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.authenticator.getAccessToken();
      const res = await this.http.request({
        method,
        url: `${BASE}${path}`,
        headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
        body: opts.body,
      });
      if (isQuotaError(res) && attempt < this.maxRetries) {
        // Gmail's per-minute query budget resets each minute, so wait out the
        // window (capped) rather than giving up after a couple of seconds.
        await this.sleep(Math.min(this.backoffMs * 2 ** attempt, MAX_QUOTA_BACKOFF_MS));
        continue;
      }
      return res;
    }
  }

  async getProfile(): Promise<GmailProfile> {
    const res = await this.request('GET', '/profile');
    ensureOk(res, 'Gmail getProfile');
    const json = JSON.parse(res.body) as { emailAddress?: string; historyId?: string };
    return { emailAddress: json.emailAddress ?? '', historyId: json.historyId ?? '0' };
  }

  async listThreads(opts: {
    sinceDays: number; cap: number; query?: string; pageToken?: string; inInbox?: boolean;
    inTrash?: boolean;
  }): Promise<ListThreadsResult> {
    const junk = ['-category:promotions', '-category:social', '-category:updates', '-category:forums'];
    const base = opts.inTrash
      ? [`in:trash newer_than:${opts.sinceDays}d`, ...junk]
      : opts.inInbox === false
        ? [`newer_than:${opts.sinceDays}d`, '-in:spam', '-in:trash', ...junk]
        : [`in:inbox newer_than:${opts.sinceDays}d`];
    const q = encodeURIComponent([base.join(' '), opts.query].filter(Boolean).join(' '));
    const page = opts.pageToken ? `&pageToken=${encodeURIComponent(opts.pageToken)}` : '';
    const res = await this.request('GET', `/threads?q=${q}&maxResults=${opts.cap}${page}`);
    ensureOk(res, 'Gmail listThreads');
    const json = JSON.parse(res.body) as { threads?: { id: string }[]; nextPageToken?: string };
    const ids = (json.threads ?? []).map((t) => t.id);
    const threads = await mapWithConcurrency(ids, this.concurrency, (id) => this.getThread(id), {
      sleep: this.sleep,
      minIntervalMs: this.throttleMs,
    });
    const profile = await this.getProfile();
    return { threads, seededHistoryId: profile.historyId, nextPageToken: json.nextPageToken ?? null };
  }

  async getThread(id: string): Promise<Thread> {
    const res = await this.request('GET', `/threads/${id}?format=full`);
    ensureOk(res, `Gmail getThread ${id}`);
    return parseThread(JSON.parse(res.body) as GmailThreadResource, this.ownEmail);
  }

  async getThreadsByIds(ids: string[]): Promise<Thread[]> {
    return mapWithConcurrency(ids, this.concurrency, (id) => this.getThread(id), {
      sleep: this.sleep,
      minIntervalMs: this.throttleMs,
    });
  }

  async listHistoryChanges(opts: { historyId: string }): Promise<HistoryDelta> {
    const res = await this.request(
      'GET',
      `/history?startHistoryId=${opts.historyId}&historyTypes=messageAdded,messageDeleted,labelAdded,labelRemoved`,
    );
    if (res.status === 404) {
      return { changedThreadIds: [], deletedThreadIds: [], nextHistoryId: opts.historyId, expired: true };
    }
    ensureOk(res, 'Gmail history');
    const json = JSON.parse(res.body) as {
      historyId?: string;
      history?: {
        messagesAdded?: { message: { threadId: string } }[];
        messagesDeleted?: { message: { threadId: string } }[];
      }[];
    };
    const changed = new Set<string>();
    const deleted = new Set<string>();
    for (const record of json.history ?? []) {
      for (const m of record.messagesAdded ?? []) changed.add(m.message.threadId);
      for (const m of record.messagesDeleted ?? []) deleted.add(m.message.threadId);
    }
    return {
      changedThreadIds: [...changed],
      deletedThreadIds: [...deleted],
      nextHistoryId: json.historyId ?? opts.historyId,
      expired: false,
    };
  }

  async send(input: DraftInput): Promise<{ messageId: string; threadId: string }> {
    const raw = utf8ToBase64Url(
      buildMime({
        from: this.ownEmail,
        to: input.to.map((a) => a.email),
        cc: input.cc?.map((a) => a.email),
        subject: input.subject,
        bodyText: input.bodyText,
        inReplyTo: input.inReplyTo,
        references: input.references,
        listUnsubscribeMailto: input.listUnsubscribeMailto,
      }),
    );
    const res = await this.request('POST', '/messages/send', {
      body: JSON.stringify({ raw, ...(input.threadId ? { threadId: input.threadId } : {}) }),
      headers: { 'Content-Type': 'application/json' },
    });
    ensureOk(res, 'Gmail send');
    const json = JSON.parse(res.body) as { id?: string; threadId?: string };
    return { messageId: json.id ?? '', threadId: json.threadId ?? input.threadId ?? '' };
  }

  async findOwnLatestReply(threadId: string): Promise<{ isReply: boolean }> {
    const thread = await this.getThread(threadId);
    const last = thread.messages[thread.messages.length - 1];
    return { isReply: last?.direction === 'outbound' };
  }

  async trashThread(id: string): Promise<void> {
    ensureOk(await this.request('POST', `/threads/${encodeURIComponent(id)}/trash`), 'Gmail trash');
  }

  async untrashThread(id: string): Promise<void> {
    ensureOk(await this.request('POST', `/threads/${encodeURIComponent(id)}/untrash`), 'Gmail untrash');
  }
}
