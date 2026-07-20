import { query, testConnection } from './index';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('website', 'contract')),
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 1 AND risk_score <= 10),
  risks JSONB NOT NULL DEFAULT '[]',
  key_points JSONB,
  original_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses(user_id, created_at DESC);
`;

export async function runMigrations() {
  const connected = await testConnection();
  if (!connected) {
    console.warn('[PG] Skipping migrations — database not available.');
    return false;
  }

  try {
    await query(SCHEMA_SQL);
    console.log('[PG] Migrations applied successfully.');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PG] Migration failed:', msg);
    return false;
  }
}
