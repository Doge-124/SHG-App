-- SHG Manager backend schema (D1 / SQLite).
--
-- Phase 1: installations + version history (telemetry baseline)
-- Phase 2: events (feature usage tracking)
-- Subsequent phases add: licenses, machine bindings, feature flags.

-- ───── Installations (heartbeat target) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS installations (
    installation_id     TEXT PRIMARY KEY,
    first_seen_at       INTEGER NOT NULL,      -- unix epoch milliseconds
    last_seen_at        INTEGER NOT NULL,
    current_version     TEXT NOT NULL,
    os                  TEXT,                  -- e.g. "windows"
    arch                TEXT,                  -- e.g. "x86_64"
    total_heartbeats    INTEGER NOT NULL DEFAULT 0,
    notes               TEXT                   -- optional, admin-edited (e.g. "ABC SHG, Sangli")
);

CREATE INDEX IF NOT EXISTS idx_inst_last_seen ON installations(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_inst_version   ON installations(current_version);

-- ───── Version history (one row per (installation, version) pair) ────────
CREATE TABLE IF NOT EXISTS version_history (
    installation_id     TEXT NOT NULL,
    version             TEXT NOT NULL,
    first_seen_at       INTEGER NOT NULL,
    PRIMARY KEY (installation_id, version)
);

CREATE INDEX IF NOT EXISTS idx_vh_version ON version_history(version, first_seen_at DESC);

-- ───── Events (Phase 2: feature usage) ───────────────────────────────────
-- Append-only. Each row = one tracked action ("member.created", "loan.issued"…).
-- Properties is a small JSON blob with metadata only -- NO PII (no member names,
-- phone numbers, addresses, or specific amounts). See `track_event` docs.
CREATE TABLE IF NOT EXISTS events (
    event_id            TEXT PRIMARY KEY,      -- client-generated UUID (dedup-safe)
    installation_id     TEXT NOT NULL,
    event_name          TEXT NOT NULL,         -- e.g. "loan.issued"
    properties          TEXT,                  -- JSON blob, may be NULL
    occurred_at         INTEGER NOT NULL,      -- unix epoch ms (client clock)
    received_at         INTEGER NOT NULL,      -- unix epoch ms (server clock)
    app_version         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ev_install_time ON events(installation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ev_name_time    ON events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ev_received     ON events(received_at DESC);
