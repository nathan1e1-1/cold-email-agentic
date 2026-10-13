import type { Account, Message, Thread } from '../domain/types';
import type { MailProvider } from '../mail/mailProvider';
import type { MailboxProvider } from './mailbox';

export class GmailMailboxAdapter implements MailboxProvider {
  private provider: MailProvider;
  private account: Account | null = null;

  constructor(provider: MailProvider) {
    this.provider = provider;
  }

  async connect(): Promise<Account> {
    await this.provider.auth();
    const profile = await this.provider.getProfile();
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

  async listThreads(): Promise<Thread[]> {
    const { threads } = await this.provider.listThreads({ sinceDays: 90, cap: 200 });
    return threads;
  }

  async getThread(id: string): Promise<Thread | null> {
    try {
      return await this.provider.getThread(id);
    } catch {
      return null;
    }
  }

  async send(threadId: string, body: string): Promise<Message> {
    const ownEmail = this.account?.ownEmail ?? '';
    const thread = await this.provider.getThread(threadId);
    const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound');
    const recipient = lastInbound?.from
      ?? thread.participants.find((p) => p.email.toLowerCase() !== ownEmail.toLowerCase())
      ?? { email: '' };
    const subject = thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`;

    const result = await this.provider.send({
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
}
