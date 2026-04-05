'use strict';

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Pool error:', err.message);
    });

    pool.on('connect', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log('[DB] Connected');
      }
    });
  }

  return pool;
}

async function query(text, params) {
  try {
    return await getPool().query(text, params);
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

async function getClient() {
  return getPool().connect();
}

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

async function testConnection() {
  try {
    await query('SELECT 1');
    console.log('[DB] OK');
    return true;
  } catch (err) {
    console.error('[DB] FAIL:', err.message);
    return false;
  }
}

module.exports = {
  query,
  getClient,
  withTransaction,
  testConnection,
  getPool
};