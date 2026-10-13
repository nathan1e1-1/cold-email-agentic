import { base64ToBytes } from './encoding';

function decoderFor(charset: string): InstanceType<typeof TextDecoder> {
  const cs = charset.toLowerCase();
  if (cs === 'utf-8' || cs === 'utf8') return new TextDecoder('utf-8');
  return new TextDecoder('latin1');
}

function decodeWord(charset: string, encoding: string, text: string): string {
  if (encoding.toUpperCase() === 'B') {
    return decoderFor(charset).decode(base64ToBytes(text));
  }
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '_') {
      bytes.push(0x20);
    } else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }
  return decoderFor(charset).decode(new Uint8Array(bytes));
}

export function decodeRfc2047(value: string): string {
  const joined = value.replace(/\?=(\s+)(?==\?)/g, '?=');
  return joined.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, charset, encoding, text) => decodeWord(charset, encoding, text),
  );
}
