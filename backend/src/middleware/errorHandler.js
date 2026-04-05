// File: backend/src/middleware/errorHandler.js
'use strict';

const logger = require('../utils/logger');

/**
 * Global error handler middleware.
 * Must be the LAST middleware registered in Express.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  logger.error(`${req.method} ${req.originalUrl} — ${err.message}`, { stack: err.stack });

  // Validation errors from express-validator (handled upstream but catch here too)
  if (err.type === 'validation') {
    return res.status(422).json({ success: false, message: 'Validation failed', errors: err.errors });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate entry — this record already exists' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ success: false, message: 'Referenced resource not found' });
  }

  // Default
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message || 'Internal server error';

  return res.status(statusCode).json({ success: false, message });
}

/**
 * 404 handler — must be registered before the global error handler.
 */
function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

/**
 * Utility to create HTTP errors with a statusCode property.
 */
function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { errorHandler, notFound, createError };
