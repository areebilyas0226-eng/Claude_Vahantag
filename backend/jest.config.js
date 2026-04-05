// File: backend/jest.config.js
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: true,
};
