import type { Address, Message, Thread } from '../domain/types';
import { computeDirection } from '../services/kanban';
import { base64UrlToUtf8 } from './encoding';
import { decodeRfc2047 } from './rfc2047';

export interface GmailHeader { name: string; value: string }
export interface GmailBody { data?: string; size?: number }
export interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
}
export interface GmailMessageResource {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}
export interface GmailThreadResource {
  id: string;
  historyId?: string;
  snippet?: string;
  messages?: GmailMessageResource[];
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function decode(data: string | undefined): string {
  return data ? base64UrlToUtf8(data) : '';
}

export function collectTextBody(payload: GmailPayload | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = collectTextBody(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decode(payload.body.data);
  return '';
}

function parseAddress(value: string): Address {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match) {
    const name = decodeRfc2047(match[1].replace(/^"|"$/g, '').trim());
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: value.trim() };
}

function parseAddressList(value: string): Address[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAddress);
}

export function parseMessage(res: GmailMessageResource, ownEmail: string): Message {
  const headers = res.payload?.headers;
  const from = parseAddress(headerValue(headers, 'From'));
  const references = headerValue(headers, 'References').split(/\s+/).filter(Boolean);
  return {
    id: res.id,
    rfcMessageId: headerValue(headers, 'Message-ID'),
    references,
    from,
    to: parseAddressList(headerValue(headers, 'To')),
    cc: parseAddressList(headerValue(headers, 'Cc')),
    subject: decodeRfc2047(headerValue(headers, 'Subject')),
    bodyText: collectTextBody(res.payload),
    hasListUnsubscribe: headerValue(headers, 'List-Unsubscribe') !== '',
    date: Number(res.internalDate ?? 0),
    direction: computeDirection(from, ownEmail),
  };
}

export function parseThread(res: GmailThreadResource, ownEmail: string): Thread {
  const messages = (res.messages ?? []).map((m) => parseMessage(m, ownEmail));
  const last = messages[messages.length - 1];
  const participants: Address[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const a of [m.from, ...m.to]) {
      const key = a.email.toLowerCase();
      if (a.email && !seen.has(key)) {
        seen.add(key);
        participants.push(a);
      }
    }
  }
  const inInbox = (res.messages ?? []).some((m) => m.labelIds?.includes('INBOX'));
  return {
    id: res.id,
    subject: messages[0]?.subject ?? '',
    participants,
    messages,
    lastMessageAt: last?.date ?? 0,
    snippet: res.snippet ?? '',
    inInbox,
    labels: res.messages?.[0]?.labelIds ?? [],
  };
}
