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
const clean = (v) => (v && String(v).trim() ? String(v).trim() : null);

//
// ───────── ANALYTICS ─────────
//
exports.getAnalytics = async (req, res) => {
  try {
    const revenueRes = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`);
    const scans = await query(`SELECT COUNT(*) AS total FROM scans`);

    const totalTags = await query(`SELECT COUNT(*) FROM tags`);
    const activeTags = await query(`SELECT COUNT(*) FROM tags WHERE status='active'`);

    const agents = await query(`SELECT COUNT(*) FROM agents`);
    const orders = await query(`SELECT COUNT(*) FROM tag_orders`);

    return success(res, {
      revenue: Number(revenueRes.rows[0]?.total || 0),
      totalScans: Number(scans.rows[0]?.total || 0),
      totalTags: Number(totalTags.rows[0]?.count || 0),
      activeTags: Number(activeTags.rows[0]?.count || 0),
      activeAgents: Number(agents.rows[0]?.count || 0),
      totalOrders: Number(orders.rows[0]?.count || 0),
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Analytics failed', 500);
  }
};

//
// ───────── CREATE AGENT ─────────
//
exports.createAgent = async (req, res) => {
  try {
    let { name, phone, businessName, city, state, address, ownerName } = req.body;

    if (!name || !phone || !businessName) {
      return error(res, 'Name, Phone, Business Name required', 400);
    }

    const adminId = req.user?.id;
    if (!adminId) return error(res, 'Unauthorized', 401);

    phone = normalizePhone(phone);

    const tempPassword = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const result = await withTransaction(async (client) => {

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
        [clean(name), phone, hash]
      );

      const userId = userRows[0].id;

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents (
          user_id, business_name, owner_name,
          city, state, address, generated_user_id, created_by_admin
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          userId,
          clean(businessName),
          clean(ownerName),
          clean(city),
          clean(state),
          clean(address),
          userId,
          adminId
        ]
      );

      return { agent: agentRows[0], userId };
    });

    sendSms(phone, `Login ID: ${result.userId} Password: ${tempPassword}`).catch(() => {});

    return success(res, {
      agent: result.agent,
      loginId: result.agent.generated_user_id,
      tempPassword
    });

  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Failed', err.statusCode || 500);
  }
};

//
// ───────── LIST AGENTS ─────────
//
exports.listAgents = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        a.id,
        a.user_id,
        u.name,
        u.phone,
        a.business_name,
        COALESCE(u.is_active, true) AS is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC
    `);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

//
// ───────── AGENT DETAIL (🔥 FIXED CORE) ─────────
//
exports.getAgentDetail = async (req, res) => {
  try {
    const userId = req.params.id;

    const { rows } = await query(`
      SELECT 
        a.id,
        a.user_id,
        u.name,
        u.phone,
        a.business_name,
        a.city,
        a.state,
        a.address,
        u.is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1
    `, [userId]);

    if (!rows.length) return error(res, 'Agent not found', 404);

    const agent = rows[0];

    const { rows: orders } = await query(
      `SELECT * FROM tag_orders WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agent.id]
    );

    const { rows: tags } = await query(
      `SELECT id, qr_code, status FROM tags WHERE agent_id = $1`,
      [agent.id]
    );

    return success(res, {
      ...agent,
      orders,
      tags
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

//
// ───────── GET ORDERS (🔥 FILTERABLE) ─────────
//
exports.getOrders = async (req, res) => {
  try {
    const { agentId, status } = req.query;

    let where = [];
    let values = [];
    let i = 1;

    if (agentId) {
      where.push(`o.agent_id = $${i++}`);
      values.push(agentId);
    }

    if (status) {
      where.push(`o.status = $${i++}`);
      values.push(status);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await query(`
      SELECT 
        o.*,
        u.name AS agent_name
      FROM tag_orders o
      JOIN agents a ON a.id = o.agent_id
      JOIN users u ON u.id = a.user_id
      ${whereClause}
      ORDER BY o.created_at DESC
    `, values);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch orders', 500);
  }
};

//
// ───────── GENERATE TAGS (ADMIN CONTROL) ─────────
//
exports.generateTags = async (req, res) => {
  try {
    const orderId = req.params.id;

    const { rows } = await query(
      `SELECT * FROM tag_orders WHERE id=$1`,
      [orderId]
    );

    if (!rows.length) return error(res, 'Order not found', 404);

    await query(
      `UPDATE tag_orders SET status='fulfilled' WHERE id=$1`,
      [orderId]
    );

    return success(res, {
      generated: rows[0].qty_generated || 0
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Generation failed', 500);
  }
};

//
// ───────── GET TAGS ─────────
//
exports.getTags = async (req, res) => {
  try {
    const { agentId } = req.query;

    let where = '';
    let values = [];

    if (agentId) {
      where = 'WHERE agent_id = $1';
      values.push(agentId);
    }

    const { rows } = await query(`
      SELECT id, qr_code, status, agent_id
      FROM tags
      ${where}
      ORDER BY created_at DESC
    `, values);

    return success(res, rows);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch tags', 500);
  }
};

//
// ───────── RESET PASSWORD ─────────
//
exports.resetAgentPassword = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT user_id FROM agents WHERE user_id=$1`,
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