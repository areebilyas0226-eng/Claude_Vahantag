'use strict';

const express = require('express');
const { param, body } = require('express-validator');
const router = express.Router();

const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { validate } = require('../middleware/validate');
const { scanLimiter } = require('../middleware/rateLimiter');

router.use(scanLimiter);

// SCAN
router.get('/:qrCode', [
  param('qrCode').matches(/^VT-[A-Z0-9]+$/),
  validate,
], async (req, res) => {
  try {
    const { qrCode } = req.params;

    const { rows } = await query(
      `SELECT t.*, ta.owner_name, ta.owner_phone
       FROM tags t
       LEFT JOIN tag_assets ta ON ta.tag_id = t.id
       WHERE t.qr_code = $1`,
      [qrCode]
    );

    if (!rows.length) return error(res, 'Invalid QR', 404);

    return success(res, rows[0]);

  } catch {
    return error(res, 'Scan failed', 500);
  }
});

// CONTACT
router.post('/:qrCode/contact', [
  param('qrCode').matches(/^VT-[A-Z0-9]+$/),
  body('message').isLength({ min: 5 }),
  validate,
], (req, res) => {
  return success(res, null, 'Contact sent');
});

// CALL
router.post('/:qrCode/call', [
  param('qrCode').matches(/^VT-[A-Z0-9]+$/),
  validate,
], (req, res) => {
  return success(res, null, 'Call triggered');
});

module.exports = router;