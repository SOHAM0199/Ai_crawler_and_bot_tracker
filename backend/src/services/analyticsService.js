'use strict';

const db = require('../db/database');
const { getBotCategory } = require('./botClassifier');

function parseDateParam(val, isEndOfDay = false) {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
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
 * Build a WHERE clause and params array from a filter object.
 * Supported filters: from, to, bot, bot_group, bot_category, url_pattern, status_code, referrer, is_bot
 */
function buildWhere(projectId, filters = {}) {
  const conditions = ['project_id = ?'];
  const params = [projectId];

  const fromVal = parseDateParam(filters.from, false);
  if (fromVal !== undefined) {
    conditions.push('ts >= ?');
    params.push(fromVal);
  }

  const toVal = parseDateParam(filters.to, true);
  if (toVal !== undefined) {
    conditions.push('ts <= ?');
    params.push(toVal);
  }
  if (filters.bot) {
    conditions.push('bot_name = ?');
    params.push(filters.bot);
  }
  if (filters.bot_group) {
    conditions.push('bot_group = ?');
    params.push(filters.bot_group);
  }
  if (filters.bot_category) {
    conditions.push('bot_category = ?');
    params.push(filters.bot_category);
  }
  if (filters.url_pattern) {
    // Support wildcard (*) or plain prefix matching
    const pat = filters.url_pattern.replace(/\*/g, '%');
    conditions.push('url_path LIKE ?');
    params.push(pat);
  }
  if (filters.status_code) {
    conditions.push('status_code = ?');
    params.push(Number(filters.status_code));
  }
  if (filters.referrer) {
    conditions.push('referrer LIKE ?');
    params.push(`%${filters.referrer}%`);
  }
  if (filters.is_bot !== undefined) {
    conditions.push('is_bot = ?');
    params.push(filters.is_bot ? 1 : 0);
  }

  return { where: conditions.join(' AND '), params };
}

// ─── Overview KPI ─────────────────────────────────────────────────────────────
function getOverviewStats(projectId, filters) {
  const { where, params } = buildWhere(projectId, filters);
  const row = db
    .prepare(`SELECT COUNT(*) as total,
              SUM(is_bot) as bot_total,
              COUNT(DISTINCT ip) as unique_ips,
              COUNT(DISTINCT url_path) as unique_urls
       FROM log_entries WHERE ${where}`)
    .get(...params);

  const humanTotal = (row.total || 0) - (row.bot_total || 0);
  return { ...row, human_total: humanTotal };
}

// ─── Crawl Volume Over Time ────────────────────────────────────────────────────
function getCrawlVolume(projectId, filters, granularity = 'day') {
  const { where, params } = buildWhere(projectId, { ...filters, is_bot: true });

  // SQLite date bucketing
  const dateFn =
    granularity === 'hour'
      ? `strftime('%Y-%m-%d %H:00', datetime(ts/1000, 'unixepoch'))`
      : granularity === 'week'
      ? `strftime('%Y-W%W', datetime(ts/1000, 'unixepoch'))`
      : `strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch'))`;

  return db
    .prepare(
      `SELECT ${dateFn} as period, bot_name, COUNT(*) as requests
       FROM log_entries WHERE ${where}
       GROUP BY period, bot_name
       ORDER BY period ASC`
    )
    .all(...params);
}

// ─── Bot Share ─────────────────────────────────────────────────────────────────
function getBotShare(projectId, filters) {
  const { where, params } = buildWhere(projectId, { ...filters, is_bot: true });
  const rows = db
    .prepare(
      `SELECT bot_name, bot_group, bot_category, COUNT(*) as requests
       FROM log_entries WHERE ${where}
       GROUP BY bot_name, bot_group, bot_category
       ORDER BY requests DESC`
    )
    .all(...params);

  return rows.map((r) => ({
    ...r,
    bot_category: r.bot_category || getBotCategory(r.bot_name),
  }));
}

// ─── Status Codes ──────────────────────────────────────────────────────────────
function getStatusCodes(projectId, filters) {
  const { where, params } = buildWhere(projectId, filters);
  return db
    .prepare(
      `SELECT status_code, is_bot, bot_name, COUNT(*) as count
       FROM log_entries WHERE ${where}
       GROUP BY status_code, is_bot, bot_name
       ORDER BY count DESC`
    )
    .all(...params);
}

// ─── Top Crawled Pages ─────────────────────────────────────────────────────────
function getTopPages(projectId, filters, limit = 20) {
  const { where, params } = buildWhere(projectId, filters);
  return db
    .prepare(
      `SELECT url_path, COUNT(*) as requests, SUM(is_bot) as bot_requests
       FROM log_entries WHERE ${where}
       GROUP BY url_path
       ORDER BY requests DESC
       LIMIT ?`
    )
    .all(...params, limit);
}

// ─── Heatmap (hour × day-of-week) ─────────────────────────────────────────────
function getHeatmap(projectId, filters) {
  const { where, params } = buildWhere(projectId, filters);
  return db
    .prepare(
      `SELECT
         CAST(strftime('%H', datetime(ts/1000, 'unixepoch')) AS INTEGER) as hour,
         CAST(strftime('%w', datetime(ts/1000, 'unixepoch')) AS INTEGER) as dow,
         COUNT(*) as requests
       FROM log_entries WHERE ${where}
       GROUP BY hour, dow
       ORDER BY dow ASC, hour ASC`
    )
    .all(...params);
}

// ─── Human vs Bot over time ────────────────────────────────────────────────────
function getHumanVsBot(projectId, filters, granularity = 'day') {
  const { where, params } = buildWhere(projectId, filters);
  const dateFn =
    granularity === 'hour'
      ? `strftime('%Y-%m-%d %H:00', datetime(ts/1000, 'unixepoch'))`
      : `strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch'))`;

  return db
    .prepare(
      `SELECT ${dateFn} as period, is_bot, COUNT(*) as requests
       FROM log_entries WHERE ${where}
       GROUP BY period, is_bot
       ORDER BY period ASC`
    )
    .all(...params);
}

// ─── Crawl Frequency ──────────────────────────────────────────────────────────
function getCrawlFrequency(projectId, filters) {
  const { where, params } = buildWhere(projectId, { ...filters, is_bot: true });

  // Get counts per bot per URL, split into two halves to compute trend
  const rows = db
    .prepare(
      `SELECT bot_name, bot_group, bot_category, url_path,
         COUNT(*) as total_visits,
         MIN(ts) as first_visit,
         MAX(ts) as last_visit
       FROM log_entries WHERE ${where}
       GROUP BY bot_name, url_path
       ORDER BY total_visits DESC
       LIMIT 200`
    )
    .all(...params);

  // Compute per-entry trend by comparing first-half vs second-half counts
  return rows.map((r) => {
    const midpoint = (r.first_visit + r.last_visit) / 2;
    const firstHalf = db
      .prepare(
        `SELECT COUNT(*) as c FROM log_entries
         WHERE project_id=? AND bot_name=? AND url_path=? AND ts < ?`
      )
      .get(projectId, r.bot_name, r.url_path, midpoint).c;
    const secondHalf = db
      .prepare(
        `SELECT COUNT(*) as c FROM log_entries
         WHERE project_id=? AND bot_name=? AND url_path=? AND ts >= ?`
      )
      .get(projectId, r.bot_name, r.url_path, midpoint).c;

    let trend = 'stable';
    if (secondHalf > firstHalf * 1.2) trend = 'rising';
    else if (secondHalf < firstHalf * 0.8) trend = 'falling';
    else if (secondHalf === 0 && firstHalf > 0) trend = 'stopped';

    return {
      ...r,
      bot_category: r.bot_category || getBotCategory(r.bot_name),
      trend
    };
  });
}

// ─── Crawl Gaps ───────────────────────────────────────────────────────────────
function getCrawlGaps(projectId, filters, gapDays = 14) {
  const { where, params } = buildWhere(projectId, { ...filters, is_bot: true });
  const cutoffMs = Date.now() - gapDays * 24 * 60 * 60 * 1000;

  return db
    .prepare(
      `SELECT url_path, bot_name, bot_group,
         COUNT(*) as total_visits,
         MAX(ts) as last_seen
       FROM log_entries WHERE ${where}
       GROUP BY url_path, bot_name
       HAVING last_seen < ?
       ORDER BY last_seen ASC
       LIMIT 100`
    )
    .all(...params, cutoffMs);
}

// ─── Ask a Question (Direct Query) ────────────────────────────────────────────
function askQuery(projectId, filters, limit = 200) {
  const { where, params } = buildWhere(projectId, filters);
  return db
    .prepare(
      `SELECT ts, ip, method, url_path, status_code, bytes, referrer, user_agent,
              is_bot, bot_name, bot_group
       FROM log_entries WHERE ${where}
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(...params, limit);
}

// ─── New vs Returning Paths ────────────────────────────────────────────────────
function getNewVsReturning(projectId, fromMs, toMs) {
  // URLs first seen within the period vs seen before the period too
  const allInPeriod = db
    .prepare(
      `SELECT DISTINCT url_path, MIN(ts) as first_ever
       FROM log_entries WHERE project_id = ?
       GROUP BY url_path`
    )
    .all(projectId);

  const results = { new_paths: [], returning_paths: [] };
  for (const row of allInPeriod) {
    if (row.first_ever >= fromMs) {
      results.new_paths.push(row.url_path);
    } else {
      results.returning_paths.push(row.url_path);
    }
  }
  return results;
}

// ─── Bot visit summary by date range ──────────────────────────────────────────
function getBotVisitSummary(projectId, filters) {
  const { where, params } = buildWhere(projectId, { ...filters, is_bot: true });
  return db
    .prepare(
      `SELECT bot_name, bot_group,
         COUNT(*) as visits,
         COUNT(DISTINCT url_path) as unique_urls,
         COUNT(DISTINCT ip) as unique_ips,
         MIN(ts) as first_visit,
         MAX(ts) as last_visit
       FROM log_entries WHERE ${where}
       GROUP BY bot_name
       ORDER BY visits DESC`
    )
    .all(...params);
}

module.exports = {
  buildWhere,
  getOverviewStats,
  getCrawlVolume,
  getBotShare,
  getStatusCodes,
  getTopPages,
  getHeatmap,
  getHumanVsBot,
  getCrawlFrequency,
  getCrawlGaps,
  askQuery,
  getNewVsReturning,
  getBotVisitSummary,
};
