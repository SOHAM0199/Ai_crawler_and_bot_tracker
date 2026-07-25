'use strict';

const cron = require('node-cron');
const { syncAll } = require('../services/syncService');

/**
 * Daily sync cron job — runs at 02:00 server time.
 *
 * Crontab equivalent on analytics server:
 *   0 2 * * * node /path/to/backend/src/cron/dailySync.js >> /var/log/crawler-watch/sync.log 2>&1
 */

function startDailySyncCron() {
  // Schedule: every day at 02:00
  cron.schedule('0 2 * * *', async () => {
    const now = new Date().toISOString();
    console.log(`[${now}] [CronSync] Starting daily sync for all projects...`);

    try {
      const results = await syncAll();
      for (const r of results) {
        console.log(`[CronSync] Project ${r.project_id}: status=${r.status} new_rows=${r.new_rows} size=${r.file_size}`);
      }
    } catch (err) {
      console.error(`[CronSync] Fatal error:`, err.message);
    }
  });

  console.log('[CronSync] Daily sync scheduled at 02:00 every day');
}

// Allow running standalone: node src/cron/dailySync.js
if (require.main === module) {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  syncAll()
    .then((results) => {
      console.log('Sync results:', JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Sync failed:', err);
      process.exit(1);
    });
}

module.exports = { startDailySyncCron };
