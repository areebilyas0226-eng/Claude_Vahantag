'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');

const router = express.Router();

const adminController = require('../controllers/adminController');
const tagController = require('../controllers/tagController');

const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 Protect all routes
router.use(authenticate, requireRole('admin'));

function safe(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      console.error('❌ ADMIN ERROR:', err);
      next(err);
    }
  };
}

// ───────── ANALYTICS ─────────
router.get('/analytics', safe(adminController.getAnalytics));

// ───────── AGENTS ─────────
router.get('/agents', safe(adminController.listAgents));
router.get('/agents/:id', safe(adminController.getAgentDetail)); // ✅ ADD THIS

router.post(
  '/agents',
  [
    body('name').notEmpty(),
    body('phone').notEmpty(),
    body('businessName').notEmpty(),
    validate
  ],
  safe(adminController.createAgent)
);

// ───────── CATEGORIES (NEW FIX) ─────────
router.get('/categories', safe(adminController.getCategories));

router.post(
  '/categories',
  [
    body('name').notEmpty(),
    body('activation_price').isNumeric(),
    body('subscription_price').isNumeric(),
    validate
  ],
  safe(adminController.createCategory)
);

router.put(
  '/categories/:id',
  [
    param('id').isInt(),
    validate
  ],
  safe(adminController.updateCategory)
);

// ───────── ORDERS ─────────
router.get('/orders', safe(adminController.listOrders));

// ───────── TAGS ─────────
router.get('/tags', safe(adminController.listAllTags));
router.post('/tags/generate', safe(tagController.generateTagsForOrder));

// ───────── SUBSCRIPTIONS ─────────
router.get('/subscriptions', safe(adminController.getSubscriptions));

module.exports = router;