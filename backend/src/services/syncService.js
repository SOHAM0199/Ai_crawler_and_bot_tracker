'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const db = require('../db/database');
const { ingestLogFile } = require('./logIngestion');

const DATA_DIR = process.env.LOG_DIR || './data/logs';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Fetch the remote log file for a project, version it safely, and ingest if new.
 * Returns a sync_history result object.
 */
async function syncProject(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project || !project.sync_url) {
    return recordSync(projectId, 'skipped', 0, 0, null, 'No sync_url configured');
  }

  const projectDir = path.join(DATA_DIR, `project_${projectId}`);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  let fileSize = 0;
  let checksum = null;
  let tempPath = null;

  try {
    // ── Fetch remote file ──────────────────────────────────────────────────
    const headers = {};
    if (process.env.SYNC_AUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.SYNC_AUTH_TOKEN}`;
    }

    const res = await fetch(project.sync_url, { headers, timeout: 30000 });
    if (!res.ok) {
      return recordSync(projectId, 'error', 0, 0, null, `HTTP ${res.status} from sync URL`);
    }

    const buffer = await res.buffer();
    fileSize = buffer.length;
    checksum = crypto.createHash('md5').update(buffer).digest('hex');

    // ── Check if already stored (same checksum as last sync) ───────────────
    const lastSync = db
      .prepare(
        `SELECT checksum FROM sync_history WHERE project_id=? AND status='success' ORDER BY synced_at DESC LIMIT 1`
      )
      .get(projectId);

    if (lastSync && lastSync.checksum === checksum) {
      return recordSync(projectId, 'no_change', 0, fileSize, checksum, 'File unchanged since last sync');
    }

    // ── Archive previous copy ─────────────────────────────────────────────
    const dateStamp = new Date().toISOString().slice(0, 10);
    const currentPath = path.join(projectDir, 'latest.log.gz');
    if (fs.existsSync(currentPath)) {
      const archivePath = path.join(projectDir, `archive-${dateStamp}.log.gz`);
      fs.copyFileSync(currentPath, archivePath);
    }

    // ── Save new file ─────────────────────────────────────────────────────
    fs.writeFileSync(currentPath, buffer);
    tempPath = currentPath;

    // ── Ingest into DB ────────────────────────────────────────────────────
    const result = await ingestLogFile(projectId, tempPath);

    // Update project last_synced_at
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId);

    return recordSync(projectId, 'success', result.rowCount, fileSize, checksum, null);
  } catch (err) {
    return recordSync(projectId, 'error', 0, fileSize, checksum, err.message);
  }
}

function recordSync(projectId, status, newRows, fileSize, checksum, notes) {
  const result = db
    .prepare(
      `INSERT INTO sync_history (project_id, status, new_rows, file_size, checksum, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, status, newRows, fileSize, checksum, notes);
  return { id: result.lastInsertRowid, project_id: projectId, status, new_rows: newRows, file_size: fileSize, notes };
}

/**
 * Sync all projects that have a sync_url configured.
 */
async function syncAll() {
  const projects = db.prepare(`SELECT id FROM projects WHERE sync_url IS NOT NULL AND sync_url != ''`).all();
  const results = [];
  for (const p of projects) {
    const r = await syncProject(p.id);
    results.push(r);
  }
  return results;
}

module.exports = { syncProject, syncAll };
