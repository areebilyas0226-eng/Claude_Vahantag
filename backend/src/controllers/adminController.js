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

// ───────── ANALYTICS (🔥 FIXED) ─────────
exports.getAnalytics = async (req, res) => {
  try {
    const revenueRes = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`);
    const scans = await query(`SELECT COUNT(*) AS total FROM scans`);
    const tags = await query(`SELECT COUNT(*) AS total FROM tags`);
    const agents = await query(`SELECT COUNT(*) AS total FROM agents`);
    const orders = await query(`SELECT COUNT(*) AS total FROM tag_orders`);

    return success(res, {
      revenue: Number(revenueRes.rows[0]?.total || 0),
      totalScans: Number(scans.rows[0]?.total || 0),
      totalTags: Number(tags.rows[0]?.total || 0),
      activeAgents: Number(agents.rows[0]?.total || 0), // ✅ FIXED
      totalOrders: Number(orders.rows[0]?.total || 0),
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
    if (!adminId) {
      return error(res, 'Unauthorized', 401);
    }

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
          user_id,
          business_name,
          owner_name,
          city,
          state,
          address,
          generated_user_id,
          created_by_admin
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

// ───────── LIST AGENTS (🔥 FIXED) ─────────
exports.listAgents = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        a.id,
        a.user_id,
        u.name,
        u.phone,
        a.business_name,
        a.owner_name,
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

// ───────── AGENT DETAIL ─────────
exports.getAgentDetail = async (req, res) => {
  try {
    const id = req.params.id;

    const { rows } = await query(`
      SELECT 
        a.id,
        a.user_id,
        u.name,
        u.phone,
        a.business_name,
        a.owner_name,
        a.city,
        a.state,
        a.address,
        COALESCE(u.is_active, true) AS is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1
    `, [id]);

    if (!rows.length) return error(res, 'Agent not found', 404);

    return success(res, rows[0]);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ───────── RESET PASSWORD ─────────
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

// ───────── CATEGORY ─────────

// GET
exports.getCategories = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM tag_categories ORDER BY created_at DESC`
    );

    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch categories', 500);
  }
};

// CREATE
exports.createCategory = async (req, res) => {
  try {
    const { name, yearly_price, premium_unlock_price, is_active } = req.body;

    if (!name || !yearly_price) {
      return error(res, 'Name & price required', 400);
    }

    const slug = name.toLowerCase().replace(/\s+/g, '-');

    const { rows } = await query(
      `INSERT INTO tag_categories 
      (name, slug, yearly_price, premium_unlock_price, is_active)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *`,
      [
        name.trim(),
        slug,
        Number(yearly_price),
        premium_unlock_price ? Number(premium_unlock_price) : null,
        is_active ?? true
      ]
    );

    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Create failed', 500);
  }
};

// UPDATE
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { yearly_price, premium_unlock_price, is_active } = req.body;

    const { rows } = await query(
      `UPDATE tag_categories
       SET yearly_price=$1,
           premium_unlock_price=$2,
           is_active=$3
       WHERE id=$4
       RETURNING *`,
      [
        Number(yearly_price),
        premium_unlock_price ? Number(premium_unlock_price) : null,
        is_active,
        id
      ]
    );

    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Update failed', 500);
  }
};