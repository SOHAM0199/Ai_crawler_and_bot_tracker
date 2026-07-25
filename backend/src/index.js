'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

const projectsRouter = require('./routes/projects');
const logsRouter = require('./routes/logs');
const analyticsRouter = require('./routes/analytics');
const syncRouter = require('./routes/sync');
const { startDailySyncCron } = require('./cron/dailySync');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
// Universal bulletproof CORS middleware (echoes origin, handles preflight OPTIONS 200 OK)
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition');

  if (req.method === 'OPTIONS') {
    return res.status(200).send('OK');
  }
  next();
});

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/logs', logsRouter);
app.use('/api/projects/:projectId/analytics', analyticsRouter);
app.use('/api/projects/:projectId/sync', syncRouter);

// Root route (API Info & Status)
app.get('/', (req, res) => {
  res.json({
    service: 'Crawler & AI Bot Watch API',
    status: 'online',
    health: '/api/health',
    timestamp: new Date().toISOString()
  });
});

// Bot signatures list (for frontend dropdowns)
app.get('/api/bot-signatures', (req, res) => {
  res.json(require('./config/botSignatures.json'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// ─── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Crawler Watch backend running on http://${HOST}:${PORT}`);
  console.log(`   DB: ${process.env.DB_PATH || './data/crawler-watch.db'}`);

  // Start scheduled cron (only if enabled)
  if (process.env.SYNC_ENABLED === 'true') {
    startDailySyncCron();
  }
});

// Disable server request & header timeouts for unlimited large uploads
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

module.exports = app;
