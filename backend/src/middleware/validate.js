// File: backend/src/middleware/validate.js
'use strict';

const { validationResult } = require('express-validator');
const { error } = require('../utils/response');

/**
 * Run express-validator result check.
 * Place AFTER all .check() calls in a route array.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return error(res, 'Validation failed', 422, result.array().map((e) => ({
      field: e.path,
      message: e.msg,
    })));
  }
  next();
}

module.exports = { validate };
