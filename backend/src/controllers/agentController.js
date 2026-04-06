'use strict';

const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const crypto = require('crypto'); // ✅ QR generation

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
// PLACE ORDER (MULTI CATEGORY FINAL ✅)
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

    // ✅ Create parent order
    const orderRes = await query(
      `INSERT INTO tag_orders (agent_id, status, notes, created_at)
       VALUES ($1, 'pending', $2, NOW())
       RETURNING *`,
      [agentId, notes || null]
    );

    const orderId = orderRes.rows[0].id;

    // 🔁 Loop items
    for (const item of items) {
      const { categoryId, quantity } = item;

      if (!categoryId || !quantity || quantity < 1) {
        throw new Error('Invalid item data');
      }

      // ✅ Validate category
      const { rows: cat } = await query(
        'SELECT id FROM tag_categories WHERE id = $1 AND is_active = true',
        [categoryId]
      );
      if (!cat.length) throw new Error('Invalid category');

      // ✅ Save order item
      await query(
        `INSERT INTO tag_order_items (order_id, category_id, quantity)
         VALUES ($1, $2, $3)`,
        [orderId, categoryId, quantity]
      );

      // ✅ Generate tags WITH QR CODE
      const values = [];
      const params = [];

      for (let i = 0; i < quantity; i++) {
        const qrCode = crypto.randomUUID(); // 🔥 FIX

        const idx = i * 3;
        values.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, 'unassigned', NOW())`);
        params.push(agentId, categoryId, qrCode);
      }

      if (values.length > 0) {
        await query(
          `INSERT INTO tags (agent_id, category_id, qr_code, status, created_at)
           VALUES ${values.join(',')}`,
          params
        );
      }
    }

    await query('COMMIT');

    return success(
      res,
      orderRes.rows[0],
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