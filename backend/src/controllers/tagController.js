'use strict';

const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { customAlphabet } = require('nanoid');
const { query, withTransaction } = require('../config/db');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

const QR_BASE_URL = process.env.QR_BASE_URL || 'https://vahantag.com/scan';
const BUFFER_MULTIPLIER = parseInt(process.env.QR_BUFFER_MULTIPLIER || '2', 10);

// ─────────────────────────────────────────
// GENERATE TAGS (FIXED)
// ─────────────────────────────────────────
exports.generateTagsForOrder = async (req, res, next) => {
  try {
    const {
      orderId,
      order_id,
      agent_id,
      quantity,
    } = req.body;

    // ✅ support both formats
    const finalOrderId = orderId || order_id;

    console.log('📥 BODY:', req.body);

    // ✅ VALIDATION
    if (!finalOrderId) {
      return error(res, 'Order ID required', 422);
    }

    const { rows: orderRows } = await query(
      `SELECT * FROM tag_orders WHERE id = $1`,
      [finalOrderId]
    );

    if (!orderRows.length) {
      return error(res, 'Order not found', 404);
    }

    const order = orderRows[0];

    // ✅ quantity fallback logic
    let finalQty;

    if (quantity && !isNaN(quantity)) {
      finalQty = Number(quantity);
    } else if (order.qty_ordered) {
      finalQty = Number(order.qty_ordered) * BUFFER_MULTIPLIER;
    } else {
      return error(res, 'Invalid quantity', 422);
    }

    if (!finalQty || finalQty <= 0) {
      return error(res, 'Invalid quantity', 422);
    }

    const generated = [];

    await withTransaction(async (client) => {
      for (let i = 0; i < finalQty; i++) {
        let qrCode;
        let exists = true;

        // ✅ ensure unique QR
        while (exists) {
          qrCode = `VT-${nanoid()}`;

          const check = await client.query(
            'SELECT id FROM tags WHERE qr_code = $1',
            [qrCode]
          );

          exists = check.rows.length > 0;
        }

        const { rows } = await client.query(
          `INSERT INTO tags (qr_code, category_id, agent_id, order_id, status)
           VALUES ($1,$2,$3,$4,'unassigned')
           RETURNING id, qr_code`,
          [
            qrCode,
            order.category_id,
            order.agent_id,
            finalOrderId,
          ]
        );

        generated.push(rows[0]);
      }

      await client.query(
        `UPDATE tag_orders 
         SET status='fulfilled', qty_generated=$1 
         WHERE id=$2`,
        [finalQty, finalOrderId]
      );
    });

    return success(res, {
      generated: finalQty,
      tags: generated,
    });

  } catch (err) {
    console.log('❌ GENERATE ERROR:', err);
    next(err);
  }
};

// ─────────────────────────────────────────
// ACTIVATE TAG
// ─────────────────────────────────────────
exports.activateTag = async (req, res) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) return error(res, 'QR required', 422);

    const { rows } = await query(
      `SELECT * FROM tags WHERE qr_code = $1`,
      [qrCode]
    );

    if (!rows.length) return error(res, 'QR not found', 404);

    const tag = rows[0];

    await query(
      `UPDATE tags SET user_id=$1, status='active' WHERE id=$2`,
      [req.user.id, tag.id]
    );

    return success(res, {}, 'Activated');

  } catch (err) {
    logger.error(err);
    return error(res, 'Activation failed', 500);
  }
};

// ─────────────────────────────────────────
// GET USER TAGS
// ─────────────────────────────────────────
exports.getUserTags = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM tags WHERE user_id=$1`,
      [req.user.id]
    );

    return success(res, rows);

  } catch (err) {
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────────────────
// GET TAG DETAIL
// ─────────────────────────────────────────
exports.getTagDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await query(
      `SELECT * FROM tags WHERE id=$1 AND user_id=$2`,
      [id, req.user.id]
    );

    if (!rows.length) return error(res, 'Tag not found', 404);

    return success(res, rows[0]);

  } catch (err) {
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────────────────
// UPDATE TAG
// ─────────────────────────────────────────
exports.updateTag = async (req, res) => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE tag_assets SET asset_data=$1 WHERE tag_id=$2`,
      [JSON.stringify(req.body || {}), id]
    );

    return success(res, {}, 'Updated');

  } catch (err) {
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────────────────
// RENEW TAG
// ─────────────────────────────────────────
exports.renewTag = async (req, res) => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE tags 
       SET expires_at = NOW() + INTERVAL '365 days' 
       WHERE id=$1`,
      [id]
    );

    return success(res, {}, 'Renewed');

  } catch (err) {
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────────────────
// UNLOCK PREMIUM
// ─────────────────────────────────────────
exports.unlockPremium = async (req, res) => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE tags SET is_premium=true WHERE id=$1`,
      [id]
    );

    return success(res, {}, 'Premium unlocked');

  } catch (err) {
    return error(res, 'Failed', 500);
  }
};