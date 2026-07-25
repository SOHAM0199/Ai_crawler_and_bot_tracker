'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const crypto = require('crypto');

const db = require('../db/database');
const { classifyUserAgent } = require('./botClassifier');
const apacheParser = require('../parsers/apacheParser');
const iisParser = require('../parsers/iisParser');
const cloudflareParser = require('../parsers/cloudflareParser');

/**
 * Auto-detect log format from first non-comment, non-empty line.
 */
function detectFormat(sampleLine) {
  if (!sampleLine) return 'apache';
  if (sampleLine.startsWith('{')) return 'cloudflare';
  if (sampleLine.startsWith('#Software: Microsoft') || sampleLine.startsWith('#Fields:'))
    return 'iis';
  // Apache default
  return 'apache';
}

/**
 * Get the appropriate parser for a format string.
 */
function getParser(format) {
  switch (format) {
    case 'cloudflare': return cloudflareParser;
    case 'iis': return iisParser;
    default: return apacheParser;
  }
}

/**
 * Compute MD5 checksum of a file for deduplication.
 */
function computeChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Ingest a log file into the given project.
 * Returns { rowCount, dateFrom, dateTo, checksum, skipped }
 */
async function ingestLogFile(projectId, filePath, format = null) {
  const checksum = computeChecksum(filePath);

  // Deduplication check: skip if already ingested
  const existing = db
    .prepare('SELECT id FROM log_files WHERE project_id = ? AND checksum = ?')
    .get(projectId, checksum);
  if (existing) {
    return { rowCount: 0, dateFrom: null, dateTo: null, checksum, skipped: true };
  }

  // Create log_file record (placeholder, update after parse)
  const filename = path.basename(filePath);
  const logFileRow = db
    .prepare(
      'INSERT INTO log_files (project_id, filename, format, checksum) VALUES (?, ?, ?, ?)'
    )
    .run(projectId, filename, format || 'auto', checksum);
  const logFileId = logFileRow.lastInsertRowid;

  // Open file (handle .gz)
  const isGzip = filePath.endsWith('.gz');
  const fileStream = fs.createReadStream(filePath);
  const readStream = isGzip ? fileStream.pipe(zlib.createGunzip()) : fileStream;

  // Auto-detect format from first meaningful line
  let detectedFormat = format;
  let firstLineSeen = false;

  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  const insertStmt = db.prepare(`
    INSERT INTO log_entries
      (project_id, log_file_id, ts, ip, method, url_path, status_code, bytes, referrer, user_agent, is_bot, bot_name, bot_group, bot_category)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insertStmt.run(
        projectId, logFileId, r.ts, r.ip, r.method, r.url_path,
        r.status_code, r.bytes, r.referrer, r.user_agent,
        r.is_bot, r.bot_name, r.bot_group, r.bot_category
      );
    }
  });

  let rowCount = 0;
  let dateFrom = Infinity;
  let dateTo = -Infinity;
  let buffer = [];
  const BATCH_SIZE = 500;

  // Reset IIS parser state
  if (iisParser.reset) iisParser.reset();

  await new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      if (!firstLineSeen && line.trim() && !line.startsWith('#')) {
        if (!detectedFormat) detectedFormat = detectFormat(line.trim());
        firstLineSeen = true;
      }
      if (!detectedFormat) detectedFormat = 'apache';

      const parser = getParser(detectedFormat);
      const parsed = parser.parseLine(line);
      if (!parsed) return;

      const { isBot, botName, botGroup, botCategory } = classifyUserAgent(parsed.user_agent);

      buffer.push({
        ...parsed,
        is_bot: isBot ? 1 : 0,
        bot_name: botName,
        bot_group: botGroup,
        bot_category: botCategory,
      });

      if (parsed.ts < dateFrom) dateFrom = parsed.ts;
      if (parsed.ts > dateTo) dateTo = parsed.ts;
      rowCount++;

      if (buffer.length >= BATCH_SIZE) {
        insertMany(buffer);
        buffer = [];
      }
    });

    rl.on('close', () => {
      if (buffer.length) insertMany(buffer);
      resolve();
    });

    rl.on('error', reject);
    readStream.on('error', reject);
  });

  // Update log_file record with final stats
  db.prepare(
    'UPDATE log_files SET row_count = ?, date_from = ?, date_to = ?, format = ? WHERE id = ?'
  ).run(rowCount, dateFrom === Infinity ? null : dateFrom, dateTo === -Infinity ? null : dateTo, detectedFormat || 'apache', logFileId);

  return { rowCount, dateFrom, dateTo, checksum, skipped: false };
}

module.exports = { ingestLogFile };
