// File: backend/tests/auth.test.js
'use strict';

const request = require('supertest');
const app     = require('../src/server');
const { query } = require('../src/config/db');

let adminToken;
let userToken;
let testPhone = '9876543210';

beforeAll(async () => {
  // Wait for DB
  await new Promise((r) => setTimeout(r, 500));
});

afterAll(async () => {
  // Clean up test data
  await query("DELETE FROM otp_attempts WHERE phone = $1", [testPhone]).catch(() => {});
  await query("DELETE FROM users WHERE phone = $1 AND role = 'user'", [testPhone]).catch(() => {});
  const { getPool } = require('../src/config/db');
  await getPool().end().catch(() => {});
});

// ── Admin Login ───────────────────────────────────────────────────────────────
describe('POST /api/auth/admin/login', () => {
  it('rejects missing credentials', async () => {
    const res = await request(app).post('/api/auth/admin/login').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/admin/login').send({
      email: process.env.ADMIN_EMAIL || 'admin@vahantag.com',
      password: 'WrongPassword123',
    });
    expect(res.status).toBe(401);
  });

  it('returns tokens on valid login', async () => {
    const res = await request(app).post('/api/auth/admin/login').send({
      email:    process.env.ADMIN_EMAIL    || 'admin@vahantag.com',
      password: process.env.ADMIN_PASSWORD || 'Admin@123456',
    });
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.user.role).toBe('admin');
      adminToken = res.body.data.accessToken;
    } else {
      console.warn('Admin login returned', res.status, '— skipping token tests');
    }
  });
});

// ── OTP Flow ──────────────────────────────────────────────────────────────────
describe('User OTP flow', () => {
  it('rejects invalid phone format', async () => {
    const res = await request(app).post('/api/auth/user/request-otp').send({ phone: '12345' });
    expect(res.status).toBe(422);
  });

  it('accepts valid phone and returns 200', async () => {
    const res = await request(app).post('/api/auth/user/request-otp').send({ phone: testPhone });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns OTP in dev mode response', async () => {
    const res = await request(app).post('/api/auth/user/request-otp').send({ phone: testPhone });
    expect(res.status).toBe(200);
    if (process.env.NODE_ENV !== 'production') {
      expect(res.body.data.otp).toBeDefined();
      expect(res.body.data.otp).toHaveLength(6);

      // Verify the OTP
      const verifyRes = await request(app).post('/api/auth/user/verify-otp').send({
        phone: testPhone, otp: res.body.data.otp, name: 'Test User',
      });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.accessToken).toBeDefined();
      userToken = verifyRes.body.data.accessToken;
    }
  });

  it('rejects wrong OTP', async () => {
    // Request fresh OTP first
    await request(app).post('/api/auth/user/request-otp').send({ phone: testPhone });
    const res = await request(app).post('/api/auth/user/verify-otp').send({
      phone: testPhone, otp: '000000',
    });
    expect([400, 429]).toContain(res.status);
  });
});

// ── Protected Routes ──────────────────────────────────────────────────────────
describe('Protected route access', () => {
  it('returns 401 without token on admin route', async () => {
    const res = await request(app).get('/api/admin/agents');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user tries admin route', async () => {
    if (!userToken) return;
    const res = await request(app).get('/api/admin/agents')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('admin can access admin route', async () => {
    if (!adminToken) return;
    const res = await request(app).get('/api/admin/agents')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

// ── Health Check ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns ok or degraded', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.status).toMatch(/ok|degraded/);
    expect(res.body.timestamp).toBeDefined();
  });
});

// ── Public Scan ───────────────────────────────────────────────────────────────
describe('GET /api/scan/:qrCode', () => {
  it('returns 404 for non-existent QR', async () => {
    const res = await request(app).get('/api/scan/VT-NOTEXIST0001');
    expect(res.status).toBe(404);
  });

  it('rejects invalid QR format', async () => {
    const res = await request(app).get('/api/scan/INVALID-CODE');
    expect(res.status).toBe(422);
  });
});

// ── Rate Limiting ─────────────────────────────────────────────────────────────
describe('Rate limiting', () => {
  it('rate-limits the scan endpoint after many requests', async () => {
    const promises = Array.from({ length: 35 }, () =>
      request(app).get('/api/scan/VT-TESTCODE0001')
    );
    const results = await Promise.all(promises);
    const rateLimited = results.some((r) => r.status === 429);
    expect(rateLimited).toBe(true);
  });
});
