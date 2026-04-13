'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { authenticate, requireRole } = require('../middleware/auth');

// 🔐 PROTECTED
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

// 🔥 ADD THIS (MISSING)
router.post('/orders/:id/generate', adminController.generateTags);

// ───────── TAGS ─────────

// 🔥 ADD THIS (MISSING)
router.get('/tags', adminController.getTags);

// ───────── CATEGORY ─────────
router.get('/category', adminController.getCategories);
router.post('/category', adminController.createCategory);
router.put('/category/:id', adminController.updateCategory);

module.exports = router;