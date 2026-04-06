'use strict';

const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const crypto = require('crypto');

// ─────────────────────────────────────────
// HELPER: GET AGENT ID
// ─────────────────────────────────────────
async function getAgentId(userId) {
  const { rows } = await query(
    'SELECT id FROM agents WHERE user_id = $1 AND is_active = true',
    [userId]
  );
  return rows[0]?.id || null;
}

// ─────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────
exports.getInventory = async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    const { rows } = await query(
      `SELECT
         tc.name AS category,
         COUNT(*) FILTER (WHERE t.status = 'unassigned') AS unassigned,
         COUNT(*) FILTER (WHERE t.status = 'active') AS active,
         COUNT(*) FILTER (WHERE t.status = 'expired') AS expired,
         COUNT(*) AS total
       FROM tags t
       JOIN tag_categories tc ON tc.id = t.category_id
       WHERE t.agent_id = $1
       GROUP BY tc.id, tc.name`,
      [agentId]
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// PLACE ORDER (FINAL FIXED ✅)
// ─────────────────────────────────────────
exports.placeOrder = async (req, res, next) => {
  try {
    const { items, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return error(res, 'Items required', 400);
    }

    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    await query('BEGIN');

    const orderRes = await query(
      `INSERT INTO tag_orders (agent_id, status, notes, created_at)
       VALUES ($1, 'pending', $2, NOW())
       RETURNING *`,
      [agentId, notes || null]
    );

    const orderId = orderRes.rows[0].id;

    let totalQty = 0; // 🔥 critical fix

    for (const item of items) {
      let { categoryId, quantity } = item;
      quantity = Number(quantity);

      if (!categoryId || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error('Invalid item data');
      }

      // validate category
      const { rows: cat } = await query(
        'SELECT id FROM tag_categories WHERE id = $1 AND is_active = true',
        [categoryId]
      );
      if (!cat.length) throw new Error('Invalid category');

      // save item
      await query(
        `INSERT INTO tag_order_items (order_id, category_id, quantity)
         VALUES ($1, $2, $3)`,
        [orderId, categoryId, quantity]
      );

      totalQty += quantity;

      // 🔥 chunking to avoid query size crash
      const chunkSize = 500;
      for (let start = 0; start < quantity; start += chunkSize) {
        const batch = Math.min(chunkSize, quantity - start);

        const values = [];
        const params = [];

        for (let i = 0; i < batch; i++) {
          const qrCode = crypto.randomUUID();
          const idx = i * 3;

          values.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, 'unassigned', NOW())`);
          params.push(agentId, categoryId, qrCode);
        }

        await query(
          `INSERT INTO tags (agent_id, category_id, qr_code, status, created_at)
           VALUES ${values.join(',')}`,
          params
        );
      }
    }

    // ✅ update generated qty (CRITICAL FIX)
    await query(
      `UPDATE tag_orders 
       SET qty_generated = $1 
       WHERE id = $2`,
      [totalQty, orderId]
    );

    await query('COMMIT');

    return success(
      res,
      { ...orderRes.rows[0], qty_generated: totalQty },
      'Order placed successfully',
      201
    );

  } catch (err) {
    try {
      await query('ROLLBACK');
    } catch (_) {}

    next(err);
  }
};

// ─────────────────────────────────────────
// GET TAGS
// ─────────────────────────────────────────
exports.getTags = async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    const { rows } = await query(
      `SELECT id, qr_code, status, activated_at, expires_at
       FROM tags
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId]
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// GET ORDERS
// ─────────────────────────────────────────
exports.getOrders = async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    const { rows } = await query(
      `SELECT *
       FROM tag_orders
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId]
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// SALES
// ─────────────────────────────────────────
exports.getSales = async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    const { rows } = await query(
      `SELECT DATE(activated_at) AS date, COUNT(*) AS count
       FROM tags
       WHERE agent_id = $1 AND activated_at IS NOT NULL
       GROUP BY DATE(activated_at)
       ORDER BY date DESC`,
      [agentId]
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
};