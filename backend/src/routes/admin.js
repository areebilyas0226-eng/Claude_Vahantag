'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');

const router = express.Router();

const adminController = require('../controllers/adminController');
const tagController   = require('../controllers/tagController');

const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 protect all routes
router.use(authenticate, requireRole('admin'));

// DEBUG
console.log('ADMIN CONTROLLER KEYS:', Object.keys(adminController));

// SAFE WRAPPER
function safe(handler, name) {
  if (typeof handler !== 'function') {
    console.error(`❌ ${name} is NOT a function`);
    return (req, res) => res.status(500).json({
      success: false,
      message: `${name} not implemented`
    });
  }
  return handler;
}

// ─────────────────────────────
// 📊 ANALYTICS (FIXED)
// ─────────────────────────────
router.get(
  '/analytics',
  safe(adminController.getAnalytics, 'getAnalytics')
);

// ─────────────────────────────
// AGENTS
// ─────────────────────────────
router.get(
  '/agents',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate
  ],
  safe(adminController.listAgents, 'listAgents')
);

router.post(
  '/agents',
  [
    body('name').trim().notEmpty(),
    body('phone').matches(/^[6-9]\d{9}$/),
    body('businessName').trim().notEmpty(),
    body('email').optional().isEmail(),
    validate
  ],
  safe(adminController.createAgent, 'createAgent')
);

router.delete(
  '/agents/:id',
  [
    param('id').isUUID(),
    validate
  ],
  safe(adminController.deactivateAgent, 'deactivateAgent')
);

router.post(
  '/agents/:id/reset-password',
  [
    param('id').isUUID(),
    validate
  ],
  safe(adminController.resetAgentPassword, 'resetAgentPassword')
);

// ─────────────────────────────
// ORDERS
// ─────────────────────────────
router.get(
  '/orders',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate
  ],
  safe(adminController.listOrders, 'listOrders')
);

// ─────────────────────────────
// TAGS
// ─────────────────────────────
router.post(
  '/tags/generate',
  [
    body('orderId').isUUID(),
    validate
  ],
  safe(tagController.generateTagsForOrder, 'generateTagsForOrder')
);

router.get(
  '/tags',
  safe(adminController.listAllTags, 'listAllTags')
);

module.exports = router;