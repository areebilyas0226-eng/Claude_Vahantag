'use strict';

const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 protect route
router.use(authenticate);

// ─────────────────────────────
// 💳 CREATE PAYMENT
// ─────────────────────────────
router.post(
  '/pay',
  [
    body('tagId').isInt(),
    body('planId').isInt(),
    body('amount').isNumeric(),
    validate
  ],
  async (req, res) => {
    try {
      const { tagId, planId, amount } = req.body;
      const userId = req.user.id;

      // 1. Insert payment
      await query(`
        INSERT INTO payments (user_id, tag_id, plan_id, amount)
        VALUES ($1,$2,$3,$4)
      `, [userId, tagId, planId, amount]);

      // 2. Get plan
      const plan = await query(
        `SELECT * FROM subscription_plans WHERE id=$1`,
        [planId]
      );

      if (!plan.rows.length) {
        return error(res, 'Plan not found', 404);
      }

      const duration = plan.rows[0].duration_days;

      // 3. Calculate expiry
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + duration);

      // 4. Create subscription
      await query(`
        INSERT INTO subscriptions (tag_id, user_id, plan_id, expires_at)
        VALUES ($1,$2,$3,$4)
      `, [tagId, userId, planId, expiry]);

      // 5. Activate tag
      await query(`
        UPDATE tags SET status='active' WHERE id=$1
      `, [tagId]);

      return success(res, { message: 'Payment successful & subscription created' });

    } catch (err) {
      console.error(err);
      return error(res, 'Payment failed', 500);
    }
  }
);

module.exports = router;