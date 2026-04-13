'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);
router.use(requireRole('admin'));

// ── ANALYTICS ────────────────────────────────────────────────────────────────
router.get('/analytics',                    adminController.getAnalytics);

// ── AGENTS ───────────────────────────────────────────────────────────────────
router.post('/agents',                      adminController.createAgent);
router.get('/agents',                       adminController.listAgents);
router.get('/agents/:id',                   adminController.getAgentDetail);
router.post('/agents/:id/reset-password',   adminController.resetAgentPassword);

// ── ORDERS ───────────────────────────────────────────────────────────────────
router.get('/orders',                       adminController.getOrders);
router.post('/orders/:id/generate',         adminController.generateTags);

// ── TAGS ─────────────────────────────────────────────────────────────────────
router.get('/tags',                         adminController.getTags);

// ── CATEGORIES  (BOTH /category and /categories to avoid 404) ────────────────
router.get('/categories',                   adminController.getCategories);
router.post('/categories',                  adminController.createCategory);
router.put('/categories/:id',               adminController.updateCategory);
router.get('/category',                     adminController.getCategories);   // legacy alias
router.post('/category',                    adminController.createCategory);  // legacy alias
router.put('/category/:id',                 adminController.updateCategory);  // legacy alias

// ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
router.get('/subscriptions',                adminController.getSubscriptions);

// ── USERS ─────────────────────────────────────────────────────────────────────
router.get('/users',                        adminController.getUsers);

module.exports = router;