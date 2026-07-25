'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/database');
const analytics = require('../services/analyticsService');
const { generateInsights } = require('../services/insightEngine');
const { getBotSignatures, getBotGroups } = require('../services/botClassifier');
const { generatePdfReport } = require('../services/pdfReportService');

function parseDateParam(val, isEndOfDay = false) {
  if (!val) return undefined;
  if (/^\d+$/.test(String(val))) return Number(val);

  const match = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (isEndOfDay) {
      return Date.UTC(year, month, day, 23, 59, 59, 999);
    }
    return Date.UTC(year, month, day, 0, 0, 0, 0);
  }

  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse filter query params from request.
 * Converts date strings (YYYY-MM-DD or ISO) to Unix ms timestamps.
 */
function parseFilters(query) {
  const f = {};
  if (query.from) f.from = parseDateParam(query.from, false);
  if (query.to) f.to = parseDateParam(query.to, true);
  if (query.bot) f.bot = query.bot;
  if (query.bot_group || query.botGroup) f.bot_group = query.bot_group || query.botGroup;
  if (query.bot_category || query.botCategory) f.bot_category = query.bot_category || query.botCategory;
  if (query.url_pattern || query.urlPattern) f.url_pattern = query.url_pattern || query.urlPattern;
  if (query.status_code || query.status) f.status_code = query.status_code || query.status;
  if (query.referrer) f.referrer = query.referrer;
  return f;
}

// GET /api/projects/:projectId/analytics/stats OR /overview
router.get(['/stats', '/overview'], (req, res) => {
  const filters = parseFilters(req.query);
  const pid = +req.params.projectId;
  const overview = analytics.getOverviewStats(pid, filters);
  const byBotRaw = analytics.getBotShare(pid, filters);
  const byStatusRaw = analytics.getStatusCodes(pid, filters);
  const volumeRaw = analytics.getCrawlVolume(pid, filters);
  const humanVsBotRaw = analytics.getHumanVsBot(pid, filters);

  const byBot = (byBotRaw || []).map(b => ({
    bot_name: b.bot_name,
    bot_group: b.bot_group,
    bot_category: b.bot_category,
    hits: b.requests
  }));
  const byStatus = (byStatusRaw || []).map(s => ({ status_code: s.status_code, hits: s.count }));

  const volumeByDate = {};
  (volumeRaw || []).forEach(v => {
    if (!volumeByDate[v.period]) {
      volumeByDate[v.period] = { date: v.period, bot_hits: 0, human_hits: 0 };
    }
    volumeByDate[v.period][v.bot_name] = v.requests;
  });

  (humanVsBotRaw || []).forEach(h => {
    if (!volumeByDate[h.period]) {
      volumeByDate[h.period] = { date: h.period, bot_hits: 0, human_hits: 0 };
    }
    if (h.is_bot === 1) {
      volumeByDate[h.period].bot_hits = h.requests;
    } else {
      volumeByDate[h.period].human_hits = h.requests;
    }
  });

  res.json({
    totals: {
      total_requests: overview.total || 0,
      bot_requests: overview.bot_total || 0,
      human_requests: overview.human_total || 0
    },
    byBot,
    byStatus,
    volumeOverTime: Object.values(volumeByDate).sort((a, b) => (a.date > b.date ? 1 : -1))
  });
});

// GET /api/projects/:projectId/analytics/crawl-volume
router.get('/crawl-volume', (req, res) => {
  const filters = parseFilters(req.query);
  const granularity = req.query.granularity || 'day';
  const data = analytics.getCrawlVolume(+req.params.projectId, filters, granularity);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/bot-share
router.get('/bot-share', (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getBotShare(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/status-codes
router.get('/status-codes', (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getStatusCodes(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/top-pages
router.get('/top-pages', (req, res) => {
  const filters = parseFilters(req.query);
  const limit = parseInt(req.query.limit || '20', 10);
  const data = analytics.getTopPages(+req.params.projectId, filters, limit);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/heatmap
router.get('/heatmap', (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getHeatmap(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/human-vs-bot
router.get('/human-vs-bot', (req, res) => {
  const filters = parseFilters(req.query);
  const granularity = req.query.granularity || 'day';
  const data = analytics.getHumanVsBot(+req.params.projectId, filters, granularity);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/crawl-frequency OR /frequency
router.get(['/crawl-frequency', '/frequency'], (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getCrawlFrequency(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/crawl-gaps OR /gaps
router.get(['/crawl-gaps', '/gaps'], (req, res) => {
  const filters = parseFilters(req.query);
  const gapDays = parseInt(req.query.gap_days || req.query.days || '14', 10);
  const data = analytics.getCrawlGaps(+req.params.projectId, filters, gapDays);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/bot-summary
router.get('/bot-summary', (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getBotVisitSummary(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/ask OR /logs
router.get(['/ask', '/logs'], (req, res) => {
  const filters = parseFilters(req.query);
  const limit = parseInt(req.query.limit || '500', 10);
  const data = analytics.askQuery(+req.params.projectId, filters, limit);
  const formatted = (data || []).map(r => ({
    ...r,
    ts: new Date(r.ts).toISOString(),
    url: r.url_path
  }));
  res.json(formatted);
});

// GET /api/projects/:projectId/analytics/insights
router.get('/insights', (req, res) => {
  const filters = parseFilters(req.query);
  const data = generateInsights(+req.params.projectId, filters);
  res.json(data);
});

// GET /api/projects/:projectId/analytics/new-vs-returning
router.get('/new-vs-returning', (req, res) => {
  const filters = parseFilters(req.query);
  const data = analytics.getNewVsReturning(
    +req.params.projectId,
    filters.from || 0,
    filters.to || Date.now()
  );
  res.json(data);
});

// GET /api/projects/:projectId/analytics/export.csv OR /export/csv
router.get(['/export.csv', '/export/csv'], (req, res) => {
  const filters = parseFilters(req.query);
  const rows = analytics.askQuery(+req.params.projectId, filters, 100000);

  const headers = ['timestamp', 'ip', 'method', 'url_path', 'status_code', 'bytes', 'referrer', 'user_agent', 'is_bot', 'bot_name', 'bot_group'];
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => {
        const val = h === 'timestamp' ? new Date(r.ts).toISOString() : (r[h] ?? '');
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="crawler-export-${Date.now()}.csv"`);
  res.send(csvLines.join('\n'));
});

// GET /api/projects/:projectId/analytics/export.pdf OR /export/pdf
router.get(['/export.pdf', '/export/pdf'], (req, res) => {
  const filters = parseFilters(req.query);
  const pid = +req.params.projectId;
  generatePdfReport(pid, filters, res);
});

module.exports = router;

module.exports = router;
