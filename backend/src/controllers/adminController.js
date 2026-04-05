'use strict';

const bcrypt = require('bcrypt');
const { customAlphabet } = require('nanoid');
const { query, withTransaction } = require('../config/db');
const { success, error } = require('../utils/response');
const { sendSms } = require('../services/smsService');
const logger = require('../utils/logger');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);
const SALT_ROUNDS = 10;

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');

// ─────────────────────────────
// 📊 ANALYTICS (CRASH SAFE)
// ─────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    let revenue = 0;

    try {
      const r = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`);
      revenue = Number(r.rows?.[0]?.total || 0);
    } catch {}

    const scans = await query(`SELECT COUNT(*) AS total FROM scans`);
    const tags = await query(`SELECT COUNT(*) AS total FROM tags`);

    const agents = await query(`
      SELECT COUNT(*) AS total
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE COALESCE(u.is_active,true) = true
    `);

    return success(res, {
      revenue,
      totalScans: Number(scans.rows[0].total),
      totalTags: Number(tags.rows[0].total),
      activeAgents: Number(agents.rows[0].total),
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Analytics failed', 500);
  }
};

// ─────────────────────────────
// CREATE AGENT (FIXED)
// ─────────────────────────────
exports.createAgent = async (req, res) => {
  try {
    let { name, phone, businessName } = req.body;

    if (!name || !phone || !businessName) {
      return error(res, 'Required fields missing', 400);
    }

    phone = normalizePhone(phone);

    const tempPassword = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const agent = await withTransaction(async (client) => {

      const { rows: existing } = await client.query(
        `SELECT id FROM users WHERE phone=$1`,
        [phone]
      );

      if (existing.length) {
        throw { message: 'Phone already exists', statusCode: 409 };
      }

      const { rows: userRows } = await client.query(
        `INSERT INTO users (name, phone, password_hash, role, is_active)
         VALUES ($1,$2,$3,'agent',true)
         RETURNING id`,
        [name, phone, hash]
      );

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents (user_id, business_name)
         VALUES ($1,$2)
         RETURNING *`,
        [userRows[0].id, businessName]
      );

      return agentRows[0];
    });

    sendSms(phone, `Password: ${tempPassword}`).catch(() => {});

    return success(res, { agent, tempPassword });

  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Failed', err.statusCode || 500);
  }
};

// ─────────────────────────────
// LIST AGENTS (CORRECT COUNTS)
// ─────────────────────────────
exports.listAgents = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        a.id,
        u.name,
        u.phone,
        COALESCE(u.is_active,true) AS is_active,

        COUNT(DISTINCT t.id) FILTER (WHERE t.status='active') AS active,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status='sold') AS sold,
        COUNT(DISTINCT o.id) AS orders

      FROM agents a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN tags t ON t.agent_id = a.id
      LEFT JOIN tag_orders o ON o.agent_id = a.id

      GROUP BY a.id, u.name, u.phone, u.is_active
      ORDER BY a.id DESC
    `);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// TAGS
// ─────────────────────────────
exports.listAllTags = async (req, res) => {
  try {
    const status = req.query.status;

    let sql = `SELECT * FROM tags`;
    let params = [];

    if (status) {
      sql += ` WHERE status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC`;

    const { rows } = await query(sql, params);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// TAG DETAILS
// ─────────────────────────────
exports.getTagDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await query(`
      SELECT 
        t.*,
        v.vehicle_number,
        v.owner_name,
        u.name AS agent_name,
        u.phone AS agent_phone
      FROM tags t
      LEFT JOIN vehicles v ON v.tag_id = t.id
      LEFT JOIN agents a ON a.id = t.agent_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE t.id = $1
    `, [id]);

    if (!rows.length) return error(res, 'Not found', 404);

    return success(res, rows[0]);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// ORDERS (FIXED TABLE)
// ─────────────────────────────
exports.listOrders = async (req, res) => {
  try {
    const status = req.query.status;

    let sql = `
      SELECT o.*, u.name AS agent_name
      FROM tag_orders o
      LEFT JOIN agents a ON a.id = o.agent_id
      LEFT JOIN users u ON u.id = a.user_id
    `;

    let params = [];

    if (status) {
      sql += ` WHERE o.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY o.created_at DESC`;

    const { rows } = await query(sql, params);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// SUBSCRIPTIONS (FILTER)
// ─────────────────────────────
exports.getSubscriptions = async (req, res) => {
  try {
    const type = req.query.type;

    let filter = '';
    if (type === 'active') filter = 'WHERE s.expires_at > NOW()';
    if (type === 'expired') filter = 'WHERE s.expires_at <= NOW()';

    const { rows } = await query(`
      SELECT 
        s.*,
        t.code,
        u.name,
        u.phone
      FROM subscriptions s
      LEFT JOIN tags t ON t.id = s.tag_id
      LEFT JOIN users u ON u.id = s.user_id
      ${filter}
      ORDER BY s.created_at DESC
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
    const { rows } = await query(
      `SELECT user_id FROM agents WHERE id=$1`,
      [req.params.id]
    );

    if (!rows.length) return error(res, 'Not found', 404);

    const newPass = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(newPass, SALT_ROUNDS);

    await query(
      `UPDATE users SET password_hash=$1 WHERE id=$2`,
      [hash, rows[0].user_id]
    );

    return success(res, { newPass });

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
    await query(`
      UPDATE users SET is_active=false
      WHERE id=(SELECT user_id FROM agents WHERE id=$1)
    `, [req.params.id]);

    return success(res, null, 'Deactivated');

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ─────────────────────────────
// PLANS
// ─────────────────────────────
exports.getPlans = async (req, res) => {
  const { rows } = await query(`SELECT * FROM subscription_plans ORDER BY id DESC`);
  return success(res, rows);
};

exports.updatePlan = async (req, res) => {
  const { id } = req.params;
  const { price } = req.body;

  if (!price || price <= 0) {
    return error(res, 'Invalid price', 400);
  }

  await query(`UPDATE subscription_plans SET price=$1 WHERE id=$2`, [price, id]);

  return success(res, null, 'Plan updated');
};