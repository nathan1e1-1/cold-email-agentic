// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReaderPane } from '../../src/components/ReaderPane';
import type { Thread } from '../../src/domain/types';

afterEach(cleanup);

const thread: Thread = {
  id: 't1',
  subject: 'Hello',
  participants: [{ name: 'Prof', email: 'prof@x.edu' }],
  messages: [
    {
      id: 'm1', rfcMessageId: '', references: [],
      from: { name: 'Prof', email: 'prof@x.edu' }, to: [{ email: 'me@x.com' }], cc: [],
      subject: 'Hello', bodyText: 'Hi', hasListUnsubscribe: false,
      date: 1, direction: 'inbound',
    },
  ],
  lastMessageAt: 1,
  snippet: 'Hi',
  inInbox: true,
  labels: [],
};

describe('ReaderPane', () => {
  it('offers a Reply action when wired', async () => {
    const onReply = vi.fn();
    render(<ReaderPane thread={thread} onReply={onReply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Email thread' })).toHaveAttribute('tabindex', '0');
  });

  it('omits Reply when not wired', () => {
    render(<ReaderPane thread={thread} />);
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});
