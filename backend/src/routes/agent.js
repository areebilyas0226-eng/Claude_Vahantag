'use strict';

const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const agentController = require('../controllers/agentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// 🔐 Protected (Agent only)
router.use(authenticate, requireRole('agent'));

//
// ─────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────
//
router.get('/inventory', agentController.getInventory);

//
// ─────────────────────────────────────────
// PLACE ORDER (FIXED)
// ─────────────────────────────────────────
//
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
      .isInt({ min: 1, max: 5000 }) // 🔥 reduced for safety
      .withMessage('Quantity must be between 1-5000'),

    // ✅ FIX: notes at ROOT
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Notes must be max 500 chars'),

    validate,
  ],
  agentController.placeOrder
);

//
// ─────────────────────────────────────────
// GET ORDERS
// ─────────────────────────────────────────
//
router.get('/orders', agentController.getOrders);

//
// ─────────────────────────────────────────
// GET TAGS
// ─────────────────────────────────────────
//
router.get('/tags', agentController.getTags);

//
// ─────────────────────────────────────────
// SALES
// ─────────────────────────────────────────
//
router.get('/sales', agentController.getSales);

//
// ─────────────────────────────────────────
// CATEGORY (FOR AGENT APP)
// ─────────────────────────────────────────
//
router.get('/categories', agentController.getCategories); // 🔥 FIXED plural

module.exports = router;