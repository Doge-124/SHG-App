-- SHG Manager backend schema (D1 / SQLite).
--
-- Phase 1: telemetry only — installations + version history.
-- Subsequent phases add: events, licenses, machine bindings, feature flags.

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

-- Version history per installation — one row per (installation, version) combo.
-- Tells you when each customer upgraded to each version.
CREATE TABLE IF NOT EXISTS version_history (
    installation_id     TEXT NOT NULL,
    version             TEXT NOT NULL,
    first_seen_at       INTEGER NOT NULL,
    PRIMARY KEY (installation_id, version)
);

CREATE INDEX IF NOT EXISTS idx_vh_version ON version_history(version, first_seen_at DESC);
