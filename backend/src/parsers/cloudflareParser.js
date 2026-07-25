'use strict';

/**
 * Cloudflare Log Format Parser
 *
 * Supports two flavours:
 *   1. JSON Lines (one JSON object per line) — Cloudflare Logpush
 *   2. Cloudflare CSV / pipe-delimited (less common)
 *
 * JSON field mapping:
 *   EdgeStartTimestamp, ClientIP, ClientRequestMethod, ClientRequestURI,
 *   EdgeResponseStatus, EdgeResponseBytes, ClientRequestReferer, ClientRequestUserAgent
 */

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // Attempt JSON parse first (Logpush format)
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      const ts =
        obj.EdgeStartTimestamp
          ? new Date(obj.EdgeStartTimestamp).getTime()
          : obj.timestamp
          ? new Date(obj.timestamp).getTime()
          : null;

      if (!ts || isNaN(ts)) return null;

      const urlRaw = obj.ClientRequestURI || obj.url || '/';
      return {
        ts,
        ip: obj.ClientIP || obj.clientIP || null,
        method: obj.ClientRequestMethod || obj.method || 'GET',
        url_path: urlRaw.split('?')[0],
        status_code: parseInt(obj.EdgeResponseStatus || obj.status || 0, 10),
        bytes: parseInt(obj.EdgeResponseBytes || obj.bytes || 0, 10) || 0,
        referrer: obj.ClientRequestReferer || obj.referer || null,
        user_agent: obj.ClientRequestUserAgent || obj.userAgent || null,
      };
    } catch {
      return null;
    }
  }

  // Fallback: try Apache format (Cloudflare can export Apache-style)
  const apacheParser = require('./apacheParser');
  return apacheParser.parseLine(trimmed);
}

module.exports = { parseLine };
