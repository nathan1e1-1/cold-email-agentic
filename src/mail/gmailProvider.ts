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

export class GmailProvider implements MailProvider {
  private http: HttpClient;
  private authenticator: Authenticator;
  private ownEmail: string;
  private concurrency: number;

  constructor(deps: {
    http: HttpClient;
    auth: Authenticator;
    ownEmail: string;
    concurrency?: number;
  }) {
    this.http = deps.http;
    this.authenticator = deps.auth;
    this.ownEmail = deps.ownEmail;
    this.concurrency = deps.concurrency ?? 5;
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
    const token = await this.authenticator.getAccessToken();
    return this.http.request({
      method,
      url: `${BASE}${path}`,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
      body: opts.body,
    });
  }

  async getProfile(): Promise<GmailProfile> {
    const res = await this.request('GET', '/profile');
    ensureOk(res, 'Gmail getProfile');
    const json = JSON.parse(res.body) as { emailAddress?: string; historyId?: string };
    return { emailAddress: json.emailAddress ?? '', historyId: json.historyId ?? '0' };
  }

  async listThreads(opts: { sinceDays: number; cap: number; query?: string }): Promise<ListThreadsResult> {
    const q = encodeURIComponent(
      [`in:inbox newer_than:${opts.sinceDays}d`, opts.query].filter(Boolean).join(' '),
    );
    const res = await this.request('GET', `/threads?q=${q}&maxResults=${opts.cap}`);
    ensureOk(res, 'Gmail listThreads');
    const json = JSON.parse(res.body) as { threads?: { id: string }[] };
    const ids = (json.threads ?? []).map((t) => t.id);
    const threads = await mapWithConcurrency(ids, this.concurrency, (id) => this.getThread(id));
    const profile = await this.getProfile();
    return { threads, seededHistoryId: profile.historyId };
  }

  async getThread(id: string): Promise<Thread> {
    const res = await this.request('GET', `/threads/${id}?format=full`);
    ensureOk(res, `Gmail getThread ${id}`);
    return parseThread(JSON.parse(res.body) as GmailThreadResource, this.ownEmail);
  }

  async getThreadsByIds(ids: string[]): Promise<Thread[]> {
    return mapWithConcurrency(ids, this.concurrency, (id) => this.getThread(id));
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
}
