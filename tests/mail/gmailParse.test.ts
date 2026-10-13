import { describe, it, expect } from 'vitest';
import { parseMessage, parseThread, headerValue, collectTextBody } from '../../src/mail/gmailParse';
import { utf8ToBase64Url } from '../../src/mail/encoding';
import type { GmailMessageResource, GmailPayload } from '../../src/mail/gmailParse';

function messageResource(): GmailMessageResource {
  return {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX'],
    snippet: 'hello',
    internalDate: '1000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Sarah Chen <sarah@acme.com>' },
        { name: 'To', value: 'me@x.com' },
        { name: 'Cc', value: 'cc@acme.com' },
        { name: 'Subject', value: 'Q3' },
        { name: 'Message-ID', value: '<m1@acme.com>' },
        { name: 'References', value: '<m0@acme.com>' },
        { name: 'List-Unsubscribe', value: '<mailto:u@acme.com>' },
        { name: 'Date', value: 'Mon, 06 Oct 2026 09:05:00 +0000' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: utf8ToBase64Url('Hello there') } },
        { mimeType: 'text/html', body: { data: utf8ToBase64Url('<p>Hello there</p>') } },
      ],
    },
  };
}

describe('gmailParse', () => {
  it('reads header values case-insensitively', () => {
    const headers = [{ name: 'From', value: 'a@b.com' }];
    expect(headerValue(headers, 'from')).toBe('a@b.com');
    expect(headerValue(headers, 'missing')).toBe('');
  });

  it('collects the text/plain body', () => {
    expect(collectTextBody(messageResource().payload as GmailPayload)).toBe('Hello there');
  });

  it('parses a message with direction and threading fields', () => {
    const m = parseMessage(messageResource(), 'me@x.com');
    expect(m.id).toBe('m1');
    expect(m.from.name).toBe('Sarah Chen');
    expect(m.from.email).toBe('sarah@acme.com');
    expect(m.to.map((a) => a.email)).toEqual(['me@x.com']);
    expect(m.cc.map((a) => a.email)).toEqual(['cc@acme.com']);
    expect(m.subject).toBe('Q3');
    expect(m.rfcMessageId).toBe('<m1@acme.com>');
    expect(m.references).toEqual(['<m0@acme.com>']);
    expect(m.hasListUnsubscribe).toBe(true);
    expect(m.bodyText).toBe('Hello there');
    expect(m.direction).toBe('inbound');
    expect(m.date).toBe(1000);
  });

  it('marks messages from ownEmail as outbound', () => {
    const res = messageResource();
    res.payload!.headers = [{ name: 'From', value: 'me@x.com' }];
    expect(parseMessage(res, 'me@x.com').direction).toBe('outbound');
  });

  it('decodes RFC 2047 encoded subjects and display names', () => {
    const res = messageResource();
    res.payload!.headers = [
      { name: 'From', value: '=?UTF-8?B?Q2Fmw6k=?= <cafe@acme.com>' },
      { name: 'Subject', value: '=?UTF-8?B?Q2Fmw6kg4piV?=' },
    ];
    const m = parseMessage(res, 'me@x.com');
    expect(m.subject).toBe('Café ☕');
    expect(m.from.name).toBe('Café');
  });

  it('parses a thread with participants and inbox flag', () => {
    const t = parseThread({ id: 't1', historyId: '99', messages: [messageResource()] }, 'me@x.com');
    expect(t.id).toBe('t1');
    expect(t.subject).toBe('Q3');
    expect(t.messages.length).toBe(1);
    expect(t.inInbox).toBe(true);
    expect(t.participants.map((p) => p.email)).toContain('sarah@acme.com');
    expect(t.lastMessageAt).toBe(1000);
  });

  it('splits recipient lists without breaking quoted display names', () => {
    const res = messageResource();
    res.payload!.headers = [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: '"Doe, John" <j@x.com>, b@y.com' },
    ];
    const m = parseMessage(res, 'me@x.com');
    expect(m.to).toEqual([{ name: 'Doe, John', email: 'j@x.com' }, { email: 'b@y.com' }]);
  });

  it('separates text and html bodies and never puts markup in bodyText', () => {
    const res = messageResource();
    res.payload!.mimeType = 'multipart/alternative';
    res.payload!.parts = [{ mimeType: 'text/html', body: { data: utf8ToBase64Url('<p>Hi <b>there</b></p>') } }];
    const m = parseMessage(res, 'me@x.com');
    expect(m.bodyText).not.toContain('<');
    expect(m.bodyText).toBe('Hi there');
    expect(m.bodyHtml).toBe('<p>Hi <b>there</b></p>');
  });

  it('skips text/plain attachments when choosing the body', () => {
    const res = messageResource();
    res.payload!.mimeType = 'multipart/mixed';
    res.payload!.parts = [
      { mimeType: 'text/plain', body: { data: utf8ToBase64Url('the body') } },
      { mimeType: 'text/plain', filename: 'notes.txt', body: { data: utf8ToBase64Url('attachment text') } },
    ];
    expect(parseMessage(res, 'me@x.com').bodyText).toBe('the body');
  });

  it('does not throw on malformed body data', () => {
    const res = messageResource();
    res.payload!.parts = [{ mimeType: 'text/plain', body: { data: 'abcde' } }];
    expect(parseMessage(res, 'me@x.com').bodyText).toBe('');
  });

  it('does not treat an inline binary part as the body text', () => {
    const res: GmailMessageResource = {
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'multipart/related',
        parts: [
          { mimeType: 'text/html', body: { data: utf8ToBase64Url('<p>Hello</p>') } },
          { mimeType: 'image/png', body: { data: utf8ToBase64Url('\u0089PNG\u0000binarybytes') } },
        ],
      },
    };
    const m = parseMessage(res, 'me@x.com');
    expect(m.bodyText).toBe('Hello');
    expect(m.bodyHtml).toBe('<p>Hello</p>');
  });

  it('unions labels across messages and uses the max date', () => {
    const older = messageResource();
    older.id = 'm0';
    older.internalDate = '500';
    older.labelIds = ['SENT'];
    const newer = messageResource();
    newer.id = 'm2';
    newer.internalDate = '2000';
    newer.labelIds = ['INBOX'];
    const t = parseThread({ id: 't1', messages: [newer, older] }, 'me@x.com');
    expect(t.lastMessageAt).toBe(2000);
    expect([...t.labels].sort()).toEqual(['INBOX', 'SENT']);
    expect(t.inInbox).toBe(true);
  });
});
