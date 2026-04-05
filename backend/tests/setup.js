// File: backend/tests/setup.js
'use strict';

// Load test environment
process.env.NODE_ENV = 'test';
process.env.SMS_PROVIDER = 'mock';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-64-chars-long-for-testing-purposes-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-64chars-for-testing-purposes-only-do-not-use';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.PORT = '3001';

require('dotenv').config({ path: '.env.test', override: false });
require('dotenv').config({ override: false });
