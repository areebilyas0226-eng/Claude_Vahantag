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
// PLACE ORDER + AUTO TAG GENERATION 🔥
// ─────────────────────────────────────────
exports.placeOrder = async (req, res, next) => {
  try {
    const { categoryId, quantity, notes } = req.body;

    const agentId = await getAgentId(req.user.id);
    if (!agentId) return error(res, 'Agent not found', 404);

    // Validate category
    const { rows: cat } = await query(
      'SELECT id FROM tag_categories WHERE id = $1 AND is_active = true',
      [categoryId]
    );
    if (!cat.length) return error(res, 'Invalid category', 404);

    // 1. Create order (auto-approved for MVP)
    const orderRes = await query(
      `INSERT INTO tag_orders 
       (agent_id, category_id, qty_ordered, notes, status, created_at)
       VALUES ($1,$2,$3,$4,'approved',NOW())
       RETURNING *`,
      [agentId, categoryId, quantity, notes || null]
    );

    // 2. 🔥 BULK TAG GENERATION (FAST + SCALABLE)
    const values = [];
    const params = [];

    for (let i = 0; i < quantity; i++) {
      const idx = i * 2;
      values.push(`($${idx + 1}, $${idx + 2}, 'unassigned', NOW())`);
      params.push(agentId, categoryId);
    }

    await query(
      `INSERT INTO tags (agent_id, category_id, status, created_at)
       VALUES ${values.join(',')}`,
      params
    );

    return success(
      res,
      orderRes.rows[0],
      'Order placed & tags generated successfully',
      201
    );
  } catch (err) {
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
// GET ORDERS (PAGINATED)
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