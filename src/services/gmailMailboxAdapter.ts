import type { Account, Message, Thread } from '../domain/types';
import type { MailProvider } from '../mail/mailProvider';
import type {
  MailboxProvider, NewEmailInput, SentNewEmail, ThreadPage, ThreadQueryOptions,
} from './mailbox';
import {
  buildOutreachQuery, chunkRecipientQueries,
  OUTREACH_CAP, OUTREACH_QUERY_BUDGET, OUTREACH_WINDOW_DAYS,
} from '../mail/outreach';
import { isJunkThread } from '../mail/junk';

export type MailProviderFactory = (ownEmail: string) => MailProvider;

function mergeKnown(current: Thread[], extra: Thread[]): Thread[] {
  const keep = extra.filter(
    (t) =>
      !isJunkThread(t) &&
      !t.labels.includes('TRASH') &&
      !t.labels.includes('SPAM') &&
      t.messages.some((m) => m.direction === 'inbound'),
  );
  const byId = new Map([...current, ...keep].map((t) => [t.id, t]));
  return [...byId.values()]
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, OUTREACH_CAP);
}

const KNOWN_TTL_MS = 2 * 60_000;

export class GmailMailboxAdapter implements MailboxProvider {
  private createProvider: MailProviderFactory;
  private provider: MailProvider | null = null;
  private account: Account | null = null;
  // Cached known-thread lookups so the 60s inbox poll doesn't re-fetch every
  // cold thread id on every tick (bounded Gmail quota use).
  private knownCache = new Map<string, { thread: Thread | null; at: number }>();

  constructor(createProvider: MailProviderFactory) {
    this.createProvider = createProvider;
  }

  async connect(force = false): Promise<Account> {
    const bootstrap = this.createProvider('');
    if (force || !(await bootstrap.isAuthed())) await bootstrap.auth();
    const profile = await bootstrap.getProfile();
    this.provider = this.createProvider(profile.emailAddress);
    this.account = {
      provider: 'gmail',
      email: profile.emailAddress,
      ownEmail: profile.emailAddress,
      displayName: profile.emailAddress.split('@')[0],
    };
    return this.account;
  }

  isConnected(): boolean {
    return this.account !== null;
  }

  private requireProvider(): MailProvider {
    if (!this.provider) throw new Error('Gmail is not connected');
    return this.provider;
  }

  private async fetchKnown(provider: MailProvider, known: string[]): Promise<Thread[]> {
    if (known.length === 0) return [];
    const now = Date.now();
    const stale = known.filter((id) => {
      const hit = this.knownCache.get(id);
      return !hit || now - hit.at > KNOWN_TTL_MS;
    });
    if (stale.length > 0) {
      const fetched = await provider.getThreadsByIds(stale);
      for (const id of stale) {
        const thread = fetched.find((t) => t.id === id) ?? null;
        this.knownCache.set(id, { thread, at: now });
      }
    }
    return known
      .map((id) => this.knownCache.get(id)?.thread ?? null)
      .filter((t): t is Thread => t !== null);
  }

