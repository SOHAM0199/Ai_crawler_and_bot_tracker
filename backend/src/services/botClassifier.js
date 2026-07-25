'use strict';

const botSignatures = require('../config/botSignatures.json');

// Map of bot name to category for O(1) lookup
const botCategoryMap = {};
botSignatures.forEach((sig) => {
  botCategoryMap[sig.name] = sig.category || 'Generic Crawler';
});

// Pre-compile patterns for performance
const compiledSignatures = botSignatures.map((sig) => ({
  name: sig.name,
  group: sig.group,
  category: sig.category || 'Generic Crawler',
  patterns: sig.patterns.map((p) => new RegExp(p, 'i')),
}));

/**
 * Classify a user-agent string.
 * Returns { isBot, botName, botGroup, botCategory }
 */
function classifyUserAgent(userAgent) {
  if (!userAgent || userAgent === '-') {
    return { isBot: false, botName: null, botGroup: null, botCategory: null };
  }

  for (const sig of compiledSignatures) {
    for (const pattern of sig.patterns) {
      if (pattern.test(userAgent)) {
        return {
          isBot: true,
          botName: sig.name,
          botGroup: sig.group,
          botCategory: sig.category
        };
      }
    }
  }

  // Generic heuristics — catch bots that aren't in the signature list
  const genericBotPatterns = [
    /bot/i, /crawler/i, /spider/i, /scraper/i, /fetcher/i,
    /monitoring/i, /checker/i, /validator/i, /archiver/i,
    /wget/i, /curl/i, /python-requests/i, /go-http-client/i,
    /java\//i, /libwww-perl/i, /okhttp/i, /axios/i,
  ];

  for (const p of genericBotPatterns) {
    if (p.test(userAgent)) {
      return { isBot: true, botName: 'Unknown Bot', botGroup: 'Other', botCategory: 'Generic Crawler' };
    }
  }

  return { isBot: false, botName: null, botGroup: null, botCategory: null };
}

/**
 * Get category for a bot by name (with fallback)
 */
function getBotCategory(botName) {
  if (!botName) return 'Generic Crawler';
  return botCategoryMap[botName] || 'Generic Crawler';
}

/**
 * Get all known bot signatures (for UI dropdowns)
 */
function getBotSignatures() {
  return botSignatures;
}

/**
 * Get unique bot groups
 */
function getBotGroups() {
  return [...new Set(botSignatures.map((s) => s.group))];
}

/**
 * Get unique bot categories
 */
function getBotCategories() {
  return [...new Set(botSignatures.map((s) => s.category || 'Generic Crawler'))];
}

module.exports = {
  classifyUserAgent,
  getBotCategory,
  getBotSignatures,
  getBotGroups,
  getBotCategories,
};
