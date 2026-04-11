'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);
router.use(requireRole('admin'));

// ───────── ANALYTICS ─────────
router.get('/analytics', adminController.getAnalytics);

// ───────── AGENTS ─────────
router.post('/agents', adminController.createAgent);
router.get('/agents', adminController.listAgents);
router.get('/agents/:id', adminController.getAgentDetail);
router.post('/agents/:id/reset-password', adminController.resetAgentPassword);

// ───────── 🔥 CATEGORY ─────────
router.get('/category', adminController.getCategories);
router.post('/category', adminController.createCategory);
router.put('/category/:id', adminController.updateCategory);

module.exports = router;