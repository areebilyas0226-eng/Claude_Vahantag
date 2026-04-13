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

// ───────── ANALYTICS ─────────
exports.getAnalytics = async (req, res) => {
  try {
    const revenueRes  = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`);
    const scans       = await query(`SELECT COUNT(*) AS total FROM scans`);
    const totalTags   = await query(`SELECT COUNT(*) FROM tags`);
    const activeTags  = await query(`SELECT COUNT(*) FROM tags WHERE status='active'`);
    const expiredTags = await query(`SELECT COUNT(*) FROM tags WHERE status='expired'`);
    const agents      = await query(`SELECT COUNT(*) FROM agents`);
    const orders      = await query(`SELECT COUNT(*) FROM tag_orders`);
    const pendingOrders = await query(`SELECT COUNT(*) FROM tag_orders WHERE status='pending'`);

    return success(res, {
      revenue:        Number(revenueRes.rows[0]?.total    || 0),
      totalScans:     Number(scans.rows[0]?.total         || 0),
      totalTags:      Number(totalTags.rows[0]?.count     || 0),
      activeTags:     Number(activeTags.rows[0]?.count    || 0),
      expiredTags:    Number(expiredTags.rows[0]?.count   || 0),
      activeAgents:   Number(agents.rows[0]?.count        || 0),
      totalOrders:    Number(orders.rows[0]?.count        || 0),
      pendingOrders:  Number(pendingOrders.rows[0]?.count || 0),
    });
  } catch (err) {
    logger.error(err);
    return error(res, 'Analytics failed', 500);
  }
};

// ───────── CREATE AGENT ─────────
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
      if (existing.length) throw { message: 'Phone already exists', statusCode: 409 };

      const { rows: userRows } = await client.query(
        `INSERT INTO users (name, phone, password_hash, role, is_active)
         VALUES ($1,$2,$3,'agent',true) RETURNING id`,
        [clean(name), phone, hash]
      );
      const userId = userRows[0].id;

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents (
           user_id, business_name, owner_name,
           city, state, address, generated_user_id, created_by_admin
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [userId, clean(businessName), clean(ownerName), clean(city), clean(state), clean(address), userId, adminId]
      );

      return { agent: agentRows[0], userId };
    });

    sendSms(phone, `Login ID: ${result.userId} Password: ${tempPassword}`).catch(() => {});

    return success(res, {
      agent: result.agent,
      loginId: result.agent.generated_user_id,
      tempPassword,
    });
  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Failed', err.statusCode || 500);
  }
};

// ───────── LIST AGENTS ─────────
exports.listAgents = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        a.id,
        a.user_id,
        u.name,
        u.phone,
        a.business_name,
        a.city,
        a.state,
        COALESCE(u.is_active, true) AS is_active,
        (
          SELECT COUNT(*) FROM tag_orders o
          WHERE o.agent_id = a.id AND o.status = 'pending'
        )::int AS active_order_count
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

// ───────── AGENT DETAIL ─────────
exports.getAgentDetail = async (req, res) => {
  try {
    const agentUserId = req.params.id;

    const { rows } = await query(`
      SELECT
        a.id,
        a.user_id,
        u.name,
        u.phone,
        u.email,
        a.business_name,
        a.owner_name,
        a.city,
        a.state,
        a.address,
        u.is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1 OR a.id::text = $1
      LIMIT 1
    `, [agentUserId]);

    if (!rows.length) return error(res, 'Agent not found', 404);

    const agent = rows[0];

    // Orders
    const { rows: orders } = await query(`
      SELECT
        o.id,
        o.status,
        o.created_at,
        COALESCE(o.qty_ordered, o.qty, o.quantity, 0) AS qty_ordered,
        COALESCE(o.qty_generated, 0)                  AS qty_generated,
        o.notes,
        tc.name AS category_name
      FROM tag_orders o
      LEFT JOIN tag_categories tc ON tc.id = o.category_id
      WHERE o.agent_id = $1
      ORDER BY o.created_at DESC
    `, [agent.id]);

    // Tags
    const { rows: tags } = await query(`
      SELECT
        t.id,
        t.qr_code,
        t.status,
        t.activated_at,
        t.expires_at,
        tc.name AS category_name,
        u.name  AS owner_name
      FROM tags t
      LEFT JOIN tag_categories tc ON tc.id = t.category_id
      LEFT JOIN users u ON u.id = t.owner_id
      WHERE t.agent_id = $1
      ORDER BY t.created_at DESC
      LIMIT 50
    `, [agent.id]);

    // Active subscription
    const { rows: subRows } = await query(`
      SELECT
        s.id,
        s.status,
        s.expires_at,
        tc.name AS plan_name
      FROM subscriptions s
      LEFT JOIN tag_categories tc ON tc.id = s.category_id
      WHERE s.agent_id = $1 AND s.status = 'active'
      ORDER BY s.expires_at DESC
      LIMIT 1
    `, [agent.id]);

    return success(res, {
      ...agent,
      orders,
      tags,
      subscription: subRows[0] || null,
    });
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ───────── GET ORDERS ─────────
exports.getOrders = async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;

    let sql = `
      SELECT
        o.id,
        o.status,
        o.notes,
        o.created_at,
        COALESCE(o.qty_ordered, o.qty, o.quantity, 0) AS qty_ordered,
        COALESCE(o.qty_generated, 0)                  AS qty_generated,
        a.business_name,
        tc.name AS category_name
      FROM tag_orders o
      JOIN agents a  ON a.id  = o.agent_id
      LEFT JOIN tag_categories tc ON tc.id = o.category_id
    `;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` WHERE o.status = $${params.length}`;
    }

    sql += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1}`;
    params.push(Number(limit));

    const { rows } = await query(sql, params);
    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch orders', 500);
  }
};

