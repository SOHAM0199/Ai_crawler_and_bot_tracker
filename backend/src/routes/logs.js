'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { ingestLogFile } = require('../services/logIngestion');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, `project_${req.params.projectId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}_${file.originalname}`);
  },
});

const upload = multer({
  storage,
  // No fileSize limit - files of any size (1GB, 10GB, unlimited) are accepted
  fileFilter: (req, file, cb) => {
    const allowed = ['.log', '.gz', '.txt', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || ext === '') cb(null, true);
    else cb(null, true); // Allow all file extensions
  },
});

// POST /api/projects/:projectId/logs/upload
router.post('/upload', upload.single('logfile'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const format = req.body.format || null; // allow override; null = auto-detect

    const result = await ingestLogFile(+projectId, req.file.path, format);

    res.json({
      success: true,
      filename: req.file.originalname,
      ...result,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
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
