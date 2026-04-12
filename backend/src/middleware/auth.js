'use strict';

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { error } = require('../utils/response');

//
// ─────────────────────────────────────────
// AUTHENTICATE
// ─────────────────────────────────────────
//
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // ✅ STRICT CHECK
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Access token required', 401);
    }

    const token = authHeader.split(' ')[1]?.trim();

    if (!token) {
      return error(res, 'Invalid authorization format', 401);
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return error(
        res,
        jwtErr.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
        401
      );
    }

    // ✅ SUPPORT MULTIPLE TOKEN STRUCTURES
    const userId = decoded.userId || decoded.id || decoded._id;

    if (!userId) {
      return error(res, 'Invalid token payload', 401);
    }

    //
    // 🔥 FIX: PROPER JOIN WITH AGENT
    //
    const { rows } = await query(
      `
      SELECT 
        u.id,
        u.role,
        u.name,
        u.email,
        u.phone,
        u.is_active,
        a.id AS agent_id
      FROM users u
      LEFT JOIN agents a ON a.user_id = u.id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return error(res, 'Account not found or deactivated', 401);
    }

    // ✅ CLEAN USER OBJECT
    req.user = {
      id: rows[0].id,
      role: rows[0].role,
      name: rows[0].name,
      email: rows[0].email,
      phone: rows[0].phone,
      agent_id: rows[0].agent_id || null,
    };

    next();

  } catch (err) {
    console.error('❌ AUTH ERROR:', err);
    return error(res, 'Authentication failed', 500);
  }
}

//
// ─────────────────────────────────────────
// ROLE GUARD
// ─────────────────────────────────────────
//
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Not authenticated', 401);
    }

    if (!roles.includes(req.user.role)) {
      return error(
        res,
        `Access denied. Required role(s): ${roles.join(', ')}`,
        403
      );
    }

    next();
  };
}

//
// ─────────────────────────────────────────
// CRON SECURITY
// ─────────────────────────────────────────
//
function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'];

  if (!secret || secret !== process.env.CRON_SECRET) {
    return error(res, 'Unauthorized cron request', 401);
  }

  next();
}

module.exports = {
  authenticate,
  requireRole,
  requireCronSecret,
};