import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/db/schema';
import { NodeRepository } from '../../src/db/nodeRepository';

describe('migrate', () => {
  it('creates all tables', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      'accounts', 'threads', 'messages', 'cards',
      'contacts', 'drafts', 'sends', 'settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    expect(() => migrate(db as any)).not.toThrow();
  });
});

describe('NodeRepository', () => {
  const mk = () => new NodeRepository(':memory:');

  it('persists an account and history id', async () => {
    const repo = mk();
    await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
      tokenRef: 'gmail/token', createdAt: 1 });
    await repo.setHistoryId('h123');
    const acc = await repo.getAccount();
    expect(acc?.email).toBe('me@x.com');
    expect(acc?.historyId).toBe('h123');
  });

  it('upserts threads idempotently and lists them newest first', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const t = { id: 'thr1', accountId: acc.rowId, subject: 'Hi', participants: [], labels: [],
      messages: [], lastMessageAt: 100, snippet: 's', inInbox: true, hasOwnReply: false };
    const a = await repo.upsertThread(t);
    const b = await repo.upsertThread({ ...t, subject: 'Hi2', lastMessageAt: 200 });
    expect(a.rowId).toBe(b.rowId);
    expect(b.subject).toBe('Hi2');
    expect((await repo.listThreads()).length).toBe(1);
  });

  it('stores messages with structured fields', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: 'Hi',
      participants: [], labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
    await repo.upsertMessage(thr.rowId, {
      id: 'm1', rfcMessageId: '<m1@x>', references: ['<m0@x>'],
      from: { email: 'them@y.com' }, to: [{ email: 'me@x.com' }], cc: [], subject: 'Hi',
      bodyText: 'hello', bodyHtml: '<p>hello</p>', hasListUnsubscribe: true, date: 5, direction: 'inbound',
    });
    const [m] = await repo.listMessages(thr.rowId);
    expect(m.rfcMessageId).toBe('<m1@x>');
    expect(m.references).toEqual(['<m0@x>']);
    expect(m.hasListUnsubscribe).toBe(true);
    expect(m.bodyHtml).toBe('<p>hello</p>');
  });

  it('creates and moves cards, and chooses a draft', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: '', participants: [],
      labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
    const card = await repo.createCard(thr.rowId, 'untouched', 0, 10);
    await repo.moveCard(card.id, 'sent', 0, 20);
    expect((await repo.getCardByThread(thr.rowId))?.status).toBe('sent');
    const d1 = await repo.createDraft({ cardId: card.id, contactId: null, body: 'a', model: 'gemini',
      tone: 'professional', instruction: '', createdAt: 1 });
    const d2 = await repo.createDraft({ cardId: card.id, contactId: null, body: 'b', model: 'gemini',
      tone: 'friendly', instruction: 'shorter', createdAt: 2 });
    await repo.chooseDraft(d2.id, card.id);
    const drafts = await repo.listDrafts(card.id);
    expect(drafts.find((d) => d.id === d2.id)?.isChosen).toBe(true);
    expect(drafts.find((d) => d.id === d1.id)?.isChosen).toBe(false);
  });

  it('dedupes contacts and toggles do_not_contact', async () => {
    const repo = mk();
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.upsertContact({ name: 'A2', email: 'a@z.com', notes: 'n', doNotContact: false });
    const c = await repo.getContactByEmail('a@z.com');
    expect(c?.name).toBe('A2');
    await repo.setDoNotContact('a@z.com', true);
    expect((await repo.getContactByEmail('a@z.com'))?.doNotContact).toBe(true);
  });

  it('records sends and answers rate/duplicate queries', async () => {
    const repo = mk();
    await repo.recordSend(1000, 'cold', 'x@z.com');
    await repo.recordSend(2000, 'cold', 'y@z.com');
    await repo.recordSend(3000, 'reply', 'x@z.com');
    expect(await repo.countSendsSince(1500, 'cold')).toBe(1);
    expect(await repo.hasColdSendTo('x@z.com')).toBe(true);
    expect(await repo.hasColdSendTo('reply-only@z.com')).toBe(false);
  });

  it('stores settings', async () => {
    const repo = mk();
    await repo.setSetting('rate_limit_per_day', '25');
    expect(await repo.getSetting('rate_limit_per_day')).toBe('25');
    expect(await repo.getSetting('missing')).toBeNull();
  });
});
