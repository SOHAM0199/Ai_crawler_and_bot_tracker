'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/crawler-watch.db';
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH, {
  verbose: process.env.NODE_ENV === 'development' ? undefined : undefined,
});

// Enable WAL mode for concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    domain      TEXT    NOT NULL,
    sync_url    TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS log_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    format      TEXT    NOT NULL DEFAULT 'apache',
    ingested_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    row_count   INTEGER NOT NULL DEFAULT 0,
    checksum    TEXT,
    date_from   INTEGER,
    date_to     INTEGER
  );

  CREATE TABLE IF NOT EXISTS log_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    log_file_id  INTEGER REFERENCES log_files(id) ON DELETE CASCADE,
    ts           INTEGER NOT NULL,
    ip           TEXT,
    method       TEXT,
    url_path     TEXT,
    status_code  INTEGER,
    bytes        INTEGER,
    referrer     TEXT,
    user_agent   TEXT,
    is_bot       INTEGER NOT NULL DEFAULT 0,
    bot_name     TEXT,
    bot_group    TEXT,
    bot_category TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    synced_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    status      TEXT    NOT NULL DEFAULT 'pending',
    new_rows    INTEGER NOT NULL DEFAULT 0,
    file_size   INTEGER NOT NULL DEFAULT 0,
    checksum    TEXT,
    notes       TEXT
  );

  -- Base Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_entries_project_ts   ON log_entries(project_id, ts);
  CREATE INDEX IF NOT EXISTS idx_entries_project_bot  ON log_entries(project_id, bot_name);
  CREATE INDEX IF NOT EXISTS idx_entries_project_url  ON log_entries(project_id, url_path);
  CREATE INDEX IF NOT EXISTS idx_entries_status       ON log_entries(project_id, status_code);
  CREATE INDEX IF NOT EXISTS idx_entries_is_bot       ON log_entries(project_id, is_bot);
  CREATE INDEX IF NOT EXISTS idx_entries_bot_group    ON log_entries(project_id, bot_group);
  CREATE INDEX IF NOT EXISTS idx_entries_bot_status   ON log_entries(project_id, is_bot, status_code);
`);

// Migration for existing databases created before bot_category column was added
try {
  db.exec('ALTER TABLE log_entries ADD COLUMN bot_category TEXT');
} catch (e) {
  // Column already exists, ignore error
}

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_entries_bot_category ON log_entries(project_id, bot_category)');
} catch (e) {
  // Index already exists, ignore error
}

module.exports = db;
