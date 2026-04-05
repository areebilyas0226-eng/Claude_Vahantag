'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const tagController = require('../controllers/tagController');
const documentController = require('../controllers/documentController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { upload } = require('../services/uploadService');

router.use(authenticate, requireRole('user'));

// Activate tag
router.post('/tags/activate', [
  body('qrCode').notEmpty(),
  validate,
], tagController.activateTag);

// List tags
router.get('/tags', tagController.getUserTags);

// Tag detail
router.get('/tags/:id', [
  param('id').isUUID(),
  validate,
], tagController.getTagDetail);

// Update tag
router.put('/tags/:id', [
  param('id').isUUID(),
  validate,
], tagController.updateTag);

// Renew
router.post('/tags/:id/renew', [
  param('id').isUUID(),
  validate,
], tagController.renewTag);

// Premium
router.post('/tags/:id/unlock-premium', [
  param('id').isUUID(),
  validate,
], tagController.unlockPremium);

// Upload doc
router.post('/documents/upload',
  upload.single('file'),
  validate,
  documentController.uploadDocument
);

// Delete doc
router.delete('/tags/:tagId/documents/:docId', [
  param('tagId').isUUID(),
  param('docId').isUUID(),
  validate,
], documentController.deleteDocument);

module.exports = router;