import { describe, it, expect } from 'vitest';
import type { Repository } from '../../src/db/repository';
import type { Message } from '../../src/domain/types';

export function runRepositoryContract(make: () => Repository): void {
  describe('Repository contract', () => {
    async function seedAccount(repo: Repository) {
      return repo.upsertAccount({
        provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1,
      });
    }

    async function seedThread(repo: Repository, accountId: number, id: string, lastMessageAt = 1) {
      return repo.upsertThread({
        id, accountId, subject: '', participants: [], labels: [], messages: [],
        lastMessageAt, snippet: '', inInbox: true,
      });
    }

    const msg = (id: string, date: number, overrides: Partial<Message> = {}): Message => ({
      id,
      rfcMessageId: `<${id}@x>`,
      references: [],
      from: { email: 'them@y.com' },
      to: [{ email: 'me@x.com' }],
      cc: [],
      subject: 'Hi',
      bodyText: `body ${id}`,
      hasListUnsubscribe: false,
      date,
      direction: 'inbound',
      ...overrides,
    });

    describe('transaction', () => {
      it('commits the callback work and returns its result', async () => {
        const repo = make();
        const result = await repo.transaction(async () => {
          await repo.setSetting('inside', 'yes');
          return 42;
        });
        expect(result).toBe(42);
        expect(await repo.getSetting('inside')).toBe('yes');
      });

      it('propagates callback errors', async () => {
        const repo = make();
        await expect(repo.transaction(async () => {
          throw new Error('boom');
        })).rejects.toThrow('boom');
      });
    });

    describe('accounts', () => {
      it('returns null before any account exists', async () => {
        expect(await make().getAccount()).toBeNull();
      });

      it('creates an account and updates it in place on re-upsert', async () => {
        const repo = make();
        const first = await repo.upsertAccount({
          provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
          tokenRef: 'gmail/token', createdAt: 1,
        });
        expect(first.rowId).toBeGreaterThan(0);
        expect(first.email).toBe('me@x.com');
        expect(first.ownEmail).toBe('me@x.com');
        expect(first.displayName).toBeUndefined();
        expect(first.createdAt).toBe(1);

        const second = await repo.upsertAccount({
          provider: 'outlook', email: 'me@x.com', ownEmail: 'other@x.com',
          displayName: 'Me', tokenRef: 'outlook/token', createdAt: 2,
        });
        expect(second.rowId).toBe(first.rowId);

        const stored = await repo.getAccount();
        expect(stored).not.toBeNull();
        expect(stored?.provider).toBe('outlook');
        expect(stored?.ownEmail).toBe('other@x.com');
        expect(stored?.displayName).toBe('Me');
        expect(stored?.tokenRef).toBe('outlook/token');
      });
    });

    describe('threads', () => {
      it('round-trips fields and upserts idempotently', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const participants = [{ name: 'Ada', email: 'ada@x.com' }];
        const created = await repo.upsertThread({
          id: 'thr1', accountId: account.rowId, subject: 'Hi', participants,
          labels: ['inbox'], messages: [], lastMessageAt: 100, snippet: 'hello', inInbox: false,
        });
        expect(created.id).toBe('thr1');
        expect(created.accountId).toBe(account.rowId);
        expect(created.subject).toBe('Hi');
        expect(created.participants).toEqual(participants);
        expect(created.labels).toEqual(['inbox']);
        expect(created.lastMessageAt).toBe(100);
        expect(created.snippet).toBe('hello');
        expect(created.inInbox).toBe(false);

        const updated = await repo.upsertThread({
          id: 'thr1', accountId: account.rowId, subject: 'Hi2', participants: [],
          labels: [], messages: [], lastMessageAt: 200, snippet: 'updated', inInbox: true,
        });
        expect(updated.rowId).toBe(created.rowId);
        expect((await repo.getThreadByProviderId('thr1'))?.subject).toBe('Hi2');
        expect((await repo.getThreadByProviderId('thr1'))?.inInbox).toBe(true);
        expect(await repo.getThreadByProviderId('missing')).toBeNull();
      });

      it('lists threads newest first', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        await seedThread(repo, account.rowId, 'thr1', 100);
        await seedThread(repo, account.rowId, 'thr2', 300);
        await seedThread(repo, account.rowId, 'thr3', 200);
        expect((await repo.listThreads()).map((t) => t.id)).toEqual(['thr2', 'thr3', 'thr1']);
      });
    });

    describe('messages', () => {
      it('deletes messages by provider message id', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thread = await seedThread(repo, account.rowId, 'thr1');
        await repo.upsertMessage(thread.rowId, msg('m1', 1));
        await repo.upsertMessage(thread.rowId, msg('m2', 2));

        await repo.deleteMessages(['m1']);
        expect((await repo.listMessages(thread.rowId)).map((m) => m.id)).toEqual(['m2']);
        await expect(repo.deleteMessages(['missing'])).resolves.toBeUndefined();
      });

      it('upserts, updates, and lists messages by date then id', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thread = await seedThread(repo, account.rowId, 'thr1');
        await repo.upsertMessage(thread.rowId, msg('m2', 10));
        await repo.upsertMessage(thread.rowId, msg('m1', 10));
        await repo.upsertMessage(thread.rowId, msg('m3', 5));

        const listed = await repo.listMessages(thread.rowId);
        expect(listed.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);

        await repo.upsertMessage(thread.rowId, msg('m1', 10, {
          bodyText: 'updated', bodyHtml: '<p>u</p>', hasListUnsubscribe: true,
          references: ['<m0@x>'], from: { name: 'Them', email: 'them@y.com' },
          to: [{ name: 'Me', email: 'me@x.com' }], cc: [{ email: 'cc@x.com' }],
          subject: 'Re', direction: 'outbound',
        }));
        const updated = (await repo.listMessages(thread.rowId)).find((m) => m.id === 'm1');
        expect(updated).toMatchObject({
          rfcMessageId: '<m1@x>',
          references: ['<m0@x>'],
          from: { name: 'Them', email: 'them@y.com' },
          to: [{ name: 'Me', email: 'me@x.com' }],
          cc: [{ email: 'cc@x.com' }],
          subject: 'Re',
          bodyText: 'updated',
          bodyHtml: '<p>u</p>',
          hasListUnsubscribe: true,
          direction: 'outbound',
        });
        expect((await repo.listMessages(thread.rowId)).length).toBe(3);
      });
    });

    describe('deleting threads', () => {
      it('removes the thread, its messages, card, and drafts while leaving others intact', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const first = await seedThread(repo, account.rowId, 'thr1', 1);
        const second = await seedThread(repo, account.rowId, 'thr2', 2);
        await repo.upsertMessage(first.rowId, msg('m1', 1));
        await repo.upsertMessage(second.rowId, msg('m2', 2));
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
    });

    describe('cards', () => {
      it('inserts new cards at the top and returns an existing card unchanged', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thrA = await seedThread(repo, account.rowId, 'thrA');
        const thrB = await seedThread(repo, account.rowId, 'thrB');
        const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
        const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);

        const untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
        expect(untouched.map((c) => c.id)).toEqual([cardB.id, cardA.id]);
        expect(untouched.map((c) => c.position)).toEqual([0, 1]);

        const same = await repo.createCard(thrA.rowId, 'review', 3);
        expect(same).toMatchObject({ id: cardA.id, status: 'untouched', threadRowId: thrA.rowId });
        expect(await repo.getCardByThread(thrA.rowId)).toEqual(same);
        expect(await repo.getCardByThread(9999)).toBeNull();
      });

      it('lists cards ordered by status, position, then id', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thrR = await seedThread(repo, account.rowId, 'thrR');
        const thrS = await seedThread(repo, account.rowId, 'thrS');
        const thrU = await seedThread(repo, account.rowId, 'thrU');
        const cardR = await repo.createCard(thrR.rowId, 'review', 1);
        const cardS = await repo.createCard(thrS.rowId, 'sent', 2);
        const cardU = await repo.createCard(thrU.rowId, 'untouched', 3);

        expect((await repo.listCards()).map((c) => c.id)).toEqual([cardR.id, cardS.id, cardU.id]);
      });

      it('reorders within a column and updates updatedAt when the position is unchanged', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thrA = await seedThread(repo, account.rowId, 'thrA');
        const thrB = await seedThread(repo, account.rowId, 'thrB');
        const thrC = await seedThread(repo, account.rowId, 'thrC');
        const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
        const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);
        const cardC = await repo.createCard(thrC.rowId, 'untouched', 3);

        await repo.moveCard(cardA.id, 'untouched', 0, 4);
        let untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
        expect(untouched.map((c) => c.id)).toEqual([cardA.id, cardC.id, cardB.id]);
        expect(untouched.map((c) => c.position)).toEqual([0, 1, 2]);

        await repo.moveCard(cardA.id, 'untouched', 2, 5);
        untouched = (await repo.listCards()).filter((c) => c.status === 'untouched');
        expect(untouched.map((c) => c.id)).toEqual([cardC.id, cardB.id, cardA.id]);
        expect(untouched.map((c) => c.position)).toEqual([0, 1, 2]);
        expect(untouched.find((c) => c.id === cardA.id)?.updatedAt).toBe(5);

        await repo.moveCard(cardA.id, 'untouched', 2, 99);
        expect((await repo.getCardByThread(thrA.rowId))?.updatedAt).toBe(99);
      });

      it('moves between columns and closes the source gap', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thrA = await seedThread(repo, account.rowId, 'thrA');
        const thrB = await seedThread(repo, account.rowId, 'thrB');
        const cardA = await repo.createCard(thrA.rowId, 'untouched', 1);
        const cardB = await repo.createCard(thrB.rowId, 'untouched', 2);

        await repo.moveCard(cardA.id, 'review', 0, 3);
        let all = await repo.listCards();
        expect(all.filter((c) => c.status === 'untouched').map((c) => [c.id, c.position]))
          .toEqual([[cardB.id, 0]]);
        expect(all.filter((c) => c.status === 'review').map((c) => [c.id, c.position]))
          .toEqual([[cardA.id, 0]]);

        await repo.moveCard(cardA.id, 'untouched', 1, 4);
        all = await repo.listCards();
        expect(all.filter((c) => c.status === 'untouched').map((c) => [c.id, c.position]))
          .toEqual([[cardB.id, 0], [cardA.id, 1]]);
        expect(all.filter((c) => c.status === 'review')).toEqual([]);

        await expect(repo.moveCard(9999, 'review', 0, 5)).rejects.toThrow('Card not found: 9999');
      });
    });

    describe('contacts', () => {
      it('normalizes emails and preserves do_not_contact across upserts', async () => {
        const repo = make();
        const first = await repo.upsertContact({
          name: 'Ada', email: '  A@Z.com ', notes: '', doNotContact: false,
        });
        expect(first.email).toBe('a@z.com');
        expect(first.doNotContact).toBe(false);

        await repo.setDoNotContact('A@Z.COM', true);
        expect((await repo.getContactByEmail(' a@z.com '))?.doNotContact).toBe(true);

        const second = await repo.upsertContact({
          name: 'Ada Again', email: 'a@z.com', notes: 'n', doNotContact: false,
        });
        expect(second.id).toBe(first.id);
        expect(second.name).toBe('Ada Again');
        expect(second.notes).toBe('n');
        expect(second.doNotContact).toBe(true);

        await repo.setDoNotContact('a@z.com', false);
        expect((await repo.getContactByEmail('a@z.com'))?.doNotContact).toBe(false);
        expect(await repo.getContactByEmail('missing@z.com')).toBeNull();
      });

      it('lists contacts', async () => {
        const repo = make();
        await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
        await repo.upsertContact({ name: 'B', email: 'b@z.com', notes: '', doNotContact: false });
        const contacts = await repo.listContacts();
        expect(contacts.map((c) => c.email).sort()).toEqual(['a@z.com', 'b@z.com']);
      });
    });

    describe('drafts', () => {
      it('creates drafts, lists newest first, and chooses one per card', async () => {
        const repo = make();
        const account = await seedAccount(repo);
        const thread = await seedThread(repo, account.rowId, 'thr1');
        const card = await repo.createCard(thread.rowId, 'untouched', 1);

        const d1 = await repo.createDraft({
          cardId: card.id, contactId: null, body: 'a', model: 'gemini',
          tone: 'professional', instruction: '', createdAt: 1,
        });
        const d2 = await repo.createDraft({
          cardId: card.id, contactId: null, body: 'b', model: 'gemini',
          tone: 'friendly', instruction: 'shorter', createdAt: 2,
        });
        expect(d1.isChosen).toBe(false);

        let drafts = await repo.listDrafts(card.id);
        expect(drafts.map((d) => d.id)).toEqual([d2.id, d1.id]);

        await repo.chooseDraft(d1.id, card.id);
        drafts = await repo.listDrafts(card.id);
        expect(drafts.find((d) => d.id === d1.id)?.isChosen).toBe(true);
        expect(drafts.find((d) => d.id === d2.id)?.isChosen).toBe(false);

        await repo.chooseDraft(d2.id, card.id);
        drafts = await repo.listDrafts(card.id);
        expect(drafts.find((d) => d.id === d1.id)?.isChosen).toBe(false);
        expect(drafts.find((d) => d.id === d2.id)?.isChosen).toBe(true);

        expect(await repo.listDrafts(9999)).toEqual([]);
      });
    });

    describe('sends', () => {
      it('records sends and answers rate/duplicate queries', async () => {
        const repo = make();
        await repo.recordSend(1000, 'cold', ' X@Z.com ', 'thr-1');
        await repo.recordSend(2000, 'cold', 'y@z.com');
        await repo.recordSend(3000, 'reply', 'x@z.com');
        await repo.recordSend(3000, 'reply', 'replyonly@z.com');

        expect(await repo.countSendsSince(1500, 'cold')).toBe(1);
        expect(await repo.countSendsSince(1000, 'cold')).toBe(2);
        expect(await repo.countSendsSince(3000, 'reply')).toBe(2);
        expect(await repo.hasColdSendTo('X@Z.COM')).toBe(true);
        expect(await repo.hasColdSendTo(' y@z.com ')).toBe(true);
        expect(await repo.hasColdSendTo('replyonly@z.com')).toBe(false);
        expect(await repo.listColdThreadIds()).toEqual(['thr-1']);
      });

      it('lists distinct cold recipients newest first', async () => {
        const repo = make();
        await repo.recordSend(1000, 'cold', ' A@Z.com ', 'thr-1');
        await repo.recordSend(2000, 'cold', 'b@z.com', 'thr-2');
        await repo.recordSend(3000, 'cold', 'a@z.com', 'thr-3');
        await repo.recordSend(4000, 'reply', 'replyonly@z.com');
        expect(await repo.listColdRecipients()).toEqual([
          { email: 'a@z.com', lastSentAt: 3000 },
          { email: 'b@z.com', lastSentAt: 2000 },
        ]);
      });

      it('lists distinct cold thread ids, ignoring nulls and non-cold sends', async () => {
        const repo = make();
        await repo.recordSend(1, 'cold', 'a@x.com', 't1');
        await repo.recordSend(2, 'cold', 'a@x.com', 't1');
        await repo.recordSend(3, 'cold', 'b@x.com', 't2');
        await repo.recordSend(4, 'reply', 'c@x.com', 't3');
        await repo.recordSend(5, 'cold', 'd@x.com');
        await repo.recordSend(6, 'cold', ' ME@X.com ', 't-self');
        await repo.recordSend(7, 'cold', 'blank@x.com', '');
        expect((await repo.listColdThreadIds()).sort()).toEqual(['t-self', 't1', 't2']);
        expect((await repo.listColdThreadIds('me@x.com')).sort()).toEqual(['t1', 't2']);
      });
    });

    describe('settings', () => {
      it('stores, overwrites, and reads settings', async () => {
        const repo = make();
        expect(await repo.getSetting('missing')).toBeNull();
        await repo.setSetting('rate_limit_per_day', '25');
        expect(await repo.getSetting('rate_limit_per_day')).toBe('25');
        await repo.setSetting('rate_limit_per_day', '50');
        expect(await repo.getSetting('rate_limit_per_day')).toBe('50');
      });
    });
  });
}
