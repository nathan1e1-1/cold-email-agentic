import type { Account, Address, Message, Thread } from '../domain/types';
import type { GraphMessage } from '../mail/outlookParse';
import { groupOutlookThreads } from '../mail/outlookParse';
import { escapeODataString } from '../mail/microsoftGraphProvider';
import {
  OUTREACH_CAP, OUTREACH_WINDOW_DAYS, uniqueRecipients,
} from '../mail/outreach';
import { isJunkThread } from '../mail/junk';
import type {
  MailboxProvider, NewEmailInput, SentNewEmail, ThreadPage, ThreadQueryOptions,
} from './mailbox';

type FolderName = 'inbox' | 'deleteditems' | 'junkemail' | 'sentitems';

export interface GraphProvider {
  auth(): Promise<void>;
  isAuthed(): Promise<boolean>;
  getProfile(): Promise<{ emailAddress: string; displayName?: string }>;
  getFolderId(name: FolderName): Promise<string>;
  listMessages(opts: {
    folder?: 'inbox' | 'deleteditems' | 'all';
    top?: number;
    filter?: string;
    nextLink?: string;
  }): Promise<{ messages: GraphMessage[]; nextLink: string | null }>;
  getMessage(id: string): Promise<GraphMessage>;
  listConversation(conversationId: string, maxMessages?: number): Promise<GraphMessage[]>;
  sendMail(input: {
    to: string[];
    subject: string;
    bodyText: string;
  }): Promise<void>;
  reply(messageId: string, comment: string): Promise<void>;
  move(messageId: string, destinationId: 'inbox' | 'deleteditems'): Promise<void>;
}

export type GraphProviderFactory = () => GraphProvider;

const KNOWN_ID_CAP = 40;
const RECIPIENT_CHUNK_SIZE = 10;
const CONVERSATION_MAX = 250;
const MS_PER_DAY = 86_400_000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function dedupeThreads(threads: Thread[]): Thread[] {
  return [...new Map(threads.map((t) => [t.id, t])).values()];
}

function mergeKnownThreads(threads: Thread[], known: Thread[]): Thread[] {
  const byId = new Map<string, Thread>();
  for (const thread of threads) byId.set(thread.id, thread);
  for (const thread of known) byId.set(thread.id, thread);
  return [...byId.values()]
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, OUTREACH_CAP);
}

function addressOf(message: GraphMessage): Address {
  const from = message.from?.emailAddress;
  const email = from?.address ?? '';
  const name = from?.name?.trim();
  return name ? { name, email } : { email };
}

function messageDate(message: GraphMessage): number {
  const received = Date.parse(message.receivedDateTime ?? '');
  if (Number.isFinite(received)) return received;
  const sent = Date.parse(message.sentDateTime ?? '');
  return Number.isFinite(sent) ? sent : 0;
}

export class OutlookMailboxAdapter implements MailboxProvider {
  private createProvider: GraphProviderFactory;
  private provider: GraphProvider | null = null;
  private account: Account | null = null;
  private folderIds = new Map<FolderName, Promise<string>>();

  constructor(createProvider: GraphProviderFactory) {
    this.createProvider = createProvider;
  }

  async connect(force = false): Promise<Account> {
    const provider = this.createProvider();
    if (force || !(await provider.isAuthed())) await provider.auth();
    const profile = await provider.getProfile();
    this.provider = provider;
    this.folderIds.clear();
    this.account = {
      provider: 'outlook',
      email: profile.emailAddress,
      ownEmail: profile.emailAddress,
      ...(profile.displayName ? { displayName: profile.displayName } : {}),
    };
    return this.account;
  }

  isConnected(): boolean {
    return this.account !== null;
  }

  private requireProvider(): GraphProvider {
    if (!this.provider) throw new Error('Outlook is not connected');
    return this.provider;
  }

  private ownEmail(): string {
    return this.account?.ownEmail ?? '';
  }

  private folderId(name: FolderName): Promise<string> {
    const cached = this.folderIds.get(name);
    if (cached) return cached;
    const pending = this.requireProvider().getFolderId(name).catch((err) => {
      this.folderIds.delete(name);
      throw err;
    });
    this.folderIds.set(name, pending);
    return pending;
  }

  async listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage> {
    const provider = this.requireProvider();
    const ownEmail = this.ownEmail();
    const outreachRecipients = opts?.outreachRecipients;
    const trashed = opts?.trashed ?? false;
    const folder = trashed ? 'deleteditems' : 'inbox';
    const inInbox = !trashed;

    if (outreachRecipients === undefined) {
      const page = await provider.listMessages({
        folder,
        top: 20,
        nextLink: opts?.pageToken,
      });
      const threads = groupOutlookThreads(page.messages, ownEmail, { inInbox });
      return { threads, nextPageToken: page.nextLink ?? null };
    }

    const known = new Map<string, Thread>();
    if (!opts?.pageToken) {
      const knownIds = trashed
        ? []
        : (opts?.knownThreadIds ?? [])
          .filter((id) => id.trim() !== '')
          .slice(0, KNOWN_ID_CAP);
      for (const id of knownIds) {
        const messages = await provider.listConversation(id, CONVERSATION_MAX);
        const thread = groupOutlookThreads(messages, ownEmail, { inInbox })[0];
        if (
          thread &&
          !isJunkThread(thread) &&
          thread.messages.some((message) => message.direction === 'inbound')
        ) {
          known.set(thread.id, thread);
        }
      }
    }
    const knownThreads = [...known.values()];

    const recipients = uniqueRecipients(outreachRecipients);

    if (recipients.length === 0) {
      const threads = [...knownThreads]
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, OUTREACH_CAP);
      return { threads, nextPageToken: null };
    }

