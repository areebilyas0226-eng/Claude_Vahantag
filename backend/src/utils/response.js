// File: backend/src/utils/response.js
'use strict';

/**
 * Send a standardised success response.
 */
function success(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * Send a standardised error response.
 */
function error(res, message = 'Internal Server Error', statusCode = 500, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

/**
 * Send a paginated response.
 */
function paginated(res, data, { total, page, limit }) {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
  });
}

module.exports = { success, error, paginated };
