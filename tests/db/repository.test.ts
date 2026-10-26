import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate, MIGRATIONS } from '../../src/db/schema';
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

  it('is idempotent and records the schema version', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    expect(() => migrate(db as any)).not.toThrow();
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(MIGRATIONS.length);
  });

  it('upgrades a version 2 database by adding the sends thread_id column', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]);
    db.exec(MIGRATIONS[1]);
    db.exec('PRAGMA user_version = 2');
    const before = db.prepare('PRAGMA table_info(sends)').all() as { name: string }[];
    expect(before.map((c) => c.name)).not.toContain('thread_id');

    migrate(db as any);

    const after = db.prepare('PRAGMA table_info(sends)').all() as { name: string }[];
    expect(after.map((c) => c.name)).toContain('thread_id');
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(MIGRATIONS.length);
  });
});

describe('NodeRepository', () => {
  const mk = () => new NodeRepository(':memory:');

  async function seedAccount(repo: NodeRepository) {
    return repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
      tokenRef: 't', createdAt: 1 });
  }

  async function seedThread(repo: NodeRepository, accountId: number, id: string, lastMessageAt = 1) {
    return repo.upsertThread({ id, accountId, subject: '', participants: [], labels: [],
      messages: [], lastMessageAt, snippet: '', inInbox: true });
  }

  it('persists an account and updates it in place', async () => {
    const repo = mk();
    const a1 = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
      tokenRef: 'gmail/token', createdAt: 1 });
    const a2 = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
      displayName: 'Me', tokenRef: 'gmail/token2', createdAt: 1 });
    expect(a2.rowId).toBe(a1.rowId);
    const acc = await repo.getAccount();
    expect(acc?.email).toBe('me@x.com');
    expect(acc?.displayName).toBe('Me');
    expect(acc?.tokenRef).toBe('gmail/token2');
  });

  it('upserts threads idempotently and lists them newest first', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const t = { id: 'thr1', accountId: acc.rowId, subject: 'Hi', participants: [], labels: [],
      messages: [], lastMessageAt: 100, snippet: 's', inInbox: true };
    const a = await repo.upsertThread(t);
    const b = await repo.upsertThread({ ...t, subject: 'Hi2', lastMessageAt: 200 });
    expect(a.rowId).toBe(b.rowId);
    expect(b.subject).toBe('Hi2');
    await seedThread(repo, acc.rowId, 'thr2', 300);
    const list = await repo.listThreads();
    expect(list.length).toBe(2);
    expect(list.map((x) => x.id)).toEqual(['thr2', 'thr1']);
  });

  it('stores messages with structured fields', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const thr = await seedThread(repo, acc.rowId, 'thr1');
    await repo.upsertMessage(thr.rowId, {
      id: 'm1', rfcMessageId: '<m1@x>', references: ['<m0@x>'],
      from: { email: 'them@y.com' }, to: [{ email: 'me@x.com' }], cc: [], subject: 'Hi',
      bodyText: 'hello', bodyHtml: '<p>hello</p>', hasListUnsubscribe: true, date: 5, direction: 'inbound',
    });
    await repo.upsertMessage(thr.rowId, {
      id: 'm2', rfcMessageId: '<m2@x>', references: [], from: { email: 'me@x.com' },
      to: [{ email: 'them@y.com' }], cc: [], subject: 'Hi', bodyText: 'second',
      hasListUnsubscribe: false, date: 5, direction: 'outbound',
    });
    const msgs = await repo.listMessages(thr.rowId);
    expect(msgs.map((x) => x.id)).toEqual(['m1', 'm2']);
    const m = msgs[0];
    expect(m.rfcMessageId).toBe('<m1@x>');
    expect(m.references).toEqual(['<m0@x>']);
    expect(m.hasListUnsubscribe).toBe(true);
    expect(m.bodyHtml).toBe('<p>hello</p>');
  });

  it('deletes a thread with its drafts, messages, and card, leaving others intact', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const first = await seedThread(repo, acc.rowId, 'thr1');
    const second = await seedThread(repo, acc.rowId, 'thr2', 2);
    await repo.upsertMessage(first.rowId, {
      id: 'm1',
      rfcMessageId: '<m1@x>',
      references: ['<m0@x>'],
      from: { name: 'Sarah', email: 'sarah@acme.com' },
      to: [{ name: 'Me', email: 'me@x.com' }],
      cc: [{ email: 'cc@x.com' }],
      subject: 'Hi',
      bodyText: 'hello',
      bodyHtml: '<p>hello</p>',
      hasListUnsubscribe: false,
      date: 5,
      direction: 'inbound',
    });
    await repo.upsertMessage(second.rowId, {
      id: 'm2',
      rfcMessageId: '<m2@x>',
      references: [],
      from: { email: 'other@y.com' },
      to: [{ email: 'me@x.com' }],
      cc: [],
      subject: 'Other',
      bodyText: 'keep me',
      hasListUnsubscribe: false,
      date: 6,
      direction: 'inbound',
    });
    const firstCard = await repo.createCard(first.rowId, 'untouched', 1);
    const secondCard = await repo.createCard(second.rowId, 'untouched', 2);
    await repo.createDraft({
      cardId: firstCard.id, contactId: null, body: 'a', model: 'gemini',
      tone: 'professional', instruction: '', createdAt: 1,
    });

    await repo.deleteThreadByProviderId('thr1');

    expect((await repo.listThreads()).map((t) => t.id)).toEqual(['thr2']);
    expect(await repo.listMessages(first.rowId)).toEqual([]);
    expect((await repo.listMessages(second.rowId)).map((m) => m.id)).toEqual(['m2']);
    expect((await repo.listCards()).map((c) => c.id)).toEqual([secondCard.id]);
    expect(await repo.listDrafts(firstCard.id)).toEqual([]);
    await expect(repo.deleteThreadByProviderId('missing')).resolves.toBeUndefined();
  });

  it('creates and moves cards, and chooses a draft', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const thr = await seedThread(repo, acc.rowId, 'thr1');
    const card = await repo.createCard(thr.rowId, 'untouched', 10);
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

  it('inserts new cards at the top of a column with unique positions', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const thrA = await seedThread(repo, acc.rowId, 'thrA');
    const thrB = await seedThread(repo, acc.rowId, 'thrB');
    const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
    const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);
    const untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
    expect(untouched.map((c) => c.id)).toEqual([cardB.id, cardA.id]);
    expect(untouched.map((c) => c.position)).toEqual([0, 1]);
  });

  it('moves a card within a column, shifting siblings', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const thrA = await seedThread(repo, acc.rowId, 'thrA');
    const thrB = await seedThread(repo, acc.rowId, 'thrB');
    const thrC = await seedThread(repo, acc.rowId, 'thrC');
    const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
    const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);
    const cardC = await repo.createCard(thrC.rowId, 'untouched', 3);
    await repo.moveCard(cardA.id, 'untouched', 0, 4);
    const untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
    expect(untouched.map((c) => c.id)).toEqual([cardA.id, cardC.id, cardB.id]);
    expect(untouched.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('moves a card between columns, closing the source gap', async () => {
    const repo = mk();
    const acc = await seedAccount(repo);
    const thrA = await seedThread(repo, acc.rowId, 'thrA');
    const thrB = await seedThread(repo, acc.rowId, 'thrB');
    const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
    const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);
    await repo.moveCard(cardA.id, 'review', 0, 3);
    const untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
    const review = (await repo.listCards()).filter((c) => c.status === 'review');
    expect(untouched.map((c) => c.id)).toEqual([cardB.id]);
    expect(untouched.map((c) => c.position)).toEqual([0]);
    expect(review.map((c) => c.id)).toEqual([cardA.id]);
    expect(review.map((c) => c.position)).toEqual([0]);
  });

  it('does not clear do_not_contact when a contact is re-upserted', async () => {
    const repo = mk();
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.setDoNotContact('a@z.com', true);
    await repo.upsertContact({ name: 'A again', email: 'a@z.com', notes: 'n', doNotContact: false });
    const c = await repo.getContactByEmail('a@z.com');
    expect(c?.name).toBe('A again');
    expect(c?.doNotContact).toBe(true);
  });

  it('normalizes contact emails (case + whitespace)', async () => {
    const repo = mk();
    await repo.upsertContact({ name: 'A', email: '  A@Z.com ', notes: '', doNotContact: false });
    const c = await repo.getContactByEmail('a@z.com');
    expect(c?.email).toBe('a@z.com');
    expect((await repo.getContactByEmail('A@Z.COM'))?.id).toBe(c?.id);
  });

  it('lists contacts', async () => {
    const repo = mk();
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.upsertContact({ name: 'B', email: 'b@z.com', notes: '', doNotContact: false });
    const contacts = await repo.listContacts();
    expect(contacts.length).toBe(2);
    expect(contacts.map((c) => c.email).sort()).toEqual(['a@z.com', 'b@z.com']);
  });

  it('records sends and answers rate/duplicate queries', async () => {
    const repo = mk();
    await repo.recordSend(1000, 'cold', 'x@z.com');
    await repo.recordSend(2000, 'cold', 'y@z.com');
    await repo.recordSend(3000, 'reply', 'x@z.com');
    await repo.recordSend(3000, 'reply', 'replyonly@z.com');
    expect(await repo.countSendsSince(1500, 'cold')).toBe(1);
    expect(await repo.countSendsSince(2000, 'cold')).toBe(1);
    expect(await repo.hasColdSendTo('x@z.com')).toBe(true);
    expect(await repo.hasColdSendTo('replyonly@z.com')).toBe(false);
  });

  it('lists distinct cold recipients, newest first, including the account address', async () => {
    const repo = mk();
    await repo.upsertAccount({ provider: 'gmail', email: 'Me@X.com', ownEmail: 'Me@X.com',
      tokenRef: 't', createdAt: 1 });
    await repo.recordSend(1000, 'cold', ' A@Z.com ', 'thr-1');
    await repo.recordSend(2000, 'cold', 'b@z.com', 'thr-2');
    await repo.recordSend(3000, 'cold', 'a@z.com', 'thr-3');
    await repo.recordSend(4000, 'reply', 'replyonly@z.com');
    await repo.recordSend(5000, 'cold', ' ME@X.COM ', 'thr-self');

    expect(await repo.listColdRecipients()).toEqual([
      { email: 'me@x.com', lastSentAt: 5000 },
      { email: 'a@z.com', lastSentAt: 3000 },
      { email: 'b@z.com', lastSentAt: 2000 },
    ]);
  });

  it('persists the sent thread id on the send row', async () => {
    const repo = mk();
    await repo.recordSend(1000, 'cold', 'a@z.com', 'thr-1');
    await repo.recordSend(2000, 'cold', 'b@z.com');
    const db = (repo as unknown as { db: DatabaseSync }).db;
    const rows = db.prepare('SELECT thread_id FROM sends ORDER BY id ASC').all() as { thread_id: string | null }[];
    expect(rows[0].thread_id).toBe('thr-1');
    expect(rows[1].thread_id).toBeNull();
  });

  it('stores settings', async () => {
    const repo = mk();
    await repo.setSetting('rate_limit_per_day', '25');
    expect(await repo.getSetting('rate_limit_per_day')).toBe('25');
    expect(await repo.getSetting('missing')).toBeNull();
  });
});