    const outreachFolder = trashed ? 'deleteditems' : 'all';
    let excludedFolders = new Set<string>();
    if (!trashed) {
      const [junkId, deletedId] = await Promise.all([
        this.folderId('junkemail'),
        this.folderId('deleteditems'),
      ]);
      excludedFolders = new Set([junkId, deletedId]);
    }
    const visibleMessages = (messages: GraphMessage[]) =>
      excludedFolders.size === 0
        ? messages
        : messages.filter(
            (message) => !message.parentFolderId || !excludedFolders.has(message.parentFolderId),
          );
    const groupVisible = (messages: GraphMessage[]) =>
      dedupeThreads(
        groupOutlookThreads(visibleMessages(messages), ownEmail, { inInbox })
          .filter((thread) => !isJunkThread(thread)),
      );

    const since = new Date(Date.now() - OUTREACH_WINDOW_DAYS * MS_PER_DAY).toISOString();
    const buildFilter = (emails: string[]) => {
      const from = emails
        .map((email) => `from/emailAddress/address eq '${escapeODataString(email)}'`)
        .join(' or ');
      return `receivedDateTime ge ${since} and (${from})`;
    };

    const chunks = chunk(recipients, RECIPIENT_CHUNK_SIZE);

    if (chunks.length === 1) {
      let page = await provider.listMessages({
        folder: outreachFolder,
        top: OUTREACH_CAP,
        filter: buildFilter(chunks[0]),
        nextLink: opts?.pageToken,
      });
      let threads = groupVisible(page.messages);
      for (let attempt = 0; threads.length === 0 && page.nextLink && attempt < 3; attempt++) {
        page = await provider.listMessages({ nextLink: page.nextLink });
        threads = groupVisible(page.messages);
      }
      const merged = opts?.pageToken ? threads : mergeKnownThreads(threads, knownThreads);
      return { threads: merged, nextPageToken: page.nextLink ?? null };
    }

    const perChunk = Math.max(1, Math.floor(OUTREACH_CAP / chunks.length));
    const messages = new Map<string, GraphMessage>();
    const seenThreadIds = new Set<string>();
    for (const emails of chunks) {
      if (seenThreadIds.size >= OUTREACH_CAP) break;
      const page = await provider.listMessages({
        folder: outreachFolder,
        top: perChunk,
        filter: buildFilter(emails),
      });
      for (const message of visibleMessages(page.messages)) {
        messages.set(message.id, message);
        if (!message.isDraft) seenThreadIds.add(message.conversationId || message.id);
      }
    }

    const grouped = dedupeThreads(
      groupOutlookThreads([...messages.values()], ownEmail, { inInbox })
        .filter((thread) => !isJunkThread(thread)),
    );
    const merged = opts?.pageToken ? grouped : mergeKnownThreads(grouped, knownThreads);
    const threads = merged
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, OUTREACH_CAP);
    return { threads, nextPageToken: null, overflowed: true };
  }

  async getThread(id: string): Promise<Thread | null> {
    try {
      const messages = await this.requireProvider().listConversation(id, CONVERSATION_MAX);
      return groupOutlookThreads(messages, this.ownEmail())[0] ?? null;
    } catch {
      return null;
    }
  }

  async send(threadId: string, body: string): Promise<Message> {
    const provider = this.requireProvider();
    const ownEmail = this.ownEmail();
    const messages = await provider.listConversation(threadId, CONVERSATION_MAX);
    const inbound = messages.filter(
      (message) =>
        (message.from?.emailAddress?.address ?? '').toLowerCase() !== ownEmail.toLowerCase(),
    );
    if (inbound.length === 0) throw new Error('Outlook: no inbound message to reply to');
    const latest = inbound.reduce((best, message) =>
      messageDate(message) >= messageDate(best) ? message : best,
    );
    const recipient = addressOf(latest);
    const subject = (latest.subject ?? '').startsWith('Re:')
      ? (latest.subject ?? '')
      : `Re: ${latest.subject ?? ''}`;

    await provider.reply(latest.id, body);

    return {
      id: '',
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
    const ownEmail = this.ownEmail();
    await provider.sendMail({
      to: [input.to.email],
      subject: input.subject,
      bodyText: input.bodyText,
    });
    return {
      threadId: '',
      message: {
        id: '',
        rfcMessageId: '',
        references: [],
        from: { email: ownEmail },
        to: [input.to],
        cc: [],
        subject: input.subject,
        bodyText: input.bodyText,
        hasListUnsubscribe: false,
        date: Date.now(),
        direction: 'outbound',
      },
    };
  }

  async trashThread(id: string): Promise<void> {
    const provider = this.requireProvider();
    const [messages, sentId, deletedId] = await Promise.all([
      provider.listConversation(id, CONVERSATION_MAX),
      this.folderId('sentitems'),
      this.folderId('deleteditems'),
    ]);
    for (const message of messages) {
      if (message.isDraft) continue;
      if (message.parentFolderId === sentId || message.parentFolderId === deletedId) continue;
      await provider.move(message.id, 'deleteditems');
    }
  }

  async untrashThread(id: string): Promise<void> {
    // Archived and custom-folder messages removed by trash restore to Inbox.
    const provider = this.requireProvider();
    const [messages, deletedId] = await Promise.all([
      provider.listConversation(id, CONVERSATION_MAX),
      this.folderId('deleteditems'),
    ]);
    for (const message of messages) {
      if (message.parentFolderId === deletedId) await provider.move(message.id, 'inbox');
    }
  }
}
