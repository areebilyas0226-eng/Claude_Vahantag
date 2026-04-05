// File: backend/src/config/db.js
'use strict';

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle client:', err.message);
    });

    pool.on('connect', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('[DB] New client connected to PostgreSQL');
      }
    });
  }
  return pool;
}

/**
 * Execute a parameterized query.
 * @param {string} text  SQL string with $1, $2 placeholders
 * @param {Array}  params Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB] Query executed', { text: text.slice(0, 80), duration, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', { text: text.slice(0, 80), error: err.message });
    throw err;
  }
}

/**
 * Get a dedicated client for transactions.
 * Always call client.release() in a finally block.
 */
async function getClient() {
  return getPool().connect();
}

/**
 * Run multiple queries inside a single transaction.
 * Automatically commits on success, rolls back on error.
 * @param {Function} fn  async (client) => result
 */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test database connectivity.
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW() AS now, version() AS version');
    console.log('[DB] Connected successfully:', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Connection test failed:', err.message);
    return false;
  }
}

module.exports = { query, getClient, withTransaction, testConnection, getPool };
