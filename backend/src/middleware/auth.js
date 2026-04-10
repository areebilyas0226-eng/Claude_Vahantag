'use strict';

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { error } = require('../utils/response');

/**
 * Verify access token and attach user to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Access token required', 401);
    }

    const token = authHeader.slice(7);

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

    // 🔥 FINAL FIX: support all possible token structures
    const userId = decoded.userId || decoded.id || decoded._id;

    if (!userId) {
      return error(res, 'Invalid token payload (no userId)', 401);
    }

    // Fetch fresh user from DB
    const { rows } = await query(
      `SELECT id, role, name, email, phone, is_active, agent_id 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return error(res, 'Account not found or deactivated', 401);
    }

    // ✅ Attach user to request
    req.user = rows[0];

    // 🔍 DEBUG (remove later)
    console.log('✅ AUTH USER:', req.user);

    next();

  } catch (err) {
    console.error('❌ AUTH ERROR:', err);
    return error(res, 'Authentication failed', 500);
  }
}

/**
 * Role-based guard
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return error(res, 'Not authenticated', 401);

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

/**
 * Cron protection
 */
function requireCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'];

  if (!secret || secret !== process.env.CRON_SECRET) {
    return error(res, 'Unauthorized cron request', 401);
  }

  next();
}

module.exports = { authenticate, requireRole, requireCronSecret };