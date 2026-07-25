'use strict';

const PDFDocument = require('pdfkit');
const db = require('../db/database');
const analytics = require('./analyticsService');
const { generateInsights } = require('./insightEngine');

const BRAND_DARK = '#0f172a';
const BRAND_TEAL = '#0f766e';
const TEXT_DARK = '#1e293b';

function sectionHeader(doc, title, subtitle) {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(1.2);
  const startY = doc.y;

  // Vertical green accent bar
  doc.rect(45, startY, 4, 18).fill(BRAND_TEAL);

  // Title
  doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(14)
    .text(title, 55, startY);

  // Subtitle
  if (subtitle) {
    doc.fillColor('#64748b').font('Helvetica').fontSize(9)
      .text(subtitle, 55, startY + 16);
    doc.y = startY + 32;
  } else {
    doc.y = startY + 22;
  }
}

function table(doc, { columns, rows }) {
  const startX = 45;
  let startY = doc.y + 4;
  const rowHeight = 20;

  // Header background
  doc.rect(startX, startY, 510, rowHeight).fill(BRAND_TEAL);

  // Header labels
  let currentX = startX + 6;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  columns.forEach(col => {
    doc.text(col.label, currentX, startY + 5, {
      width: col.width - 12,
      align: col.align || 'left'
    });
    currentX += col.width;
  });

  startY += rowHeight;

  // Rows
  doc.font('Helvetica').fontSize(8.5);
  rows.forEach((row, i) => {
    if (startY > 720) {
      doc.addPage();
      startY = 45;
    }

    // Zebra row background
    if (i % 2 === 1) {
      doc.rect(startX, startY, 510, rowHeight).fill('#f8fafc');
    }

    currentX = startX + 6;
    doc.fillColor(TEXT_DARK);
    row.forEach((cell, colIdx) => {
      const col = columns[colIdx];
      doc.text(String(cell ?? ''), currentX, startY + 5, {
        width: col.width - 12,
        align: col.align || 'left',
        lineBreak: false
      });
      currentX += col.width;
    });

    // Bottom row line
    doc.moveTo(startX, startY + rowHeight)
       .lineTo(startX + 510, startY + rowHeight)
       .strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    startY += rowHeight;
  });

  doc.y = startY + 8;
}

function emptyNote(doc, text) {
  doc.fillColor('#94a3b8').font('Helvetica-Oblique').fontSize(9)
    .text(text, 55, doc.y + 4);
  doc.y += 16;
}

