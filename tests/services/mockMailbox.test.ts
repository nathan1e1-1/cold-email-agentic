import { describe, it, expect } from 'vitest';
import { MockMailboxProvider } from '../../src/services/mockMailbox';

describe('MockMailboxProvider', () => {
  it('reports not connected until connect is called', async () => {
    const m = new MockMailboxProvider();
    expect(m.isConnected()).toBe(false);
    await expect(m.listThreads()).rejects.toThrow(/not connected/i);
    const account = await m.connect();
    expect(m.isConnected()).toBe(true);
    expect(account.ownEmail).toBe('you@example.com');
  });

  it('lists seeded threads newest first', async () => {
    const m = new MockMailboxProvider();
    await m.connect();
    const threads = await m.listThreads();
    expect(threads.length).toBeGreaterThanOrEqual(3);
    const dates = threads.map((t) => t.lastMessageAt);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('gets a thread by id and returns null for unknown ids', async () => {
    const m = new MockMailboxProvider();
    await m.connect();
    const [first] = await m.listThreads();
    const fetched = await m.getThread(first.id);
    expect(fetched?.id).toBe(first.id);
    expect(await m.getThread('nope')).toBeNull();
  });

  it('appends an outbound message on send and updates the thread', async () => {
    const m = new MockMailboxProvider();
    await m.connect();
    const [thread] = await m.listThreads();
    const before = (await m.getThread(thread.id))!.messages.length;
    const sent = await m.send(thread.id, 'Sounds good, let us talk Tuesday.');
    expect(sent.direction).toBe('outbound');
    expect(sent.bodyText).toContain('Tuesday');
    expect(sent.from.email).toBe('you@example.com');
    expect(sent.subject.startsWith('Re:')).toBe(true);
    const after = await m.getThread(thread.id);
    expect(after!.messages.length).toBe(before + 1);
    expect(after!.messages.at(-1)!.id).toBe(sent.id);
    expect(after!.lastMessageAt).toBe(sent.date);
  });

  it('throws when sending to an unknown thread', async () => {
    const m = new MockMailboxProvider();
    await m.connect();
    await expect(m.send('nope', 'hi')).rejects.toThrow(/not found/i);
  });
});
