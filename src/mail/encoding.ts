export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBase64(u: string): string {
  const b = u.replace(/-/g, '+').replace(/_/g, '/');
  const rem = b.length % 4;
  const pad = rem === 2 || rem === 3 ? '='.repeat(4 - rem) : '';
  return b + pad;
}

export function utf8ToBase64Url(s: string): string {
  return toBase64Url(utf8ToBase64(s));
}

export function base64UrlToUtf8(u: string): string {
  return base64ToUtf8(base64UrlToBase64(u));
}
