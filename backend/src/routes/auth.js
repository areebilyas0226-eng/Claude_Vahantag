'use strict';

const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { otpLimiter, authLimiter } = require('../middleware/rateLimiter');

// ─── ADMIN LOGIN ─────────────────────
router.post(
  '/admin/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  validate,
  authController.adminLogin
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
  authController.agentLogin
);

// ─── AGENT OTP FLOW (✅ CORRECT)
router.post(
  '/agent/request-otp',
  otpLimiter,
  [
    body('generatedUserId').notEmpty().withMessage('User ID required')
  ],
  validate,
  authController.agentRequestOtp
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
  authController.agentVerifyOtpAndSetPassword
);

// ─── TOKEN REFRESH ─────────────────────
router.post(
  '/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token required')
  ],
  validate,
  authController.refreshToken
);

// ─── LOGOUT ─────────────────────
router.post(
  '/logout',
  authenticate,
  authController.logout
);

module.exports = router;