  async listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage> {
    const provider = this.requireProvider();
    const recipients = opts?.outreachRecipients;

    if (recipients === undefined) {
      const trashed = opts?.trashed === true;
      const page = await provider.listThreads({
        sinceDays: trashed ? OUTREACH_WINDOW_DAYS : 90,
        cap: 20,
        inInbox: !trashed,
        inTrash: trashed,
        pageToken: opts?.pageToken,
      });
      return { threads: page.threads, nextPageToken: page.nextPageToken ?? null };
    }

    const inTrash = opts?.trashed ?? false;
    const known = inTrash ? [] : (opts?.knownThreadIds ?? []);

    const query = buildOutreachQuery(recipients);
    if (!query) {
      // No recent recipients -> the from: query is empty, but known cold threads
      // can still have replies (older sends / aliases). Fetch those directly.
      const threads = opts?.pageToken ? [] : mergeKnown([], await this.fetchKnown(provider, known));
      return { threads, nextPageToken: null };
    }

    if (query.length <= OUTREACH_QUERY_BUDGET) {
      const args = {
        sinceDays: OUTREACH_WINDOW_DAYS, cap: OUTREACH_CAP, query, inInbox: false, inTrash,
      };
      const clean = (list: Thread[]) => list.filter((t) => !isJunkThread(t));
      let page = await provider.listThreads({ ...args, pageToken: opts?.pageToken });
      let threads = clean(page.threads);
      // A page can be empty (or all junk) while a token exists; skip up to 3 dead pages.
      for (let attempt = 0; threads.length === 0 && page.nextPageToken && attempt < 3; attempt++) {
        page = await provider.listThreads({ ...args, pageToken: page.nextPageToken });
        threads = clean(page.threads);
      }
      const merged = opts?.pageToken ? threads : mergeKnown(threads, await this.fetchKnown(provider, known));
      return { threads: merged, nextPageToken: page.nextPageToken ?? null };
    }

    const queries = chunkRecipientQueries(recipients);
    const perChunk = Math.max(1, Math.floor(OUTREACH_CAP / queries.length));
    const seen = new Set<string>();
    const merged: Thread[] = [];
    for (const chunk of queries) {
      if (merged.length >= OUTREACH_CAP) break;
      const { threads } = await provider.listThreads({
        sinceDays: OUTREACH_WINDOW_DAYS, cap: perChunk, query: chunk, inInbox: false, inTrash,
      });
      for (const thread of threads) {
        if (isJunkThread(thread) || seen.has(thread.id)) continue;
        seen.add(thread.id);
        merged.push(thread);
      }
    }
    merged.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const finalThreads = opts?.pageToken
      ? merged.slice(0, OUTREACH_CAP)
      : mergeKnown(merged.slice(0, OUTREACH_CAP), await this.fetchKnown(provider, known));
    return { threads: finalThreads, nextPageToken: null, overflowed: true };
  }

  async getThread(id: string): Promise<Thread | null> {
    try {
      return await this.requireProvider().getThread(id);
    } catch {
      return null;
    }
  }

  async send(threadId: string, body: string): Promise<Message> {
    const provider = this.requireProvider();
    const ownEmail = this.account?.ownEmail ?? '';
    const thread = await provider.getThread(threadId);
    const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound');
    const recipient = lastInbound?.from
      ?? thread.participants.find((p) => p.email.toLowerCase() !== ownEmail.toLowerCase())
      ?? { email: '' };
    const subject = thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`;

    const result = await provider.send({
      threadId,
      to: [recipient],
      subject,
      bodyText: body,
      inReplyTo: lastInbound?.rfcMessageId,
      references: lastInbound ? [...lastInbound.references, lastInbound.rfcMessageId] : undefined,
    });

    return {
      id: result.messageId,
      rfcMessageId: '',
      references: [],
      from: { email: ownEmail },
      to: [recipient],
      cc: [],
      subject,
      bodyText: body,
      hasListUnsubscribe: false,
      date: Date.now(),
      direction: 'outbound',
    };
  }

  async trashThread(id: string): Promise<void> {
    await this.requireProvider().trashThread(id);
  }

  async untrashThread(id: string): Promise<void> {
    await this.requireProvider().untrashThread(id);
  }

  async sendNew(input: NewEmailInput): Promise<SentNewEmail> {
    const provider = this.requireProvider();
    const ownEmail = this.account?.ownEmail ?? '';
    const result = await provider.send({
      to: [input.to],
      subject: input.subject,
      bodyText: input.bodyText,
      listUnsubscribeMailto: input.listUnsubscribeMailto,
    });
    return {
      threadId: result.threadId,
      message: {
        id: result.messageId,
        rfcMessageId: '',
        references: [],
        from: { email: ownEmail },
        to: [input.to],
        cc: [],
        subject: input.subject,
        bodyText: input.bodyText,
        hasListUnsubscribe: Boolean(input.listUnsubscribeMailto),
        date: Date.now(),
        direction: 'outbound',
      },
    };
  }
}
