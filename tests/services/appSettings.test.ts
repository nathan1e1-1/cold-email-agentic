import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  hasStoredSettings, loadSettings, saveSettings, type StoredSettings,
} from '../../src/services/appSettings';

describe('appSettings defaults', () => {
  it('defaults to Gmail with an Outlook common tenant', () => {
    const s = loadSettings();
    expect(s.mailProvider).toBe('gmail');
    expect(s.outlookTenant).toBe('common');
    expect(s.outlookRedirectUri).toBe('http://localhost:8766');
  });
});

describe('appSettings persistence', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
      },
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('round-trips settings and flips hasStoredSettings', () => {
    expect(hasStoredSettings()).toBe(false);

    const settings: StoredSettings = {
      googleClientId: 'gid',
      redirectUri: 'http://127.0.0.1:8765',
      aiProvider: 'gemini',
      signature: '— Test',
      mailProvider: 'outlook',
      outlookClientId: '11111111-1111-1111-1111-111111111111',
      outlookTenant: 'contoso.onmicrosoft.com',
      outlookRedirectUri: 'http://localhost:8766',
    };

    saveSettings(settings);

    expect(hasStoredSettings()).toBe(true);
    expect(loadSettings()).toEqual(settings);
  });
});
