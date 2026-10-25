import type { Repository } from '../db/repository';

// Authoritative defaults from spec §6 "Settings keys".
export const SETTING_DEFAULTS = {
  display_name: '',
  own_email: '',
  signature: '',
  rate_limit_per_day: '25',
  rate_limit_per_minute: '3',
  ai_provider: 'gemini',
  ai_key_ref: '',
} as const satisfies Record<string, string>;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export class SettingsService {
  private repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  async get(key: SettingKey): Promise<string> {
    const v = await this.repo.getSetting(key);
    if (v !== null) return v;
    return SETTING_DEFAULTS[key];
  }

  async getInt(key: SettingKey): Promise<number> {
    const raw = await this.get(key);
    const trimmed = raw.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      throw new Error(`Setting "${key}" is not numeric: ${JSON.stringify(raw)}`);
    }
    return n;
  }

  async set(key: SettingKey, value: string): Promise<void> {
    await this.repo.setSetting(key, value);
  }
}
