import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface HttpAllowEntry { url?: string }
interface Capability {
  identifier?: string;
  allow?: HttpAllowEntry[];
}

describe('Tauri capabilities', () => {
  it('allows Microsoft login and Graph HTTP origins', () => {
    const path = new URL('../../src-tauri/capabilities/default.json', import.meta.url);
    const config = JSON.parse(readFileSync(path, 'utf8')) as { permissions: Capability[] };
    const http = config.permissions.find((permission) => permission.identifier === 'http:default');
    const urls = (http?.allow ?? []).map((entry) => entry.url);

    expect(urls).toContain('https://login.microsoftonline.com/*');
    expect(urls).toContain('https://graph.microsoft.com/*');
  });
});
