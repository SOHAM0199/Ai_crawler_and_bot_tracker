'use strict';

/**
 * Apache / Nginx Combined Log Format Parser
 *
 * Example line:
 * 66.249.64.14 - - [01/Jul/2024:00:01:23 +0000] "GET /pricing HTTP/1.1" 200 4523 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"
 */

const APACHE_REGEX =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+\S+"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/;

const MONTH_MAP = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseApacheDate(dateStr) {
  // "01/Jul/2024:00:01:23 +0000"
  const m = dateStr.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})/);
  if (!m) return null;
  const [, day, mon, year, hour, min, sec, tz] = m;
  const tzH = parseInt(tz.slice(0, 3), 10);
  const tzM = parseInt(tz.slice(0, 1) + tz.slice(3), 10);
  const utcMs =
    Date.UTC(+year, MONTH_MAP[mon], +day, +hour, +min, +sec) -
    (tzH * 60 + tzM) * 60000;
  return utcMs;
}

/**
 * Parse a single Apache/Nginx combined-format log line.
 * Returns null if the line doesn't match.
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const m = APACHE_REGEX.exec(trimmed);
  if (!m) return null;

  const [, ip, dateStr, method, urlRaw, statusStr, bytesStr, referrer, userAgent] = m;

  const ts = parseApacheDate(dateStr);
  if (!ts) return null;

  // Strip query string for url_path storage (keep it for referrer)
  const urlPath = urlRaw.split('?')[0];

  return {
    ts,
    ip,
    method,
    url_path: urlPath,
    status_code: parseInt(statusStr, 10),
    bytes: bytesStr === '-' ? 0 : parseInt(bytesStr, 10),
    referrer: referrer === '-' ? null : referrer,
    user_agent: userAgent,
  };
}

module.exports = { parseLine };
