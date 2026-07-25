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
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like server-to-server or curl) or matching origins
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        'https://ai-crawler-and-bot-tracker.onrender.com',
        'http://localhost:5173',
        'http://localhost:3000',
      ].filter(Boolean);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.onrender.com') ||
        process.env.NODE_ENV !== 'production'
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/logs', logsRouter);
app.use('/api/projects/:projectId/analytics', analyticsRouter);
app.use('/api/projects/:projectId/sync', syncRouter);

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
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Crawler Watch backend running on http://localhost:${PORT}`);
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
