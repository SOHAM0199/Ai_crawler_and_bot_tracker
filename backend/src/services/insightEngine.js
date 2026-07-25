'use strict';

const db = require('../db/database');
const { getBotCategory } = require('./botClassifier');
const { buildWhere } = require('./analyticsService');

/**
 * Auto-generate plain-English actionable insights for a project.
 * Guaranteed to return structured, non-empty insights whenever project log data exists.
 * Every item includes { title, description, message, text, detail, severity, type, data }.
 */
function generateInsights(projectId, filters = {}) {
  const rawInsights = [];
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  const lastWeekStart = now - oneWeek;
  const prevWeekStart = now - twoWeeks;

  const { where, params } = buildWhere(projectId, filters);
  const botWhere = buildWhere(projectId, { ...filters, is_bot: true });

  // Check total log entries for this project
  const totalStats = db
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(is_bot) as bot_total,
              COUNT(DISTINCT ip) as unique_ips,
              COUNT(DISTINCT url_path) as unique_urls
       FROM log_entries WHERE ${where}`
    )
    .get(...params);

  const totalReq = totalStats?.total || 0;
  const botReq = totalStats?.bot_total || 0;

  if (totalReq === 0) {
    return [
      {
        title: 'No Log Traffic Available',
        description: 'No log entries ingested for this project yet. Upload a log file to generate AI insights.',
        message: 'No log entries ingested for this project yet. Upload a log file to generate AI insights.',
        text: 'No Log Traffic Available',
        detail: 'No log entries ingested for this project yet. Upload a log file to generate AI insights.',
        severity: 'info',
        type: 'no_data',
        data: {},
      },
    ];
  }

  // ── Baseline Summary Insights ────────────────────────────────────────────────

  // 1. Overall Traffic Volume & Bot Ratio
  const botPct = totalReq > 0 ? Math.round((botReq / totalReq) * 100) : 0;
  rawInsights.push({
    title: 'Bot Traffic Volume & Share',
    description: `Bots generated ${botReq.toLocaleString()} requests (${botPct}% of total ${totalReq.toLocaleString()} requests) across ${totalStats.unique_ips || 0} unique IP addresses.`,
    message: `Bots generated ${botReq.toLocaleString()} requests (${botPct}% of total ${totalReq.toLocaleString()} requests) across ${totalStats.unique_ips || 0} unique IP addresses.`,
    text: 'Bot Traffic Volume & Share',
    detail: `Bots generated ${botReq.toLocaleString()} requests (${botPct}% of total ${totalReq.toLocaleString()} requests) across ${totalStats.unique_ips || 0} unique IP addresses.`,
    severity: botPct > 80 ? 'medium' : 'info',
    type: 'traffic_ratio',
    data: { totalReq, botReq, botPct },
  });

  // 2. Category Distribution
  if (botReq > 0) {
    const catRows = db
      .prepare(
        `SELECT bot_name, bot_category, COUNT(*) as hits
         FROM log_entries
         WHERE project_id=? AND is_bot=1
         GROUP BY bot_name, bot_category`
      )
      .all(projectId);

    const catTotals = {};
    catRows.forEach((r) => {
      const cat = r.bot_category || getBotCategory(r.bot_name);
      catTotals[cat] = (catTotals[cat] || 0) + r.hits;
    });

    const catSummary = Object.entries(catTotals)
      .map(([cat, hits]) => `${cat}: ${Math.round((hits / botReq) * 100)}% (${hits.toLocaleString()} hits)`)
      .join(' • ');

    rawInsights.push({
      title: 'Bot Category Breakdown',
      description: `Bot activity spans ${Object.keys(catTotals).length} distinct categories — ${catSummary}.`,
      message: `Bot activity spans ${Object.keys(catTotals).length} distinct categories — ${catSummary}.`,
      text: 'Bot Category Breakdown',
      detail: `Bot activity spans ${Object.keys(catTotals).length} distinct categories — ${catSummary}.`,
      severity: 'info',
      type: 'category_breakdown',
      data: catTotals,
    });

    // 3. Top / Dominant Crawler
    const topBot = db
      .prepare(
        `SELECT bot_name, bot_group, bot_category, COUNT(*) as hits
         FROM log_entries
         WHERE project_id=? AND is_bot=1
         GROUP BY bot_name
         ORDER BY hits DESC LIMIT 1`
      )
      .get(projectId);

    if (topBot) {
      const topCat = topBot.bot_category || getBotCategory(topBot.bot_name);
      const topPct = Math.round((topBot.hits / botReq) * 100);
      rawInsights.push({
        title: `Primary Crawler: ${topBot.bot_name}`,
        description: `${topBot.bot_name} (${topCat}) is your top crawler, accounting for ${topPct}% of all bot requests (${topBot.hits.toLocaleString()} hits).`,
        message: `${topBot.bot_name} (${topCat}) is your top crawler, accounting for ${topPct}% of all bot requests (${topBot.hits.toLocaleString()} hits).`,
        text: `Primary Crawler: ${topBot.bot_name}`,
        detail: `${topBot.bot_name} (${topCat}) is your top crawler, accounting for ${topPct}% of all bot requests (${topBot.hits.toLocaleString()} hits).`,
        severity: 'info',
        type: 'top_crawler',
        data: topBot,
      });
    }

    // 4. HTTP Status Code Health for Bots
    const statusHealth = db
      .prepare(
        `SELECT 
           SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) as ok_count,
           SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) as client_errors,
           SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) as server_errors
         FROM log_entries WHERE project_id=? AND is_bot=1`
      )
      .get(projectId);

    const okCount = statusHealth?.ok_count || 0;
    const clientErr = statusHealth?.client_errors || 0;
    const serverErr = statusHealth?.server_errors || 0;
    const okPct = botReq > 0 ? Math.round((okCount / botReq) * 100) : 100;

    let healthSeverity = 'info';
    if (serverErr > 0 || clientErr > 20) healthSeverity = 'medium';
    if (serverErr > 10 || clientErr > 100) healthSeverity = 'high';

    rawInsights.push({
      title: 'Bot Response Health',
      description: `${okPct}% of bot requests completed successfully (HTTP 2xx/3xx). Identified ${clientErr} 4xx client errors and ${serverErr} 5xx server errors.`,
      message: `${okPct}% of bot requests completed successfully (HTTP 2xx/3xx). Identified ${clientErr} 4xx client errors and ${serverErr} 5xx server errors.`,
      text: 'Bot Response Health',
      detail: `${okPct}% of bot requests completed successfully (HTTP 2xx/3xx). Identified ${clientErr} 4xx client errors and ${serverErr} 5xx server errors.`,
      severity: healthSeverity,
      type: 'response_health',
      data: { okCount, clientErr, serverErr, okPct },
    });
  }

  // ── Anomaly & Specific Insights ─────────────────────────────────────────────

  // 5. Bot volume change week-over-week
  const botNames = db
    .prepare(`SELECT DISTINCT bot_name FROM log_entries WHERE project_id=? AND is_bot=1`)
    .all(projectId).map((r) => r.bot_name).filter(Boolean);

  for (const bot of botNames) {
    const thisWeek = db
      .prepare(
        `SELECT COUNT(*) as c FROM log_entries
         WHERE project_id=? AND bot_name=? AND ts >= ?`
      )
      .get(projectId, bot, lastWeekStart).c;

    const prevWeek = db
      .prepare(
        `SELECT COUNT(*) as c FROM log_entries
         WHERE project_id=? AND bot_name=? AND ts >= ? AND ts < ?`
      )
      .get(projectId, bot, prevWeekStart, lastWeekStart).c;

    if (prevWeek === 0 && thisWeek === 0) continue;

    if (prevWeek > 0) {
      const pct = Math.round(((thisWeek - prevWeek) / prevWeek) * 100);
      if (pct <= -30) {
        const sev = pct <= -60 ? 'high' : 'medium';
        const msg = `${bot} visited ${Math.abs(pct)}% fewer pages this week than last week (${thisWeek} vs ${prevWeek}).`;
        rawInsights.push({
          title: `Crawl Drop: ${bot}`,
          description: msg,
          message: msg,
          text: `Crawl Drop: ${bot}`,
          detail: msg,
          severity: sev,
          type: 'volume_drop',
          bot,
          data: { thisWeek, prevWeek, pct },
        });
      } else if (pct >= 50) {
        const msg = `${bot} increased crawl volume by ${pct}% this week (${thisWeek} vs ${prevWeek} last week).`;
        rawInsights.push({
          title: `Crawl Spike: ${bot}`,
          description: msg,
          message: msg,
          text: `Crawl Spike: ${bot}`,
          detail: msg,
          severity: 'info',
          type: 'volume_spike',
          bot,
          data: { thisWeek, prevWeek, pct },
        });
      }
    }

    if (thisWeek === 0 && prevWeek > 0) {
      const msg = `${bot} has stopped crawling in the past 7 days (previously ${prevWeek} visits last week).`;
      rawInsights.push({
        title: `Crawl Activity Stopped: ${bot}`,
        description: msg,
        message: msg,
        text: `Crawl Activity Stopped: ${bot}`,
        detail: msg,
        severity: 'medium',
        type: 'crawl_stopped',
        bot,
        data: { lastWeekVisits: prevWeek },
      });
    }
  }

  // 6. 404 storms per bot
  const error404s = db
    .prepare(
      `SELECT bot_name, COUNT(*) as count, COUNT(DISTINCT url_path) as unique_urls
       FROM log_entries
       WHERE project_id=? AND is_bot=1 AND status_code=404
       GROUP BY bot_name
       HAVING count >= 5
       ORDER BY count DESC`
    )
    .all(projectId);

  for (const r of error404s) {
    const msg = `${r.bot_name} encountered ${r.count} HTTP 404 errors across ${r.unique_urls} unique URLs.`;
    rawInsights.push({
      title: `404 Error Storm: ${r.bot_name}`,
      description: msg,
      message: msg,
      text: `404 Error Storm: ${r.bot_name}`,
      detail: msg,
      severity: r.count >= 20 ? 'high' : 'medium',
      type: 'error_404',
      bot: r.bot_name,
      data: r,
    });
  }

  // 7. 5xx server errors per bot
  const error5xx = db
    .prepare(
      `SELECT bot_name, status_code, COUNT(*) as count
       FROM log_entries
       WHERE project_id=? AND is_bot=1 AND status_code >= 500
       GROUP BY bot_name, status_code
       HAVING count >= 1
       ORDER BY count DESC`
    )
    .all(projectId);

  for (const r of error5xx) {
    const msg = `${r.bot_name} received ${r.count} HTTP ${r.status_code} server errors.`;
    rawInsights.push({
      title: `Server Error Alert (${r.status_code}): ${r.bot_name}`,
      description: msg,
      message: msg,
      text: `Server Error Alert (${r.status_code}): ${r.bot_name}`,
      detail: msg,
      severity: 'high',
      type: 'server_error',
      bot: r.bot_name,
      data: r,
    });
  }

  // 8. ChatGPT dual-mode split (GPTBot vs ChatGPT-User)
  const gptBotHits = db
    .prepare(`SELECT COUNT(*) as c FROM log_entries WHERE project_id=? AND bot_name='GPTBot'`)
    .get(projectId).c;
  const chatGptUserHits = db
    .prepare(`SELECT COUNT(*) as c FROM log_entries WHERE project_id=? AND bot_name='ChatGPT-User'`)
    .get(projectId).c;

  if (gptBotHits > 0 || chatGptUserHits > 0) {
    const msg = `OpenAI traffic breakdown: ${gptBotHits} GPTBot requests (autonomous training crawler) + ${chatGptUserHits} ChatGPT-User requests (real-time user browser queries).`;
    rawInsights.push({
      title: 'OpenAI Crawler vs User Browsing',
      description: msg,
      message: msg,
      text: 'OpenAI Crawler vs User Browsing',
      detail: msg,
      severity: 'info',
      type: 'openai_split',
      bot: 'OpenAI',
      data: { gptBotHits, chatGptUserHits },
    });
  }

  // 9. High frequency crawlers
  const highFreq = db
    .prepare(
      `SELECT bot_name, COUNT(*) as visits, COUNT(DISTINCT url_path) as pages
       FROM log_entries
       WHERE project_id=? AND is_bot=1
       GROUP BY bot_name
       HAVING visits > 1000
       ORDER BY visits DESC`
    )
    .all(projectId);

  for (const r of highFreq) {
    const msg = `${r.bot_name} generated ${r.visits.toLocaleString()} requests across ${r.pages.toLocaleString()} unique pages — high crawl density.`;
    rawInsights.push({
      title: `High Activity: ${r.bot_name}`,
      description: msg,
      message: msg,
      text: `High Activity: ${r.bot_name}`,
      detail: msg,
      severity: 'info',
      type: 'high_frequency',
      bot: r.bot_name,
      data: r,
    });
  }

  return rawInsights;
}

module.exports = { generateInsights };
