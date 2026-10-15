import type { Account, Message, Thread } from '../domain/types';
import type { MailProvider } from '../mail/mailProvider';
import type { MailboxProvider, NewEmailInput } from './mailbox';

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

  async listThreads(): Promise<Thread[]> {
    const { threads } = await this.requireProvider().listThreads({ sinceDays: 90, cap: 20 });
    return threads;
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

  async sendNew(input: NewEmailInput): Promise<Message> {
    const provider = this.requireProvider();
    const ownEmail = this.account?.ownEmail ?? '';
    const result = await provider.send({
      to: [input.to],
      subject: input.subject,
      bodyText: input.bodyText,
      listUnsubscribeMailto: input.listUnsubscribeMailto,
    });
    return {
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
    };
  }
}
