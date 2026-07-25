'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/projects
router.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  const withStats = projects.map(p => {
    const range = db
      .prepare('SELECT MIN(ts) as min_ts, MAX(ts) as max_ts, COUNT(*) as row_count FROM log_entries WHERE project_id = ?')
      .get(p.id);
    return {
      ...p,
      date_from: range.min_ts ? new Date(range.min_ts).toISOString().slice(0, 10) : null,
      date_to: range.max_ts ? new Date(range.max_ts).toISOString().slice(0, 10) : null,
      entry_count: range.row_count || 0
    };
  });
  res.json(withStats);
});

// POST /api/projects
router.post('/', (req, res) => {
  const { name, domain, sync_url } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'name and domain are required' });

  const result = db
    .prepare('INSERT INTO projects (name, domain, sync_url) VALUES (?, ?, ?)')
    .run(name, domain, sync_url || null);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const logFiles = db
    .prepare('SELECT * FROM log_files WHERE project_id = ? ORDER BY ingested_at DESC')
    .all(req.params.id);

  const range = db
    .prepare('SELECT MIN(ts) as min_ts, MAX(ts) as max_ts, COUNT(*) as row_count FROM log_entries WHERE project_id = ?')
    .get(req.params.id);

  res.json({
    ...project,
    log_files: logFiles,
    entry_count: range.row_count || 0,
    date_from: range.min_ts ? new Date(range.min_ts).toISOString().slice(0, 10) : null,
    date_to: range.max_ts ? new Date(range.max_ts).toISOString().slice(0, 10) : null,
  });
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const { name, domain, sync_url } = req.body;
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  db.prepare('UPDATE projects SET name=?, domain=?, sync_url=?, updated_at=? WHERE id=?').run(
    name || existing.name,
    domain || existing.domain,
    sync_url !== undefined ? sync_url : existing.sync_url,
    Date.now(),
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ message: 'Project deleted' });
});

module.exports = router;
