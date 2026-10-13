import type { Address, Message, Thread } from '../domain/types';
import { computeDirection } from '../services/kanban';
import { base64UrlToUtf8 } from './encoding';
import { decodeRfc2047 } from './rfc2047';

export interface GmailHeader { name: string; value: string }
export interface GmailBody { data?: string; size?: number; attachmentId?: string }
export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
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
  historyId?: string;
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
  if (!data) return '';
  try {
    return base64UrlToUtf8(data);
  } catch {
    return '';
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function collectBody(payload: GmailPayload | undefined): { text: string; html?: string } {
  let text = '';
  let html = '';
  const walk = (p: GmailPayload | undefined): void => {
    if (!p || p.filename) return;
    if (p.parts) {
      for (const part of p.parts) walk(part);
      return;
    }
    if (!p.body?.data) return;
    const mime = p.mimeType ?? '';
    if (mime === 'text/html') {
      if (!html) html = decode(p.body.data);
    } else if (mime === 'text/plain' || mime === '') {
      if (!text) text = decode(p.body.data);
    }
  };
  walk(payload);
  return { text: text || (html ? stripHtml(html) : ''), html: html || undefined };
}

export function collectTextBody(payload: GmailPayload | undefined): string {
  return collectBody(payload).text;
}

function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let angleDepth = 0;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) {
      current += c;
      escaped = false;
      continue;
    }
    if (c === '\\') {
      current += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inQuote = !inQuote;
      current += c;
      continue;
    }
    if (c === '<') angleDepth++;
    else if (c === '>') angleDepth = Math.max(0, angleDepth - 1);
    if (c === ',' && !inQuote && angleDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((s) => s.trim()).filter(Boolean);
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
  return splitAddressList(value).map(parseAddress);
}

export function parseMessage(res: GmailMessageResource, ownEmail: string): Message {
  const headers = res.payload?.headers;
  const from = parseAddress(headerValue(headers, 'From'));
  const references = headerValue(headers, 'References').split(/\s+/).filter(Boolean);
  const body = collectBody(res.payload);
  const listUnsubscribe = headerValue(headers, 'List-Unsubscribe').trim();
  return {
    id: res.id,
    rfcMessageId: headerValue(headers, 'Message-ID'),
    references,
    from,
    to: parseAddressList(headerValue(headers, 'To')),
    cc: parseAddressList(headerValue(headers, 'Cc')),
    subject: decodeRfc2047(headerValue(headers, 'Subject')),
    bodyText: body.text,
    bodyHtml: body.html,
    hasListUnsubscribe: listUnsubscribe !== '' && listUnsubscribe !== '<>',
    date: Number(res.internalDate ?? 0),
    direction: computeDirection(from, ownEmail),
  };
}

export function parseThread(res: GmailThreadResource, ownEmail: string): Thread {
  const messages = (res.messages ?? []).map((m) => parseMessage(m, ownEmail));
  const participants: Address[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const a of [m.from, ...m.to, ...m.cc]) {
      const key = a.email.toLowerCase();
      if (a.email && !seen.has(key)) {
        seen.add(key);
        participants.push(a);
      }
    }
  }
  const labels = Array.from(new Set((res.messages ?? []).flatMap((m) => m.labelIds ?? [])));
  const lastMessageAt = messages.length > 0 ? Math.max(...messages.map((m) => m.date)) : 0;
  return {
    id: res.id,
    subject: messages[0]?.subject ?? '',
    participants,
    messages,
    lastMessageAt,
    snippet: res.snippet ?? '',
    inInbox: labels.includes('INBOX'),
    labels,
  };
}
