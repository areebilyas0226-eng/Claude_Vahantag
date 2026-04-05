// File: backend/src/routes/cron.js
'use strict';

const express = require('express');
const router = express.Router();

const { requireCronSecret } = require('../middleware/auth');
const { sendExpiryReminders, markExpiredTags } = require('../services/cronService');
const { success, error } = require('../utils/response');

// POST /api/cron/expiry-reminders  (internal only, guarded by secret header)
router.post('/expiry-reminders', requireCronSecret, async (req, res, next) => {
  try {
    await markExpiredTags();
    await sendExpiryReminders();
    return success(res, null, 'Expiry reminder job executed');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
