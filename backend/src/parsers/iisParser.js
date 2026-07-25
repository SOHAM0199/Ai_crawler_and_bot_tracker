'use strict';

/**
 * IIS W3C Log Format Parser
 *
 * Fields line example:
 * #Fields: date time c-ip cs-method cs-uri-stem sc-status cs-bytes sc(Referer) cs(User-Agent)
 *
 * Data line example:
 * 2024-07-01 00:01:23 66.249.64.14 GET /pricing 200 4523 - Googlebot/2.1
 */

let fieldMap = null;
const DEFAULT_FIELDS = [
  'date', 'time', 'c-ip', 'cs-method', 'cs-uri-stem',
  'sc-status', 'cs-bytes', 'cs(Referer)', 'cs(User-Agent)',
];

function parseFields(line) {
  // "#Fields: date time c-ip ..."
  const raw = line.replace('#Fields:', '').trim();
  fieldMap = raw.split(/\s+/);
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#Fields:')) {
    parseFields(trimmed);
    return null;
  }
  if (trimmed.startsWith('#')) return null;

  const fields = fieldMap || DEFAULT_FIELDS;
  const parts = trimmed.split(/\s+/);

  const get = (name) => {
    const idx = fields.indexOf(name);
    return idx >= 0 && idx < parts.length ? parts[idx] : null;
  };

  const date = get('date');
  const time = get('time');
  if (!date || !time) return null;

  const ts = new Date(`${date}T${time}Z`).getTime();
  if (isNaN(ts)) return null;

  const urlRaw = get('cs-uri-stem') || '-';

  return {
    ts,
    ip: get('c-ip'),
    method: get('cs-method') || 'GET',
    url_path: urlRaw === '-' ? '/' : urlRaw,
    status_code: parseInt(get('sc-status') || '0', 10),
    bytes: parseInt(get('cs-bytes') || '0', 10) || 0,
    referrer: get('cs(Referer)') === '-' ? null : get('cs(Referer)'),
    user_agent: get('cs(User-Agent)') || null,
  };
}

// Reset field map between files
function reset() { fieldMap = null; }

module.exports = { parseLine, reset };
