'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { sendOtp } = require('../services/smsService');

// ─── CLEAN INPUT ─────────────────────────
const clean = (v) => (typeof v === 'string' ? v.trim() : v);

// ─── TOKENS (🔥 STRICT + CONSISTENT) ─────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,        // ✅ ALWAYS id → userId (NO fallback ambiguity)
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user.id,        // ✅ SAME STRUCTURE
      role: user.role,
      tokenVersion: uuidv4()
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

async function storeRefreshToken(userId, token) {
  const hash = await bcrypt.hash(token, 10);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
    [userId, hash]
  );
}

// ─── ADMIN LOGIN ─────────────────────────

exports.adminLogin = async (req, res, next) => {
  try {
    let email = clean(req.body.email);
    const password = req.body.password;

    if (!email || !password) {
      return error(res, 'Email and password required', 400);
    }

    email = email.toLowerCase();

    const { rows } = await query(
      "SELECT * FROM users WHERE LOWER(email)=$1 AND role='admin'",
      [email]
    );

    if (!rows.length) {
      return error(res, 'Invalid credentials', 401);
    }

    const user = rows[0];

    if (!user.is_active) return error(res, 'Account disabled', 403);
    if (!user.password_hash) return error(res, 'Password not set', 403);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return error(res, 'Invalid credentials', 401);

    // 🔥 ENSURE CORRECT STRUCTURE
    const tokenUser = {
      id: user.id,
      role: 'admin'
    };

    const accessToken = generateAccessToken(tokenUser);
    const refreshToken = generateRefreshToken(tokenUser);

    await storeRefreshToken(user.id, refreshToken);

    return success(res, { accessToken, refreshToken });

  } catch (err) {
    console.error('🔥 ADMIN LOGIN ERROR:', err);
    next(err);
  }
};

// ─── AGENT LOGIN ─────────────────────────

exports.agentLogin = async (req, res, next) => {
  try {
    const generatedUserId = clean(req.body.generatedUserId);
    const password = req.body.password;

    if (!generatedUserId || !password) {
      return error(res, 'User ID and password required', 400);
    }

    const { rows } = await query(
      `SELECT u.*, a.id AS agent_id, a.is_active AS agent_active
       FROM agents a
       JOIN users u ON u.id = a.user_id
       WHERE a.generated_user_id = $1`,
      [generatedUserId]
    );

    if (!rows.length) return error(res, 'Invalid credentials', 401);

    const user = rows[0];

    if (!user.is_active || !user.agent_active) {
      return error(res, 'Account disabled', 403);
    }

    if (!user.password_hash) {
      return error(res, 'Set password using OTP first', 403);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return error(res, 'Invalid credentials', 401);

    const tokenUser = {
      id: user.id,
      role: 'agent'
    };

    const accessToken = generateAccessToken(tokenUser);
    const refreshToken = generateRefreshToken(tokenUser);

    await storeRefreshToken(user.id, refreshToken);

    return success(res, {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        role: 'agent',
        agentId: user.agent_id
      }
    });

  } catch (err) {
    console.error('🔥 AGENT LOGIN ERROR:', err);
    next(err);
  }
};

// ─── AGENT OTP REQUEST ─────────────────

exports.agentRequestOtp = async (req, res, next) => {
  try {
    const generatedUserId = clean(req.body.generatedUserId);

    if (!generatedUserId) return error(res, 'User ID required', 400);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hash = await bcrypt.hash(otp, 10);

    await query(
      `INSERT INTO otp_attempts (generated_user_id, otp_hash, expires_at, used)
       VALUES ($1,$2,NOW()+INTERVAL '10 minutes', false)`,
      [generatedUserId, hash]
    );

    console.log('📲 AGENT OTP:', otp);

    return success(res, {}, 'OTP sent');

  } catch (err) {
    next(err);
  }
};

// ─── AGENT VERIFY OTP ─────────────────

exports.agentVerifyOtpAndSetPassword = async (req, res, next) => {
  try {
    const generatedUserId = clean(req.body.generatedUserId);
    const otp = clean(req.body.otp);
    const password = req.body.password;

    if (!generatedUserId || !otp || !password) {
      return error(res, 'All fields required', 400);
    }

    const { rows } = await query(
      `SELECT * FROM otp_attempts
       WHERE generated_user_id=$1 AND used=false AND expires_at>NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [generatedUserId]
    );

    if (!rows.length) return error(res, 'OTP expired', 400);

    const otpRecord = rows[0];

    const valid = await bcrypt.compare(otp, otpRecord.otp_hash);
    if (!valid) return error(res, 'Invalid OTP', 400);

    await query(`UPDATE otp_attempts SET used=true WHERE id=$1`, [otpRecord.id]);

    const passwordHash = await bcrypt.hash(password, 10);

    await query(
      `UPDATE users
       SET password_hash=$1
       WHERE id = (SELECT user_id FROM agents WHERE generated_user_id=$2)`,
      [passwordHash, generatedUserId]
    );

    return success(res, {}, 'Password set successfully');

  } catch (err) {
    next(err);
  }
};

// ─── REFRESH TOKEN ─────────────────

exports.refreshToken = async (req, res) => {
  try {
    const token = req.body.refreshToken;

    if (!token) return error(res, 'Refresh token required', 400);

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const tokenUser = {
      id: decoded.userId,
      role: decoded.role
    };

    const accessToken = generateAccessToken(tokenUser);
    const newRefreshToken = generateRefreshToken(tokenUser);

    await storeRefreshToken(decoded.userId, newRefreshToken);

    return success(res, {
      accessToken,
      refreshToken: newRefreshToken
    });

  } catch (err) {
    return error(res, 'Invalid token', 401);
  }
};

// ─── LOGOUT ─────────────────

exports.logout = async (req, res) => {
  return success(res, {}, 'Logged out');
};