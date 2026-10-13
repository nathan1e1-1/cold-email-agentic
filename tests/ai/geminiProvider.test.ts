import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../../src/ai/geminiProvider';
import { FakeHttpClient } from '../mail/fakeHttp';
import type { Thread } from '../../src/domain/types';

const thread: Thread = {
  id: 't1',
  subject: 'Q3 partnership',
  participants: [],
  messages: [
    {
      id: 'm1', rfcMessageId: '<m1@acme.com>', references: [],
      from: { name: 'Sarah', email: 'sarah@acme.com' }, to: [{ email: 'me@x.com' }], cc: [],
      subject: 'Q3 partnership', bodyText: 'Are you open to a call?', hasListUnsubscribe: false,
      date: 1, direction: 'inbound',
    },
  ],
  lastMessageAt: 1,
  snippet: '',
  inInbox: true,
  labels: [],
};

describe('GeminiProvider', () => {
  it('posts to the model with the API key and parses the draft', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '  Hi there  ' }] } }] }),
    });
    const provider = new GeminiProvider({ http, apiKey: 'KEY' });
    const draft = await provider.generate({ thread, ownEmail: 'me@x.com', tone: 'professional' });
    expect(draft).toBe('Hi there');

    const req = http.requests[0];
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(req.headers?.['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(req.body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
    };
    expect(body.systemInstruction.parts[0].text).toContain('untrusted');
    expect(body.contents[0].parts[0].text).toContain('Are you open to a call?');
  });

  it('throws on an API error', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 400,
      body: JSON.stringify({ error: { message: 'API key not valid' } }),
    });
    await expect(
      new GeminiProvider({ http, apiKey: 'K' }).generate({ thread, ownEmail: 'me@x.com', tone: 'direct' }),
    ).rejects.toThrow(/API key not valid/);
  });

  it('throws when the prompt is blocked', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }),
    });
    await expect(
      new GeminiProvider({ http, apiKey: 'K' }).generate({ thread, ownEmail: 'me@x.com', tone: 'direct' }),
    ).rejects.toThrow(/SAFETY/);
  });

  it('advertises a may-use-content descriptor', () => {
    const provider = new GeminiProvider({ http: new FakeHttpClient(), apiKey: 'K' });
    expect(provider.descriptor).toEqual({
      id: 'gemini',
      label: 'Gemini',
      privacy: 'may-use-content',
      host: 'generativelanguage.googleapis.com',
    });
  });
});
