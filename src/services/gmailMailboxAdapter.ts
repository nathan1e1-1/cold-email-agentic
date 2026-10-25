import type { Account, Message, Thread } from '../domain/types';
import type { MailProvider } from '../mail/mailProvider';
import type {
  MailboxProvider, NewEmailInput, SentNewEmail, ThreadPage, ThreadQueryOptions,
} from './mailbox';
import {
  buildOutreachQuery, chunkRecipientQueries,
  OUTREACH_CAP, OUTREACH_QUERY_BUDGET, OUTREACH_WINDOW_DAYS,
} from '../mail/outreach';

export type MailProviderFactory = (ownEmail: string) => MailProvider;

export class GmailMailboxAdapter implements MailboxProvider {
  private createProvider: MailProviderFactory;
  private provider: MailProvider | null = null;
  private account: Account | null = null;

  constructor(createProvider: MailProviderFactory) {
    this.createProvider = createProvider;
  }

  async connect(): Promise<Account> {
    const bootstrap = this.createProvider('');
    if (!(await bootstrap.isAuthed())) await bootstrap.auth();
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

  async listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage> {
    const provider = this.requireProvider();
    const recipients = opts?.outreachRecipients;

    if (recipients === undefined) {
      const page = await provider.listThreads({
        sinceDays: 90, cap: 20, pageToken: opts?.pageToken,
      });
      return { threads: page.threads, nextPageToken: page.nextPageToken ?? null };
    }

    const query = buildOutreachQuery(recipients);
    if (!query) return { threads: [], nextPageToken: null };

    if (query.length <= OUTREACH_QUERY_BUDGET) {
      const args = {
        sinceDays: OUTREACH_WINDOW_DAYS, cap: OUTREACH_CAP, query, inInbox: false,
      };
      let page = await provider.listThreads({ ...args, pageToken: opts?.pageToken });
      // A page can be empty while a token exists; skip up to 3 dead pages.
      for (let attempt = 0; page.threads.length === 0 && page.nextPageToken && attempt < 3; attempt++) {
        page = await provider.listThreads({ ...args, pageToken: page.nextPageToken });
      }
      return { threads: page.threads, nextPageToken: page.nextPageToken ?? null };
    }

    const queries = chunkRecipientQueries(recipients);
    const perChunk = Math.max(1, Math.floor(OUTREACH_CAP / queries.length));
    const seen = new Set<string>();
    const merged: Thread[] = [];
    for (const chunk of queries) {
      if (merged.length >= OUTREACH_CAP) break;
      const { threads } = await provider.listThreads({
        sinceDays: OUTREACH_WINDOW_DAYS, cap: perChunk, query: chunk, inInbox: false,
      });
      for (const thread of threads) {
        if (seen.has(thread.id)) continue;
        seen.add(thread.id);
        merged.push(thread);
      }
    }
    merged.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return { threads: merged.slice(0, OUTREACH_CAP), nextPageToken: null, overflowed: true };
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
