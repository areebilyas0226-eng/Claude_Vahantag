'use strict';

const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');

// ✅ HARD GUARD (prevents undefined crash)
const safe = (fn, name) => {
  if (typeof fn !== 'function') {
    console.error(`❌ Missing controller: ${name}`);
    return (req, res) => res.status(500).json({
      success: false,
      message: `Server misconfigured: ${name} missing`
    });
  }
  return fn;
};

// ─── ADMIN LOGIN ─────────────────────
router.post(
  '/admin/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  validate,
  safe(authController.adminLogin, 'adminLogin')
);

// ─── AGENT LOGIN ─────────────────────
router.post(
  '/agent/login',
  authLimiter,
  [
    body('generatedUserId').notEmpty().withMessage('User ID required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  validate,
  safe(authController.agentLogin, 'agentLogin')
);

// ─── AGENT OTP FLOW ─────────────────────
router.post(
  '/agent/request-otp',
  otpLimiter,
  [
    body('generatedUserId').notEmpty().withMessage('User ID required')
  ],
  validate,
  safe(authController.agentRequestOtp, 'agentRequestOtp')
);

router.post(
  '/agent/verify-otp-set-password',
  otpLimiter,
  [
    body('generatedUserId').notEmpty(),
    body('otp').isLength({ min: 6, max: 6 }),
    body('password').isLength({ min: 6 })
  ],
  validate,
  safe(authController.agentVerifyOtpAndSetPassword, 'agentVerifyOtpAndSetPassword')
);

// ─── USER OTP LOGIN FLOW ─────────────────────
router.post(
  '/user/request-otp',
  otpLimiter,
  [
    body('phone')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Valid Indian phone number required')
  ],
  validate,
  safe(authController.requestOtp, 'requestOtp')
);

router.post(
  '/user/verify-otp',
  otpLimiter,
  [
    body('phone')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Valid phone required'),
    body('otp')
      .isLength({ min: 6, max: 6 })
      .withMessage('OTP must be 6 digits')
  ],
  validate,
  safe(authController.verifyOtp, 'verifyOtp')
);

// ─── TOKEN REFRESH ─────────────────────
router.post(
  '/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token required')
  ],
  validate,
  safe(authController.refreshToken, 'refreshToken')
);

// ─── LOGOUT ─────────────────────
router.post(
  '/logout',
  authenticate,
  safe(authController.logout, 'logout')
);

module.exports = router;