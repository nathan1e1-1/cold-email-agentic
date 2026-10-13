import type { Account, Address, Message, Thread } from '../domain/types';
import type { MailboxProvider } from './mailbox';

const ACCOUNT: Account = {
  provider: 'gmail',
  email: 'you@example.com',
  ownEmail: 'you@example.com',
  displayName: 'You',
};

function inbound(
  id: string,
  from: Address,
  subject: string,
  bodyText: string,
  date: number,
): Message {
  return {
    id,
    rfcMessageId: `<${id}@example.com>`,
    references: [],
    from,
    to: [{ email: ACCOUNT.ownEmail }],
    cc: [],
    subject,
    bodyText,
    hasListUnsubscribe: false,
    date,
    direction: 'inbound',
  };
}

export function defaultSeedThreads(): Thread[] {
  const t1a = inbound(
    't1-m1',
    { name: 'Sarah Chen', email: 'sarah@acme.com' },
    'Q3 partnership',
    'Hi — following up on our conversation about the Q3 partnership. Are you open to a call next week to scope it out?',
    Date.parse('2026-10-07T15:20:00Z'),
  );
  const t1b = inbound(
    't1-m2',
    { name: 'Sarah Chen', email: 'sarah@acme.com' },
    'Q3 partnership',
    'Quick nudge — I have Tuesday and Thursday afternoon free if either works for you.',
    Date.parse('2026-10-08T14:30:00Z'),
  );
  const t2 = inbound(
    't2-m1',
    { name: 'Marcus Lee', email: 'marcus@northwind.io' },
    'Invoice #2041',
    'Hey, just checking whether invoice #2041 has been processed on your end. Thanks!',
    Date.parse('2026-10-06T09:05:00Z'),
  );
  const t3 = inbound(
    't3-m1',
    { name: 'Priya Patel', email: 'priya@brightlabs.co' },
    'Intro call follow-up',
    'Great chatting earlier. I have attached the deck we discussed — happy to answer anything by email.',
    Date.parse('2026-10-05T18:45:00Z'),
  );

  return [
    {
      id: 't1',
      subject: 'Q3 partnership',
      participants: [
        { name: 'Sarah Chen', email: 'sarah@acme.com' },
        { email: ACCOUNT.ownEmail },
      ],
      messages: [t1a, t1b],
      lastMessageAt: t1b.date,
      snippet: t1b.bodyText.slice(0, 80),
      inInbox: true,
      labels: [],
    },
    {
      id: 't2',
      subject: 'Invoice #2041',
      participants: [
        { name: 'Marcus Lee', email: 'marcus@northwind.io' },
        { email: ACCOUNT.ownEmail },
      ],
      messages: [t2],
      lastMessageAt: t2.date,
      snippet: t2.bodyText.slice(0, 80),
      inInbox: true,
      labels: [],
    },
    {
      id: 't3',
      subject: 'Intro call follow-up',
      participants: [
        { name: 'Priya Patel', email: 'priya@brightlabs.co' },
        { email: ACCOUNT.ownEmail },
      ],
      messages: [t3],
      lastMessageAt: t3.date,
      snippet: t3.bodyText.slice(0, 80),
      inInbox: true,
      labels: [],
    },
  ];
}

export class MockMailboxProvider implements MailboxProvider {
  private connected = false;
  private threads: Thread[];
  private counter = 0;

  constructor(threads: Thread[] = defaultSeedThreads()) {
    this.threads = threads;
  }

  async connect(): Promise<Account> {
    this.connected = true;
    return { ...ACCOUNT };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listThreads(): Promise<Thread[]> {
    this.assertConnected();
    return [...this.threads]
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .map((t) => ({ ...t, messages: [...t.messages] }));
  }

  async getThread(id: string): Promise<Thread | null> {
    this.assertConnected();
    const thread = this.threads.find((t) => t.id === id);
    return thread ? { ...thread, messages: [...thread.messages] } : null;
  }

  async send(threadId: string, body: string): Promise<Message> {
    this.assertConnected();
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound');
    const recipient: Address = lastInbound
      ? lastInbound.from
      : thread.participants.find((p) => p.email !== ACCOUNT.ownEmail) ?? { email: '' };

    const message: Message = {
      id: `sent-${++this.counter}`,
      rfcMessageId: `<sent-${this.counter}@example.com>`,
      references: lastInbound ? [lastInbound.rfcMessageId] : [],
      from: { name: ACCOUNT.displayName, email: ACCOUNT.ownEmail },
      to: [recipient],
      cc: [],
      subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
      bodyText: body,
      hasListUnsubscribe: false,
      date: Date.now(),
      direction: 'outbound',
    };

    thread.messages = [...thread.messages, message];
    thread.lastMessageAt = message.date;
    thread.inInbox = false;
    thread.snippet = message.bodyText.slice(0, 80);
    return message;
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error('Mailbox not connected');
  }
}
