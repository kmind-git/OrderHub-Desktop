CREATE TABLE releases (
  release_id TEXT PRIMARY KEY,
  application TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('stable', 'beta')),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'paused', 'revoked')),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (application, version, channel)
);

CREATE INDEX idx_releases_lookup
  ON releases (application, channel, status);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(release_id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  arch TEXT NOT NULL,
  installer TEXT NOT NULL,
  url TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (release_id, target, arch, installer)
);

CREATE INDEX idx_artifacts_release ON artifacts (release_id);

CREATE TABLE channel_policies (
  channel TEXT PRIMARY KEY CHECK (channel IN ('stable', 'beta')),
  rollout_release_id TEXT REFERENCES releases(release_id),
  min_supported_version TEXT,
  min_supported_effective_at TEXT,
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  valid_for_seconds INTEGER NOT NULL DEFAULT 86400 CHECK (valid_for_seconds >= 300),
  updated_at TEXT NOT NULL
);

CREATE TABLE update_events (
  event_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  app_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  arch TEXT NOT NULL,
  installer TEXT NOT NULL,
  stage TEXT NOT NULL,
  error_category TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX idx_update_events_received ON update_events (received_at);
CREATE INDEX idx_update_events_installation ON update_events (installation_id, received_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
