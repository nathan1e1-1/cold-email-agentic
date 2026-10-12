import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/db/schema';

describe('migrate', () => {
  it('creates all tables', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      'accounts', 'threads', 'messages', 'cards',
      'contacts', 'drafts', 'sends', 'settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    expect(() => migrate(db as any)).not.toThrow();
  });
});
