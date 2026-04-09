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
// 📊 ANALYTICS
// ─────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    const revenueRes = await query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`);
    const scans = await query(`SELECT COUNT(*) AS total FROM scans`);
    const tags = await query(`SELECT COUNT(*) AS total FROM tags`);

    const agents = await query(`
      SELECT COUNT(*) AS total
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE COALESCE(u.is_active,true) = true
    `);

    return success(res, {
      revenue: Number(revenueRes.rows[0]?.total || 0),
      totalScans: Number(scans.rows[0]?.total || 0),
      totalTags: Number(tags.rows[0]?.total || 0),
      activeAgents: Number(agents.rows[0]?.total || 0),
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Analytics failed', 500);
  }
};

// ─────────────────────────────
// CREATE AGENT (FINAL)
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

    const adminId = req.user?.id || null;

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
        [name, phone, hash]
      );

      const userId = userRows[0].id;

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents (
          user_id,
          business_name,
          generated_user_id,
          created_by_admin
        )
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [
          userId,
          businessName,
          String(userId),
          adminId
        ]
      );

      return { agent: agentRows[0], userId };
    });

    sendSms(phone, `Password: ${tempPassword}`).catch(() => {});

    return success(res, {
      agent: result.agent,
      tempPassword,
      loginId: String(result.userId) // ✅ FIXED
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
    const { status, limit = 100 } = req.query;
    const safeLimit = Math.min(Number(limit) || 100, 500);

    let sql = `SELECT * FROM tags`;
    let params = [];

    if (status) {
      sql += ` WHERE status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;

    const { rows } = await query(sql, params);
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

// ───────── AGENT DETAIL FIX ─────────
exports.getAgentDetail = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        a.id,
        u.name,
        u.phone,
        a.business_name,
        u.is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = $1
    `, [req.params.id]);

    if (!rows.length) return error(res, 'Agent not found', 404);

    return success(res, rows[0]);

  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ───────── CATEGORIES ─────────
exports.getCategories = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT * FROM categories ORDER BY id DESC
    `);
    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, activation_price, subscription_price } = req.body;

    const { rows } = await query(`
      INSERT INTO categories (name, activation_price, subscription_price, is_active)
      VALUES ($1,$2,$3,true)
      RETURNING *
    `, [name, activation_price, subscription_price]);

    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Create failed', 500);
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { activation_price, subscription_price, is_active } = req.body;

    const { rows } = await query(`
      UPDATE categories
      SET activation_price=$1,
          subscription_price=$2,
          is_active=$3
      WHERE id=$4
      RETURNING *
    `, [activation_price, subscription_price, is_active, req.params.id]);

    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Update failed', 500);
  }
};