// ───────── GENERATE TAGS ─────────
exports.generateTags = async (req, res) => {
  try {
    const orderId = req.params.id;

    const { rows: orderRows } = await query(
      `SELECT * FROM tag_orders WHERE id = $1`,
      [orderId]
    );
    if (!orderRows.length) return error(res, 'Order not found', 404);

    const order = orderRows[0];
    if (order.status !== 'pending') {
      return error(res, `Order is already ${order.status}`, 400);
    }

    const qty = Number(order.qty_ordered || order.qty || order.quantity || 0);
    if (!qty) return error(res, 'Order has no quantity', 400);

    const generated = await withTransaction(async (client) => {
      const tags = [];
      for (let i = 0; i < qty; i++) {
        const qrCode = `VT-${nanoid()}`;
        const { rows } = await client.query(
          `INSERT INTO tags (qr_code, agent_id, category_id, status, order_id)
           VALUES ($1, $2, $3, 'unassigned', $4)
           RETURNING id`,
          [qrCode, order.agent_id, order.category_id, orderId]
        );
        tags.push(rows[0].id);
      }

      await client.query(
        `UPDATE tag_orders
         SET status = 'fulfilled',
             qty_generated = $1
         WHERE id = $2`,
        [qty, orderId]
      );

      return tags.length;
    });

    return success(res, { generated, orderId });
  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Generate failed', 500);
  }
};

// ───────── GET TAGS ─────────
exports.getTags = async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      conditions.push(`t.qr_code ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM tags t ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.count || 0);

    // Data
    params.push(Number(limit), Number(offset));
    const { rows } = await query(`
      SELECT
        t.id,
        t.qr_code,
        t.status,
        t.activated_at,
        t.expires_at,
        tc.name AS category_name,
        a.business_name,
        u.name  AS owner_name
      FROM tags t
      LEFT JOIN tag_categories tc ON tc.id = t.category_id
      LEFT JOIN agents a          ON a.id  = t.agent_id
      LEFT JOIN users u           ON u.id  = t.owner_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.json({
      success: true,
      data: rows,
      pagination: { total, limit: Number(limit), offset: Number(offset) },
    });
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch tags', 500);
  }
};

// ───────── RESET PASSWORD ─────────
exports.resetAgentPassword = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT user_id FROM agents WHERE user_id = $1 OR id::text = $1`,
      [req.params.id]
    );
    if (!rows.length) return error(res, 'Not found', 404);

    const newPass = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(newPass, SALT_ROUNDS);

    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hash, rows[0].user_id]
    );

    return success(res, { newPass });
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ───────── CATEGORIES ─────────
exports.getCategories = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM tag_categories ORDER BY created_at DESC`
    );
    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, yearly_price, yearlyPrice } = req.body;
    const price = yearly_price || yearlyPrice;

    if (!name || !price) return error(res, 'Name & price required', 400);

    const { rows } = await query(
      `INSERT INTO tag_categories (name, yearly_price)
       VALUES ($1, $2) RETURNING *`,
      [name.trim(), Number(price)]
    );
    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Create failed', 500);
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { yearly_price, yearlyPrice, isActive } = req.body;
    const price = yearly_price ?? yearlyPrice;

    const fields = [];
    const params = [];

    if (price !== undefined) {
      params.push(Number(price));
      fields.push(`yearly_price = $${params.length}`);
    }
    if (isActive !== undefined) {
      params.push(Boolean(isActive));
      fields.push(`is_active = $${params.length}`);
    }

    if (!fields.length) return error(res, 'Nothing to update', 400);

    params.push(id);
    const { rows } = await query(
      `UPDATE tag_categories SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!rows.length) return error(res, 'Category not found', 404);
    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Update failed', 500);
  }
};

// ───────── SUBSCRIPTIONS ─────────
exports.getSubscriptions = async (req, res) => {
  try {
    const { status = 'active', limit = 100 } = req.query;

    const { rows } = await query(`
      SELECT
        s.id,
        s.status,
        s.expires_at,
        t.qr_code,
        tc.name  AS category_name,
        a.business_name,
        u.name   AS owner_name
      FROM subscriptions s
      LEFT JOIN tags t            ON t.id  = s.tag_id
      LEFT JOIN tag_categories tc ON tc.id = s.category_id
      LEFT JOIN agents a          ON a.id  = s.agent_id
      LEFT JOIN users u           ON u.id  = s.user_id
      WHERE s.status = $1
      ORDER BY s.expires_at ASC
      LIMIT $2
    `, [status, Number(limit)]);

    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch subscriptions', 500);
  }
};

// ───────── USERS ─────────
exports.getUsers = async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const { rows } = await query(`
      SELECT
        id,
        name,
        phone,
        email,
        is_active,
        created_at
      FROM users
      WHERE role = 'user'
      ORDER BY created_at DESC
      LIMIT $1
    `, [Number(limit)]);

    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch users', 500);
  }
};