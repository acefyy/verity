export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS intake_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  reporter_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  target_message_id TEXT NOT NULL,
  reported_user_id TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intake_lookup ON intake_sessions(session_id, used, expires_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  report_code TEXT UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_link TEXT NOT NULL,
  reported_user_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  discord_reports_msg_id TEXT,
  discord_thread_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_guild_status ON reports(guild_id, status);

CREATE TABLE IF NOT EXISTS report_evidence_metadata (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  detected_mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  discord_cdn_url TEXT NOT NULL,
  discord_attachment_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_report ON report_evidence_metadata(report_id);
`;
