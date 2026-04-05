// File: backend/src/middleware/rateLimiter.js
'use strict';

const rateLimit = require('express-rate-limit');

/** General API rate limiter */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

/** Stricter limiter for OTP endpoints */
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX || '5', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Please wait 10 minutes.' },
  keyGenerator: (req) => req.body.phone || req.ip,
});

/** Auth endpoint limiter */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
});

/** Public scan endpoint limiter */
const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Scan rate limit exceeded.' },
});

module.exports = { apiLimiter, otpLimiter, authLimiter, scanLimiter };
