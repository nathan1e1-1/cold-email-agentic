import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt, buildUserPrompt, selectContextMessages, MAX_CONTEXT_MESSAGES,
} from '../../src/ai/prompt';
import type { Direction, Message, Thread } from '../../src/domain/types';

function msg(id: string, direction: Direction, body: string): Message {
  return {
    id, rfcMessageId: `<${id}@x>`, references: [],
    from: { name: 'Sarah', email: 'sarah@acme.com' }, to: [{ email: 'me@x.com' }], cc: [],
    subject: 'S', bodyText: body, hasListUnsubscribe: false, date: 1, direction,
  };
}

function thread(messages: Message[]): Thread {
  return {
    id: 't1', subject: 'Q3 partnership', participants: [], messages,
    lastMessageAt: 1, snippet: '', inInbox: true, labels: [],
  };
}

describe('prompt', () => {
  it('includes tone guidance, the injection guard, and the signature', () => {
    const s = buildSystemPrompt({ tone: 'friendly', signature: '— Nathan' });
    expect(s).toContain('warm, friendly');
    expect(s).toContain('— Nathan');
    expect(s.toLowerCase()).toContain('untrusted');
  });

  it('discourages clichés and placeholders', () => {
    const s = buildSystemPrompt({ tone: 'professional' });
    expect(s).toMatch(/clich/i);
    expect(s).toMatch(/placeholder/i);
  });

  it('builds a delimited user prompt with subject and instruction', () => {
    const u = buildUserPrompt({
      thread: thread([msg('m1', 'inbound', 'Hello there')]),
      tone: 'professional',
      instruction: 'make it shorter',
    });
    expect(u).toContain('Thread subject: Q3 partnership');
    expect(u).toContain('<<<MESSAGE from Sarah>>>');
    expect(u).toContain('Hello there');
    expect(u).toContain('Additional instruction from the user: make it shorter');
    expect(u).toContain('Draft the reply body now.');
  });

  it('includes the prior draft when regenerating', () => {
    const u = buildUserPrompt({
      thread: thread([msg('m1', 'inbound', 'Hi')]),
      tone: 'direct',
      priorDraft: 'old draft text',
    });
    expect(u).toContain('Previous draft to revise:');
    expect(u).toContain('old draft text');
  });

  it('selects only the last N messages', () => {
    const messages = Array.from({ length: 9 }, (_, i) => msg(`m${i}`, 'inbound', `body ${i}`));
    const selected = selectContextMessages(messages);
    expect(selected.length).toBe(MAX_CONTEXT_MESSAGES);
    expect(selected[selected.length - 1].id).toBe('m8');
  });

  it('drops older messages past the char budget', () => {
    const big = 'x'.repeat(3000);
    const selected = selectContextMessages([msg('m1', 'inbound', big), msg('m2', 'inbound', big)], 5, 4000);
    expect(selected.map((m) => m.id)).toEqual(['m2']);
  });
});
