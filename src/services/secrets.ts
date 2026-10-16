import { invoke } from '@tauri-apps/api/core';

// Secrets live in the macOS Keychain. Every read/write crosses into the OS and
// can trigger a keychain-access prompt, so cache values in memory for the
// session and skip no-op writes.
const cache = new Map<string, string | null>();

export async function getSecret(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = await invoke<string | null>('secret_get', { key });
  cache.set(key, value ?? null);
  return value ?? null;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (cache.get(key) === value) return;
  await invoke('secret_set', { key, value });
  cache.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  await invoke('secret_delete', { key });
  cache.delete(key);
}
