'use strict';

const { query } = require('../config/db');
const { success, error, paginated } = require('../utils/response');

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
// PLACE ORDER (MULTI CATEGORY + SAFE)
// ─────────────────────────────────────────
exports.placeOrder = async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return error(res, 'Invalid input', 400);
    }

    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    await query('BEGIN');

    // 1️⃣ Create parent order
    const orderRes = await query(
      `INSERT INTO tag_orders (agent_id, status, created_at)
       VALUES ($1, 'pending', NOW())
       RETURNING *`,
      [agentId]
    );

    const order = orderRes.rows[0];

    // 2️⃣ Process each category
    for (const item of items) {
      const { categoryId, quantity } = item;

      const qty = Number(quantity);

      if (!categoryId || !qty || qty < 1) {
        await query('ROLLBACK');
        return error(res, 'Invalid item data', 400);
      }

      // Validate category
      const { rows: cat } = await query(
        'SELECT id FROM tag_categories WHERE id = $1 AND is_active = true',
        [categoryId]
      );

      if (!cat.length) {
        await query('ROLLBACK');
        return error(res, 'Invalid category', 400);
      }

      // 🔥 BULK TAG INSERT WITH QR
      const values = [];
      const params = [];

      for (let i = 0; i < qty; i++) {
        const idx = i * 3;

        const qr = `TAG-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)}`;

        values.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, 'unassigned', NOW())`);

        params.push(agentId, categoryId, qr);
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

    return success(res, order, 'Order placed successfully', 201);

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

    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const countRes = await query(
      `SELECT COUNT(*) FROM tag_orders WHERE agent_id = $1`,
      [agentId]
    );

    const { rows } = await query(
      `SELECT *
       FROM tag_orders
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [agentId, limit, offset]
    );

    return paginated(res, rows, {
      total: Number(countRes.rows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// SALES STATS
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