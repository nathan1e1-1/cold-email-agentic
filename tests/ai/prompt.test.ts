import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt, buildUserPrompt, selectContextMessages, MAX_CONTEXT_MESSAGES,
  buildPromptPack, parseColdDraft,
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

  it('prefers a clarifying question over inventing commitments', () => {
    const s = buildSystemPrompt({ tone: 'professional' });
    expect(s).toMatch(/clarifying question/i);
    expect(s).toMatch(/never commit/i);
  });

  it('builds a delimited user prompt with subject and guidance', () => {
    const u = buildUserPrompt({
      thread: thread([msg('m1', 'inbound', 'Hello there')]),
      tone: 'professional',
      instruction: 'make it shorter',
    });
    expect(u).toContain('Subject: Q3 partnership');
    expect(u).toContain('<thread>');
    expect(u).toContain('<<<MESSAGE from Sarah>>>');
    expect(u).toContain('Hello there');
    expect(u).toContain('<user_guidance>');
    expect(u).toContain('make it shorter');
    expect(u).toContain('Draft the reply body now.');
  });

  it('includes the prior draft when regenerating', () => {
    const u = buildUserPrompt({
      thread: thread([msg('m1', 'inbound', 'Hi')]),
      tone: 'direct',
      priorDraft: 'old draft text',
    });
    expect(u).toContain('<prior_draft>');
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

  it('builds a cold prompt with the contact context and asks for a subject', () => {
    const pack = buildPromptPack({
      mode: 'cold',
      contact: { name: 'Dana', email: 'dana@acme.com', notes: 'met at the AI meetup' },
      ownEmail: 'me@x.com',
      tone: 'professional',
    });
    expect(pack.system).toMatch(/cold outreach/i);
    expect(pack.system).toMatch(/Subject:/);
    expect(pack.user).toContain('<contact>');
    expect(pack.user).toContain('dana@acme.com');
    expect(pack.user).toContain('met at the AI meetup');
  });

  it('parses a cold draft into subject and body', () => {
    expect(parseColdDraft('Subject: Quick question\n\nHi Dana, want to chat?')).toEqual({
      subject: 'Quick question',
      body: 'Hi Dana, want to chat?',
    });
  });

  it('falls back to body-only when there is no subject line', () => {
    expect(parseColdDraft('Just a body')).toEqual({ subject: null, body: 'Just a body' });
  });
});
