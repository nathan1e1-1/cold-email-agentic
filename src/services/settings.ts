import type { Repository } from '../db/repository';

// Authoritative defaults from spec §6 "Settings keys".
export const SETTING_DEFAULTS: Record<string, string> = {
  display_name: '',
  own_email: '',
  signature: '',
  mailing_address: '',
  unsubscribe_line: '',
  unsubscribe_mailto: '',
  rate_limit_per_day: '25',
  rate_limit_per_minute: '3',
  ai_provider: 'gemini',
  ai_key_ref: '',
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export class SettingsService {
  private repo: Repository;
  constructor(repo: Repository) {
    this.repo = repo;
  }

  async get(key: SettingKey): Promise<string> {
    const v = await this.repo.getSetting(key);
    return v ?? SETTING_DEFAULTS[key];
  }

  async getInt(key: SettingKey): Promise<number> {
    return Number(await this.get(key));
  }

  async set(key: SettingKey, value: string): Promise<void> {
    await this.repo.setSetting(key, value);
  }
}
