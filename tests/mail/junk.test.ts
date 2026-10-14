import { describe, it, expect } from 'vitest';
import { isJunkThread } from '../../src/mail/junk';
import type { Message, Thread } from '../../src/domain/types';

function msg(fromEmail: string, opts: { listUnsub?: boolean; direction?: 'inbound' | 'outbound' } = {}): Message {
  return {
    id: 'm', rfcMessageId: '<m@x>', references: [],
    from: { email: fromEmail }, to: [{ email: 'me@x.com' }], cc: [],
    subject: 's', bodyText: 'b', hasListUnsubscribe: opts.listUnsub ?? false,
    date: 1, direction: opts.direction ?? 'inbound',
  };
}

function thread(messages: Message[], labels: string[] = []): Thread {
  return {
    id: 't', subject: 's', participants: [], messages,
    lastMessageAt: 1, snippet: '', inInbox: true, labels,
  };
}

describe('isJunkThread', () => {
  it('flags no-reply senders', () => {
    expect(isJunkThread(thread([msg('noreply@x.com')]))).toBe(true);
    expect(isJunkThread(thread([msg('no-reply@x.com')]))).toBe(true);
    expect(isJunkThread(thread([msg('noreply-accounts@google.com')]))).toBe(true);
  });

  it('flags notifications senders', () => {
    expect(isJunkThread(thread([msg('notifications@github.com')]))).toBe(true);
  });

  it('flags messages carrying a List-Unsubscribe header', () => {
    expect(isJunkThread(thread([msg('news@company.com', { listUnsub: true })]))).toBe(true);
  });

  it('flags Gmail category labels', () => {
    expect(isJunkThread(thread([msg('someone@x.com')], ['CATEGORY_PROMOTIONS']))).toBe(true);
  });

  it('does not flag a normal human sender', () => {
    expect(isJunkThread(thread([msg('sarah@acme.com')]))).toBe(false);
  });

  it('judges by the latest inbound message', () => {
    expect(isJunkThread(thread([msg('sarah@acme.com'), msg('me@x.com', { direction: 'outbound' })]))).toBe(false);
  });
});
