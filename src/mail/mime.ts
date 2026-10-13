import { utf8ToBase64, utf8ToBase64Url } from './encoding';

export interface ComposeInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribeMailto?: string;
}

export interface BuildMimeOptions {
  messageId?: string;
  date?: Date;
}

const CRLF = '\r\n';

function assertHeaderSafe(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Header value must not contain CR/LF');
  return value;
}

function encodeHeaderValue(value: string): string {
  assertHeaderSafe(value);
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let buffer = '';
  let bytes = 0;
  for (const ch of value) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 33) {
      words.push(buffer);
      buffer = '';
      bytes = 0;
    }
    buffer += ch;
    bytes += size;
  }
  if (buffer) words.push(buffer);
  return words.map((w) => `=?UTF-8?B?${utf8ToBase64(w)}?=`).join(`${CRLF} `);
}

function rfc2822Date(d: Date): string {
  return d.toUTCString().replace('GMT', '+0000');
}

function defaultMessageId(from: string): string {
  const domain = /@([^>\s]+)/.exec(from)?.[1] ?? 'localhost';
  const unique =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return `<${unique}@${domain}>`;
}

function foldBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

export function buildMime(input: ComposeInput, opts: BuildMimeOptions = {}): string {
  if (input.to.length === 0) throw new Error('At least one recipient is required');

  const messageId = opts.messageId ?? defaultMessageId(input.from);
  const date = opts.date ?? new Date();

  const headers: string[] = [
    `From: ${assertHeaderSafe(input.from)}`,
    `To: ${input.to.map(assertHeaderSafe).join(', ')}`,
  ];
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${input.cc.map(assertHeaderSafe).join(', ')}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Message-ID: ${assertHeaderSafe(messageId)}`);
  headers.push(`Date: ${rfc2822Date(date)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${assertHeaderSafe(input.inReplyTo)}`);
  if (input.references && input.references.length > 0) {
    headers.push(`References: ${input.references.map(assertHeaderSafe).join(' ')}`);
  }
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: base64');
  if (input.listUnsubscribeMailto) {
    headers.push(`List-Unsubscribe: <${assertHeaderSafe(input.listUnsubscribeMailto)}>`);
  }

  const normalizedBody = input.bodyText.replace(/\r\n|\r|\n/g, CRLF);
  const body = foldBase64(utf8ToBase64(normalizedBody));
  return headers.join(CRLF) + CRLF + CRLF + body;
}

export function buildRawMessage(input: ComposeInput, opts?: BuildMimeOptions): string {
  return utf8ToBase64Url(buildMime(input, opts));
}