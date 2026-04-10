'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { authenticate, requireRole } = require('../middleware/auth');

// 🔥 GLOBAL GUARD (applies to ALL routes below)
router.use(authenticate);
router.use(requireRole('admin'));

// ───────── ANALYTICS ─────────
router.get('/analytics', adminController.getAnalytics);

// ───────── AGENTS ─────────
router.post('/agents', adminController.createAgent);

router.get('/agents', adminController.listAgents);

router.get('/agents/:id', adminController.getAgentDetail);

router.post('/agents/:id/reset-password', adminController.resetAgentPassword);

module.exports = router;