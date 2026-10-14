import { describe, it, expect } from 'vitest';
import { GroqProvider } from '../../src/ai/groqProvider';
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
  lastMessageAt: 1, snippet: '', inInbox: true, labels: [],
};

describe('GroqProvider', () => {
  it('posts an OpenAI-compatible chat request and parses the draft', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: '  Hi there  ' } }] }),
    });
    const provider = new GroqProvider({ http, apiKey: 'GKEY' });
    expect(await provider.generate({ thread, ownEmail: 'me@x.com', tone: 'professional' })).toBe('Hi there');

    const req = http.requests[0];
    expect(req.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(req.headers?.Authorization).toBe('Bearer GKEY');
    const body = JSON.parse(req.body as string) as {
      model: string; messages: { role: string; content: string }[];
    };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('untrusted');
    expect(body.messages[1].content).toContain('Are you open to a call?');
  });

  it('retries on 503 and then succeeds', async () => {
    const http = new FakeHttpClient()
      .queueResponse({ status: 503, body: '{}' })
      .queueResponse({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) });
    const provider = new GroqProvider({ http, apiKey: 'K', sleep: async () => {} });
    expect(await provider.generate({ thread, ownEmail: 'me@x.com', tone: 'direct' })).toBe('ok');
  });

  it('throws on an API error', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 401,
      body: JSON.stringify({ error: { message: 'Invalid API Key' } }),
    });
    await expect(
      new GroqProvider({ http, apiKey: 'K' }).generate({ thread, ownEmail: 'me@x.com', tone: 'direct' }),
    ).rejects.toThrow(/Invalid API Key/);
  });

  it('advertises a groq descriptor', () => {
    expect(new GroqProvider({ http: new FakeHttpClient(), apiKey: 'K' }).descriptor).toEqual({
      id: 'groq',
      label: 'Groq',
      privacy: 'may-use-content',
      host: 'api.groq.com',
    });
  });
});
