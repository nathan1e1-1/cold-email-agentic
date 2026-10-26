import { describe, it, expect } from 'vitest';
import {
  MicrosoftGraphProvider,
  escapeODataString,
} from '../../src/mail/microsoftGraphProvider';
import type { Authenticator } from '../../src/mail/oauth';
import type { GraphMessage } from '../../src/mail/outlookParse';
import { FakeHttpClient } from './fakeHttp';

const PREFER = 'IdType="ImmutableId", outlook.body-content-type="text"';

const auth: Authenticator = {
  auth: async () => {},
  isAuthed: async () => true,
  getAccessToken: async () => 'TOKEN',
};

function provider(http: FakeHttpClient): MicrosoftGraphProvider {
  return new MicrosoftGraphProvider({ http, auth });
}

function msg(id: string): GraphMessage {
  return { id };
}

function selected(url: string): string[] {
  return (new URL(url).searchParams.get('$select') ?? '').split(',');
}

describe('MicrosoftGraphProvider', () => {
  it('reads the profile with a bearer token and preferences', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ mail: 'me@x.com', displayName: 'Me' }),
    });

    expect(await provider(http).getProfile()).toEqual({
      emailAddress: 'me@x.com',
      displayName: 'Me',
    });

    const req = http.requests[0];
    expect(req.method).toBe('GET');
    expect(req.headers?.Authorization).toBe('Bearer TOKEN');
    expect(req.headers?.Prefer).toBe(PREFER);
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me');
    expect(url.searchParams.get('$select')).toBe('mail,userPrincipalName,displayName');
  });

  it('falls back to userPrincipalName for the profile email', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ userPrincipalName: 'upn@x.com' }),
    });
    expect((await provider(http).getProfile()).emailAddress).toBe('upn@x.com');
  });

  it('rejects a profile without an email', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ displayName: 'No Mail' }),
    });
    await expect(provider(http).getProfile()).rejects.toThrow(
      'Microsoft Graph: profile has no email',
    );
  });

  it('resolves a well-known folder id', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ id: 'folder-1' }),
    });

    expect(await provider(http).getFolderId('junkemail')).toBe('folder-1');

    const url = new URL(http.requests[0].url);
    expect(url.origin + url.pathname).toBe(
      'https://graph.microsoft.com/v1.0/me/mailFolders/junkemail',
    );
    expect(url.searchParams.get('$select')).toBe('id');
    expect(http.requests[0].headers?.Authorization).toBe('Bearer TOKEN');
  });

  it('lists all mail from the me/messages endpoint', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ value: [] }),
    });

    await provider(http).listMessages({ folder: 'all', top: 7 });

    const url = new URL(http.requests[0].url);
    expect(url.pathname).toBe('/v1.0/me/messages');
    expect(url.searchParams.get('$top')).toBe('7');
  });

  it('lists inbox messages with query params and follows nextLink', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=NEXT';
    const http = new FakeHttpClient().onRequest((req) =>
      req.url.includes('skiptoken=NEXT')
        ? { status: 200, body: JSON.stringify({ value: [msg('m2')] }) }
        : {
            status: 200,
            body: JSON.stringify({ value: [msg('m1')], '@odata.nextLink': next }),
          },
    );
    const p = provider(http);

    const page = await p.listMessages({
      folder: 'inbox',
      top: 5,
      filter: "from/emailAddress/address eq 'a@b.com'",
    });
    expect(page.messages.map((m) => m.id)).toEqual(['m1']);
    expect(page.nextLink).toBe(next);

    const url = new URL(http.requests[0].url);
    expect(url.origin + url.pathname).toBe(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages',
    );
    expect(url.searchParams.get('$top')).toBe('5');
    expect(selected(http.requests[0].url)).toContain('bodyPreview');
    expect(selected(http.requests[0].url)).toContain('parentFolderId');
    expect(selected(http.requests[0].url)).toContain('internetMessageHeaders');
    expect(selected(http.requests[0].url)).not.toContain('body');
    expect(url.searchParams.get('$orderby')).toBeNull();
    expect(url.searchParams.get('$filter')).toBe("from/emailAddress/address eq 'a@b.com'");
    expect(http.requests[0].headers?.Authorization).toBe('Bearer TOKEN');
    expect(http.requests[0].headers?.Prefer).toBe(PREFER);

    const page2 = await p.listMessages({ nextLink: next });
    expect(http.requests[1].url).toBe(next);
    expect(http.requests[1].headers?.Prefer).toBe(PREFER);
    expect(page2.messages.map((m) => m.id)).toEqual(['m2']);
    expect(page2.nextLink).toBeNull();
  });

  it('defaults to the inbox folder and page size', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ value: [] }),
    });
    const page = await provider(http).listMessages({});
    expect(new URL(http.requests[0].url).pathname).toBe(
      '/v1.0/me/mailFolders/inbox/messages',
    );
    expect(new URL(http.requests[0].url).searchParams.get('$top')).toBe('20');
    expect(page.nextLink).toBeNull();
  });

  it('refuses a nextLink that is not on the Graph host', async () => {
    const http = new FakeHttpClient();
    await expect(
      provider(http).listMessages({ nextLink: 'https://evil.example/me/messages' }),
    ).rejects.toThrow('Microsoft Graph: refusing non-Graph nextLink');
    expect(http.requests).toHaveLength(0);
  });

  it('gets a single message and rejects an empty response', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ id: 'm1', subject: 'Hi' }),
    });
    expect((await provider(http).getMessage('m1')).id).toBe('m1');
    const url = new URL(http.requests[0].url);
    expect(url.pathname).toBe('/v1.0/me/messages/m1');
    expect(selected(http.requests[0].url)).toContain('conversationId');
    expect(selected(http.requests[0].url)).toContain('body');

    const empty = new FakeHttpClient().queueResponse({ status: 200, body: '{}' });
    await expect(provider(empty).getMessage('gone')).rejects.toThrow(/empty response/);
  });

  it('lists a conversation with an escaped filter and pagination', async () => {
    const page2 = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=PAGE2';
    const http = new FakeHttpClient().onRequest((req) =>
      req.url.includes('skiptoken=PAGE2')
        ? { status: 200, body: JSON.stringify({ value: [msg('m2')] }) }
        : {
            status: 200,
            body: JSON.stringify({ value: [msg('m1')], '@odata.nextLink': page2 }),
          },
    );

    const messages = await provider(http).listConversation("a'b", 10);
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(http.requests).toHaveLength(2);
    expect(http.requests[1].url).toBe(page2);
    expect(http.requests[1].headers?.Prefer).toBe(PREFER);

    const url = new URL(http.requests[0].url);
    expect(url.pathname).toBe('/v1.0/me/messages');
    expect(url.searchParams.get('$filter')).toBe(
      `conversationId eq '${escapeODataString("a'b")}'`,
    );
    expect(url.searchParams.get('$filter')).toBe("conversationId eq 'a''b'");
    expect(url.searchParams.get('$top')).toBe('10');
    expect(url.searchParams.get('$orderby')).toBeNull();
    expect(selected(http.requests[0].url)).toContain('body');
  });

  it('escapes OData string literals', () => {
    expect(escapeODataString("a'b")).toBe("a''b");
  });

  it('caps the conversation page size at 100', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({ value: [] }),
    });
    await provider(http).listConversation('c1', 500);
    expect(new URL(http.requests[0].url).searchParams.get('$top')).toBe('100');
  });

  it('sends mail with the Graph message shape', async () => {
    const http = new FakeHttpClient().queueResponse({ status: 202, body: '' });
    await provider(http).sendMail({
      to: ['a@b.com', 'c@d.com'],
      subject: 'Hello',
      bodyText: 'Body text',
    });

    const req = http.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(req.headers?.Authorization).toBe('Bearer TOKEN');
    expect(req.headers?.Prefer).toBe(PREFER);
    expect(req.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.body as string)).toEqual({
      message: {
        subject: 'Hello',
        body: { contentType: 'Text', content: 'Body text' },
        toRecipients: [
          { emailAddress: { address: 'a@b.com' } },
          { emailAddress: { address: 'c@d.com' } },
        ],
      },
      saveToSentItems: true,
    });
  });

  it('replies to a message', async () => {
    const http = new FakeHttpClient().queueResponse({ status: 202, body: '' });
    await provider(http).reply('m1', 'Thanks');

    const req = http.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/messages/m1/reply');
    expect(req.headers?.Authorization).toBe('Bearer TOKEN');
    expect(req.headers?.Prefer).toBe(PREFER);
    expect(JSON.parse(req.body as string)).toEqual({ comment: 'Thanks' });
  });

  it('moves a message', async () => {
    const http = new FakeHttpClient().queueResponse({ status: 202, body: '' });
    await provider(http).move('m1', 'deleteditems');

    const req = http.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/me/messages/m1/move');
    expect(req.headers?.Authorization).toBe('Bearer TOKEN');
    expect(req.headers?.Prefer).toBe(PREFER);
    expect(JSON.parse(req.body as string)).toEqual({ destinationId: 'deleteditems' });
  });

  it('throws on non-2xx responses with the status and body', async () => {
    const http = new FakeHttpClient().queueResponse({ status: 500, body: 'boom' });
    await expect(provider(http).sendMail({
      to: ['a@b.com'], subject: 'Hi', bodyText: 'x',
    })).rejects.toThrow('Microsoft Graph sendMail: HTTP 500: boom');
  });

  it('surfaces Graph error JSON in a readable form', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 404,
      body: JSON.stringify({
        error: { code: 'ErrorItemNotFound', message: 'nope' },
      }),
    });
    await expect(provider(http).getMessage('m1')).rejects.toThrow(
      'Microsoft Graph getMessage m1: HTTP 404 ErrorItemNotFound: nope',
    );
  });
});
