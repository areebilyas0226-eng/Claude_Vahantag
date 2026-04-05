// File: backend/src/services/cronService.js
'use strict';

const cron = require('node-cron');
const { query } = require('../config/db');
const { sendExpiryReminder } = require('./smsService');
const logger = require('../utils/logger');

const REMINDER_DAYS = parseInt(process.env.EXPIRY_REMINDER_DAYS || '7', 10);

async function sendExpiryReminders() {
  logger.info('[CRON] Running expiry reminder job...');

  try {
    // Find subscriptions expiring in exactly REMINDER_DAYS days, reminder not yet sent
    const { rows } = await query(
      `SELECT s.id AS subscription_id, s.tag_id, s.valid_until,
              u.phone AS user_phone, u.name AS user_name,
              tc.name AS category_name,
              a.id AS agent_id,
              au.phone AS agent_phone
       FROM subscriptions s
       JOIN tags t ON t.id = s.tag_id
       JOIN tag_categories tc ON tc.id = t.category_id
       JOIN users u ON u.id = s.user_id
       JOIN agents a ON a.id = t.agent_id
       JOIN users au ON au.id = a.user_id
       WHERE s.renewal_reminder_sent = false
         AND s.valid_until BETWEEN NOW() AND NOW() + INTERVAL '${REMINDER_DAYS} days'
         AND t.status = 'active'`
    );

    logger.info(`[CRON] Found ${rows.length} subscriptions needing reminders`);

    for (const row of rows) {
      const expiryDate = new Date(row.valid_until).toLocaleDateString('en-IN');

      // SMS to user
      await sendExpiryReminder(row.user_phone, row.category_name, expiryDate);

      // SMS to agent
      if (row.agent_phone) {
        const agentMsg = `Alert: Your customer's VahanTag (${row.category_name}) expires on ${expiryDate}. Please follow up for renewal.`;
        const { sendSms } = require('./smsService');
        await sendSms(row.agent_phone, agentMsg);
      }

      // Mark reminder as sent
      await query(
        'UPDATE subscriptions SET renewal_reminder_sent = true WHERE id = $1',
        [row.subscription_id]
      );

      logger.info(`[CRON] Reminder sent for tag ${row.tag_id}`);
    }

    logger.info('[CRON] Expiry reminder job complete');
  } catch (err) {
    logger.error('[CRON] Expiry reminder job failed:', err.message);
  }
}

async function markExpiredTags() {
  logger.info('[CRON] Marking expired tags...');
  try {
    const { rowCount } = await query(
      `UPDATE tags SET status = 'expired'
       WHERE status = 'active' AND expires_at < NOW()`
    );
    if (rowCount > 0) logger.info(`[CRON] Marked ${rowCount} tag(s) as expired`);
  } catch (err) {
    logger.error('[CRON] Mark expired tags failed:', err.message);
  }
}

function startCronJobs() {
  const schedule = process.env.CRON_EXPIRY_REMINDER_SCHEDULE || '0 8 * * *';

  cron.schedule(schedule, async () => {
    await markExpiredTags();
    await sendExpiryReminders();
  });

  logger.info(`[CRON] Expiry reminder job scheduled: ${schedule}`);
}

module.exports = { startCronJobs, sendExpiryReminders, markExpiredTags };
