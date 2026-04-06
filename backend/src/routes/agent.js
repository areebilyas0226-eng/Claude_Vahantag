'use strict';

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 Protected (Agent only)
router.use(authenticate, requireRole('agent'));

// ─────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────
router.get('/inventory', agentController.getInventory);

// ─────────────────────────────────────────
// PLACE ORDER
// ─────────────────────────────────────────
router.post(
  '/orders',
  [
    body('categoryId').isUUID().withMessage('Valid category ID required'),
    body('quantity')
      .isInt({ min: 1, max: 10000 })
      .withMessage('Quantity must be between 1-10000'),
    body('notes').optional().isString().isLength({ max: 500 }),
    validate,
  ],
  agentController.placeOrder
);

// ─────────────────────────────────────────
// GET ORDERS
// ─────────────────────────────────────────
router.get('/orders', agentController.getOrders);

// ─────────────────────────────────────────
// GET TAGS
// ─────────────────────────────────────────
router.get('/tags', agentController.getTags);

// ─────────────────────────────────────────
// SALES
// ─────────────────────────────────────────
router.get('/sales', agentController.getSales);

module.exports = router;'use strict';

const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 Protected (Agent only)
router.use(authenticate, requireRole('agent'));

// ─────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────
router.get('/inventory', agentController.getInventory);

// ─────────────────────────────────────────
// PLACE ORDER (MULTI CATEGORY SUPPORT 🔥)
// ─────────────────────────────────────────
router.post(
  '/orders',
  [
    body('items')
      .isArray({ min: 1 })
      .withMessage('Items array required'),

    body('items.*.categoryId')
      .isUUID()
      .withMessage('Valid category ID required'),

    body('items.*.quantity')
      .isInt({ min: 1, max: 10000 })
      .withMessage('Quantity must be between 1-10000'),

    body('items.*.notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),

    validate,
  ],
  agentController.placeOrder
);

// ─────────────────────────────────────────
// GET ORDERS
// ─────────────────────────────────────────
router.get('/orders', agentController.getOrders);

// ─────────────────────────────────────────
// GET TAGS
// ─────────────────────────────────────────
router.get('/tags', agentController.getTags);

// ─────────────────────────────────────────
// SALES
// ─────────────────────────────────────────
router.get('/sales', agentController.getSales);

module.exports = router;