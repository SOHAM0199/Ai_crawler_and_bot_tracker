'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/database');
const { syncProject } = require('../services/syncService');

// GET /api/projects/:projectId/sync/history
router.get('/history', (req, res) => {
  const history = db
    .prepare('SELECT * FROM sync_history WHERE project_id = ? ORDER BY synced_at DESC LIMIT 100')
    .all(req.params.projectId);
  res.json(history);
});

// POST /api/projects/:projectId/sync/trigger
router.post('/trigger', async (req, res) => {
  try {
    const result = await syncProject(+req.params.projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/sync/status
router.get('/status', (req, res) => {
  const last = db
    .prepare('SELECT * FROM sync_history WHERE project_id = ? ORDER BY synced_at DESC LIMIT 1')
    .get(req.params.projectId);
  res.json(last || { status: 'never' });
});

module.exports = router;
