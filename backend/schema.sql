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

-- ───── Licenses (Phase 3: subscription + machine binding) ────────────────
-- One row per issued license key. Status governs everything:
--   active     → app works
--   revoked    → hard block, no grace
--   suspended  → temporary disable (e.g. payment issue), customer can resume
-- expires_at: required for annual subscriptions; NULL = perpetual (not used yet).
-- bound_installation_id: set on first activation, NEVER unset by the client.
--   Admin can clear via /admin/license/<key>/unbind to allow machine transfer.
-- grace_period_days: how many days after expires_at the app keeps working with
--   a warning dialog. Default 14.
CREATE TABLE IF NOT EXISTS licenses (
    license_key             TEXT PRIMARY KEY,
    customer_name           TEXT,
    customer_email          TEXT,
    issued_at               INTEGER NOT NULL,
    expires_at              INTEGER,                   -- unix ms; NULL = perpetual
    grace_period_days       INTEGER NOT NULL DEFAULT 14,
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'revoked', 'suspended')),
    revoked_at              INTEGER,
    revoked_reason          TEXT,
    bound_installation_id   TEXT,
    bound_at                INTEGER,
    last_validated_at       INTEGER,
    notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_lic_status   ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_lic_bound    ON licenses(bound_installation_id);
CREATE INDEX IF NOT EXISTS idx_lic_expires  ON licenses(expires_at);

-- ───── Support commands (Phase 5: remote diagnostics inbox) ─────────────
-- Admin queues a command for a specific installation; the desktop polls on
-- next launch (after auth, so DB is unlocked) and uploads the result. Only
-- read-only diagnostic commands are supported — no destructive operations.
CREATE TABLE IF NOT EXISTS support_commands (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    installation_id     TEXT NOT NULL,
    command             TEXT NOT NULL
                        CHECK (command IN ('collect_diagnostic', 'collect_integrity')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    created_at          INTEGER NOT NULL,
    dispatched_at       INTEGER,
    completed_at        INTEGER,
    result_payload      TEXT,        -- JSON blob from desktop
    error               TEXT,
    note                TEXT         -- admin-supplied context, e.g. ticket #
);

CREATE INDEX IF NOT EXISTS idx_support_cmd_install ON support_commands(installation_id, status);
CREATE INDEX IF NOT EXISTS idx_support_cmd_created ON support_commands(created_at DESC);

-- ───── App config (Phase 4: force-update + future remote settings) ───────
-- Generic key/value store for server-controlled settings. First use is
-- min_supported_version: desktop refuses to launch if its version is below
-- this. Empty / unset = no minimum.
CREATE TABLE IF NOT EXISTS app_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);
