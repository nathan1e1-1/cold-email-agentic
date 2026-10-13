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

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

function rfc2822Date(d: Date): string {
  return d.toUTCString().replace('GMT', '+0000');
}

function defaultMessageId(from: string): string {
  const domain = from.includes('@') ? from.split('@')[1] : 'localhost';
  const rand = Math.random().toString(36).slice(2);
  return `<${Date.now()}.${rand}@${domain}>`;
}

export function buildMime(input: ComposeInput, opts: BuildMimeOptions = {}): string {
  const messageId = opts.messageId ?? defaultMessageId(input.from);
  const date = opts.date ?? new Date();

  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
  ];
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${input.cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Message-ID: ${messageId}`);
  headers.push(`Date: ${rfc2822Date(date)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references && input.references.length > 0) {
    headers.push(`References: ${input.references.join(' ')}`);
  }
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: base64');
  if (input.listUnsubscribeMailto) {
    headers.push(`List-Unsubscribe: <${input.listUnsubscribeMailto}>`);
  }

  const body = utf8ToBase64(input.bodyText).replace(/(.{76})/g, `$1${CRLF}`);
  return headers.join(CRLF) + CRLF + CRLF + body;
}

export function buildRawMessage(input: ComposeInput, opts?: BuildMimeOptions): string {
  return utf8ToBase64Url(buildMime(input, opts));
}