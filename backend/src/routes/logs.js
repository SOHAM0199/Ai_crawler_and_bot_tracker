'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { ingestLogFile } = require('../services/logIngestion');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error('Failed to create UPLOAD_DIR:', e);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const pid = req.params.projectId || 'default';
      const dir = path.join(UPLOAD_DIR, `project_${pid}`);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = (file.originalname || 'logfile').replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, true);
  },
});

// Explicit OPTIONS preflight for upload endpoint
router.options('/upload', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.status(204).end();
});

// POST /api/projects/:projectId/logs/upload
router.post('/upload', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  upload.single('logfile')(req, res, async (err) => {
    if (err) {
      console.error('Multer file upload error:', err);
      return res.status(400).json({ error: err.message || 'File upload error' });
    }

    try {
      const { projectId } = req.params;
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        return res.status(404).json({ error: `Project #${projectId} not found` });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const format = req.body.format || null;
      const result = await ingestLogFile(+projectId, req.file.path, format);

      res.json({
        success: true,
        filename: req.file.originalname,
        ...result,
      });
    } catch (ingestErr) {
      console.error('Ingestion processing error:', ingestErr);
      res.status(500).json({ error: ingestErr.message || 'Error processing log file' });
    }
  });
});

// GET /api/projects/:projectId/logs
router.get('/', (req, res) => {
  const files = db
    .prepare('SELECT * FROM log_files WHERE project_id = ? ORDER BY ingested_at DESC')
    .all(req.params.projectId);
  res.json(files);
});

// DELETE /api/projects/:projectId/logs/:logId
router.delete('/:logId', (req, res) => {
  const logFile = db
    .prepare('SELECT * FROM log_files WHERE id = ? AND project_id = ?')
    .get(req.params.logId, req.params.projectId);
  if (!logFile) return res.status(404).json({ error: 'Log file not found' });

  db.prepare('DELETE FROM log_entries WHERE log_file_id = ?').run(req.params.logId);
  db.prepare('DELETE FROM log_files WHERE id = ?').run(req.params.logId);
  res.json({ message: 'Log file removed' });
});

module.exports = router;