function generatePdfReport(projectId, filters, res) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const projName = project ? project.name : `Project #${projectId}`;
  const projDomain = project?.domain || '';

  const overview = analytics.getOverviewStats(projectId, filters);
  const byBot = analytics.getBotShare(projectId, filters);
  const topPages = analytics.getTopPages(projectId, filters, 15);
  const gaps = analytics.getCrawlGaps(projectId, filters, 10);
  const insights = generateInsights(projectId, filters);

  const { where, params } = analytics.buildWhere(projectId, { ...filters, is_bot: true });

  // Specific 4xx/5xx status errors per bot
  const statusErrors = db.prepare(`
    SELECT bot_name, url_path as url, status_code, COUNT(*) as hits
    FROM log_entries
    WHERE ${where} AND status_code >= 400
    GROUP BY bot_name, url_path, status_code
    ORDER BY hits DESC LIMIT 20
  `).all(...params);

  const doc = new PDFDocument({ margin: 45, bufferPages: true });

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${projName.replace(/[^a-z0-9]/gi, '_')}-report.pdf"`);
  }
  doc.pipe(res);

  // --- Top Header Band ---
  doc.rect(0, 0, doc.page.width, 70).fill(BRAND_DARK);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Crawler & Bot Traffic Report', 45, 18);
  doc.font('Helvetica').fontSize(10).fillColor('#cbd5e1')
    .text(`${projName}${projDomain ? '  —  ' + projDomain : ''}`, 45, 44);
  doc.fontSize(8).fillColor('#94a3b8')
    .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, 45, 57);

  doc.y = 85;

  // --- Summary Stat Cards ---
  const totalReq = overview.total || 0;
  const botReq = overview.bot_total || 0;
  const humanReq = overview.human_total || 0;

  const cardWidth = 120;
  const cardY = doc.y;
  [
    { val: totalReq.toLocaleString(), lbl: 'TOTAL REQUESTS' },
    { val: botReq.toLocaleString(), lbl: 'BOT REQUESTS' },
    { val: humanReq.toLocaleString(), lbl: 'HUMAN REQUESTS' },
    { val: byBot.length.toString(), lbl: 'DISTINCT BOTS' }
  ].forEach((card, idx) => {
    const cardX = 45 + idx * 130;
    doc.rect(cardX, cardY, cardWidth, 42).fill('#f1f5f9');
    doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(14).text(card.val, cardX + 8, cardY + 8);
    doc.fillColor('#64748b').font('Helvetica').fontSize(7.5).text(card.lbl, cardX + 8, cardY + 26);
  });

  doc.y = cardY + 54;

  // --- Section 1: Bot Breakdown ---
  sectionHeader(doc, 'Bot Breakdown', 'Hits per identified bot, ranked by volume');
  if (!byBot.length) {
    emptyNote(doc, 'No bot traffic detected in this range.');
  } else {
    table(doc, {
      columns: [
        { label: 'Bot', width: 160 },
        { label: 'Group', width: 140 },
        { label: 'Category', width: 110 },
        { label: 'Hits', width: 100, align: 'right' }
      ],
      rows: byBot.slice(0, 15).map(b => [
        b.bot_name,
        b.bot_group || '—',
        b.bot_category || 'Generic Crawler',
        b.requests.toLocaleString()
      ])
    });
  }

  // --- Section 2: Status Errors Per Bot (Matches User Screenshot) ---
  sectionHeader(doc, 'Status Errors Per Bot', 'Specific URLs returning 4xx/5xx to a bot, not just aggregate counts');
  if (!statusErrors.length) {
    emptyNote(doc, 'No 4xx/5xx status errors from bots in this range.');
  } else {
    table(doc, {
      columns: [
        { label: 'Bot', width: 130 },
        { label: 'URL', width: 250 },
        { label: 'Status', width: 60, align: 'right' },
        { label: 'Hits', width: 70, align: 'right' }
      ],
      rows: statusErrors.map(s => [s.bot_name, s.url, s.status_code, s.hits.toLocaleString()])
    });
  }

  // --- Section 3: Crawl Gaps (Matches User Screenshot) ---
  sectionHeader(doc, 'Crawl Gaps', 'Pages crawled regularly in the past that have gone quiet (10+ days)');
  if (!gaps.length) {
    emptyNote(doc, 'No crawl gaps flagged at the 10-day threshold.');
  } else {
    table(doc, {
      columns: [
        { label: 'Bot', width: 120 },
        { label: 'URL', width: 230 },
        { label: 'Last seen', width: 80 },
        { label: 'Days', width: 40, align: 'right' },
        { label: 'Historical', width: 40, align: 'right' }
      ],
      rows: gaps.slice(0, 15).map(g => [g.bot_name, g.url, g.last_seen ? new Date(g.last_seen).toISOString().slice(0, 10) : '—', g.days_since_last_crawl || 10, g.historical_hits || '—'])
    });
  }

  // --- Section 4: Auto-Generated Insights ---
  sectionHeader(doc, 'Auto-Generated Insights', 'Top flags and diagnostic summaries ranked by severity');
  if (!insights.length) {
    emptyNote(doc, 'No flags — traffic looks steady.');
  } else {
    insights.forEach(item => {
      if (doc.y > 700) doc.addPage();
      const isHigh = item.severity === 'high' || item.severity === 'critical';
      const isMedium = item.severity === 'medium' || item.severity === 'warning';
      const severityColor = isHigh ? '#dc2626' : isMedium ? '#d97706' : '#0f766e';
      
      const titleText = item.title || item.bot || item.type || 'Insight Flag';
      const descText = item.description || item.message || item.detail || item.text || '';

      doc.rect(45, doc.y, 4, descText ? 24 : 14).fill(severityColor);
      doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(9.5).text(titleText, 55, doc.y);
      if (descText) {
        doc.fillColor('#475569').font('Helvetica').fontSize(8.5).text(descText, 55, doc.y + 12, { width: 490 });
        doc.y += 28;
      } else {
        doc.y += 18;
      }
    });
  }

  // Page Numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Page ${i + 1} of ${range.count}`, 45, doc.page.height - 30, {
        width: doc.page.width - 90,
        align: 'center'
      });
  }

  doc.end();
}

module.exports = { generatePdfReport };
