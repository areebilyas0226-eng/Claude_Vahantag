'use strict';

const bcrypt = require('bcrypt');
const { customAlphabet } = require('nanoid');
const { query, withTransaction } = require('../config/db');
const { success, error, paginated } = require('../utils/response');
const { sendSms } = require('../services/smsService');
const logger = require('../utils/logger');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);
const SALT_ROUNDS = 10;

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ─────────────────────────────
// 📊 ANALYTICS (FINAL FIXED)
// ─────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    const revenueQ = await query(`
      SELECT COALESCE(SUM(amount),0) AS total FROM payments
    `);

    const scansQ = await query(`SELECT COUNT(*) FROM scans`);
    const tagsQ = await query(`SELECT COUNT(*) FROM tags`);

    // ✅ FIXED: correct source of truth (users table)
    const agentsQ = await query(`
      SELECT COUNT(*) 
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE u.is_active = true
    `);

    return success(res, {
      revenue: Number(revenueQ.rows[0].total || 0),
      totalScans: Number(scansQ.rows[0].count),
      totalTags: Number(tagsQ.rows[0].count),
      activeAgents: Number(agentsQ.rows[0].count),
    });

  } catch (err) {
    logger.error('Analytics error:', err);
    return error(res, 'Failed to load analytics', 500);
  }
};

// ─────────────────────────────
// CREATE AGENT
// ─────────────────────────────
exports.createAgent = async (req, res) => {
  try {
    let { name, phone, email, businessName, address, city, state, pincode } = req.body;

    if (!name || !phone || !businessName) {
      return error(res, 'Name, phone, businessName required', 400);
    }

    phone = normalizePhone(phone);

    if (phone.length !== 10) {
      return error(res, 'Phone must be 10 digits', 400);
    }

    const generatedUserId = `AGT-${nanoid()}`;
    const tempPassword = `Vahan@${nanoid().slice(0, 6)}`;
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const agent = await withTransaction(async (client) => {

      const { rows: existing } = await client.query(
        'SELECT id FROM users WHERE phone = $1 FOR UPDATE',
        [phone]
      );

      if (existing.length) {
        throw { statusCode: 409, message: 'Phone already registered' };
      }

      const { rows: userRows } = await client.query(
        `INSERT INTO users (role, name, phone, email, password_hash, is_active)
         VALUES ('agent', $1, $2, $3, $4, true)
         RETURNING id`,
        [name.trim(), phone, email || null, passwordHash]
      );

      const userId = userRows[0].id;

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents
        (user_id, business_name, address, city, state, pincode, generated_user_id, created_by_admin)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          userId,
          businessName.trim(),
          address || null,
          city || null,
          state || null,
          pincode || null,
          generatedUserId,
          req.user.id
        ]
      );

      await client.query(
        'UPDATE users SET agent_id = $1 WHERE id = $2',
        [agentRows[0].id, userId]
      );

      return agentRows[0];
    });

    sendSms(phone, `ID: ${generatedUserId} Password: ${tempPassword}`).catch(() => {});

    return success(res, {
      agentId: agent.id,
      generatedUserId,
      tempPassword
    });

  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Failed', err.statusCode || 500);
  }
};

// ─────────────────────────────
// LIST AGENTS
// ─────────────────────────────
exports.listAgents = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { rows } = await query(`
      SELECT a.*, u.name, u.phone, u.is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const count = await query(`SELECT COUNT(*) FROM agents`);

    return paginated(res, rows, {
      total: Number(count.rows[0].count),
      page,
      limit
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// LIST TAGS
// ─────────────────────────────
exports.listAllTags = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT t.*, tc.name AS category_name
      FROM tags t
      LEFT JOIN tag_categories tc ON tc.id = t.category_id
      ORDER BY t.created_at DESC
    `);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch tags', 500);
  }
};

// ─────────────────────────────
// LIST ORDERS
// ─────────────────────────────
exports.listOrders = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT o.*, u.name AS agent_name
      FROM tag_orders o
      JOIN agents a ON a.id = o.agent_id
      JOIN users u ON u.id = a.user_id
      ORDER BY o.created_at DESC
    `);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// RESET PASSWORD
// ─────────────────────────────
exports.resetAgentPassword = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = $1
    `, [req.params.id]);

    if (!rows.length) return error(res, 'Not found', 404);

    const newPassword = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].id]);

    return success(res, { newPassword });

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// DEACTIVATE
// ─────────────────────────────
exports.deactivateAgent = async (req, res) => {
  try {
    // ✅ FIXED: deactivate via users table (source of truth)
    await query(`
      UPDATE users 
      SET is_active = false 
      WHERE id = (
        SELECT user_id FROM agents WHERE id = $1
      )
    `, [req.params.id]);

    return success(res, null, 'Deactivated');

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};