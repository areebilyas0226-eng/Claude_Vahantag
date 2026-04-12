'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { authenticate, requireRole } = require('../middleware/auth');

// 🔐 PROTECTED (ADMIN ONLY)
router.use(authenticate);
router.use(requireRole('admin'));

// ───────── ANALYTICS ─────────
router.get('/analytics', adminController.getAnalytics);

// ───────── AGENTS ─────────
router.post('/agents', adminController.createAgent);
router.get('/agents', adminController.listAgents);
router.get('/agents/:id', adminController.getAgentDetail);
router.post('/agents/:id/reset-password', adminController.resetAgentPassword);

// ───────── ORDERS ─────────
router.get('/orders', adminController.getOrders);
router.post('/orders/:id/generate', adminController.generateTags);

// ───────── TAGS ─────────
router.get('/tags', adminController.getTags);

// ⚠️ TEMP REMOVED (controller not implemented yet)
// router.get('/tags/download/:orderId', adminController.downloadTagsPdf);

// ───────── CATEGORY ─────────
router.get('/category', adminController.getCategories);
router.post('/category', adminController.createCategory);
router.put('/category/:id', adminController.updateCategory);

module.exports = router;