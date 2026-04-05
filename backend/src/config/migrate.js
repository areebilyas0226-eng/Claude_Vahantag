// File: backend/src/config/migrate.js
'use strict';

require('dotenv').config();
const { query, testConnection } = require('./db');

const MIGRATIONS = [
  {
    name: '001_create_enums',
    sql: `
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'agent', 'user');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE tag_status AS ENUM ('unassigned', 'sold', 'active', 'expired', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE order_status AS ENUM ('pending', 'processing', 'fulfilled', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE contact_type AS ENUM ('call', 'message');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `,
  },
  {
    name: '002_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role            user_role NOT NULL DEFAULT 'user',
        name            VARCHAR(150) NOT NULL,
        email           VARCHAR(200) UNIQUE,
        phone           VARCHAR(15) UNIQUE NOT NULL,
        password_hash   TEXT,
        agent_id        UUID,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_phone  ON users (phone);
      CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_role   ON users (role);
    `,
  },
  {
    name: '003_create_agents',
    sql: `
      CREATE TABLE IF NOT EXISTS agents (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        business_name        VARCHAR(200) NOT NULL,
        address              TEXT,
        city                 VARCHAR(100),
        state                VARCHAR(100),
        pincode              VARCHAR(10),
        generated_user_id    VARCHAR(50) UNIQUE NOT NULL,
        created_by_admin     UUID NOT NULL REFERENCES users(id),
        is_active            BOOLEAN NOT NULL DEFAULT true,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents (user_id);
      CREATE INDEX IF NOT EXISTS idx_agents_generated_user_id ON agents (generated_user_id);
    `,
  },
  {
    name: '004_create_tag_categories',
    sql: `
      CREATE TABLE IF NOT EXISTS tag_categories (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                  VARCHAR(100) NOT NULL,
        slug                  VARCHAR(50) UNIQUE NOT NULL,
        yearly_price          DECIMAL(10,2) NOT NULL DEFAULT 299.00,
        premium_unlock_price  DECIMAL(10,2),
        is_active             BOOLEAN NOT NULL DEFAULT true,
        icon_url              TEXT,
        fields_schema         JSONB NOT NULL DEFAULT '[]',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tag_categories_slug ON tag_categories (slug);
    `,
  },
  {
    name: '005_create_tag_orders',
    sql: `
      CREATE TABLE IF NOT EXISTS tag_orders (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id        UUID NOT NULL REFERENCES agents(id),
        category_id     UUID NOT NULL REFERENCES tag_categories(id),
        qty_ordered     INT NOT NULL CHECK (qty_ordered > 0),
        qty_generated   INT NOT NULL DEFAULT 0,
        status          order_status NOT NULL DEFAULT 'pending',
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fulfilled_at    TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tag_orders_agent_id    ON tag_orders (agent_id);
      CREATE INDEX IF NOT EXISTS idx_tag_orders_status      ON tag_orders (status);
      CREATE INDEX IF NOT EXISTS idx_tag_orders_created_at  ON tag_orders (created_at DESC);
    `,
  },
  {
    name: '006_create_tags',
    sql: `
      CREATE TABLE IF NOT EXISTS tags (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        qr_code               VARCHAR(100) UNIQUE NOT NULL,
        category_id           UUID NOT NULL REFERENCES tag_categories(id),
        agent_id              UUID NOT NULL REFERENCES agents(id),
        order_id              UUID REFERENCES tag_orders(id),
        status                tag_status NOT NULL DEFAULT 'unassigned',
        user_id               UUID REFERENCES users(id),
        activated_at          TIMESTAMPTZ,
        expires_at            TIMESTAMPTZ,
        renewed_count         INT NOT NULL DEFAULT 0,
        is_premium_unlocked   BOOLEAN NOT NULL DEFAULT false,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tags_qr_code      ON tags (qr_code);
      CREATE INDEX IF NOT EXISTS idx_tags_agent_id     ON tags (agent_id);
      CREATE INDEX IF NOT EXISTS idx_tags_user_id      ON tags (user_id);
      CREATE INDEX IF NOT EXISTS idx_tags_status       ON tags (status);
      CREATE INDEX IF NOT EXISTS idx_tags_expires_at   ON tags (expires_at);
      CREATE INDEX IF NOT EXISTS idx_tags_category_id  ON tags (category_id);
    `,
  },
  {
    name: '007_create_tag_assets',
    sql: `
      CREATE TABLE IF NOT EXISTS tag_assets (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id                   UUID UNIQUE NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        owner_name               VARCHAR(150) NOT NULL,
        owner_phone              VARCHAR(15) NOT NULL,
        owner_alt_phone          VARCHAR(15),
        blood_group              VARCHAR(5),
        emergency_contact_name   VARCHAR(150),
        emergency_contact_phone  VARCHAR(15),
        asset_data               JSONB NOT NULL DEFAULT '{}',
        documents                JSONB NOT NULL DEFAULT '[]',
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tag_assets_tag_id ON tag_assets (tag_id);
    `,
  },
  {
    name: '008_create_subscriptions',
    sql: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id                   UUID NOT NULL REFERENCES tags(id),
        user_id                  UUID NOT NULL REFERENCES users(id),
        plan_price               DECIMAL(10,2) NOT NULL,
        paid_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_from               TIMESTAMPTZ NOT NULL,
        valid_until              TIMESTAMPTZ NOT NULL,
        payment_method           VARCHAR(50) NOT NULL DEFAULT 'cash',
        payment_ref              VARCHAR(200),
        renewal_reminder_sent    BOOLEAN NOT NULL DEFAULT false,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_subscriptions_tag_id          ON subscriptions (tag_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id         ON subscriptions (user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_valid_until     ON subscriptions (valid_until);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_reminder_sent   ON subscriptions (renewal_reminder_sent);
    `,
  },
  {
    name: '009_create_scan_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS scan_logs (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id           UUID NOT NULL REFERENCES tags(id),
        scanner_ip       VARCHAR(50),
        scanner_phone    VARCHAR(15),
        contact_type     contact_type,
        message_text     TEXT,
        scanned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_scan_logs_tag_id      ON scan_logs (tag_id);
      CREATE INDEX IF NOT EXISTS idx_scan_logs_scanned_at  ON scan_logs (scanned_at DESC);
    `,
  },
  {
    name: '010_create_otp_attempts',
    sql: `
      CREATE TABLE IF NOT EXISTS otp_attempts (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone        VARCHAR(15) NOT NULL,
        otp_hash     TEXT NOT NULL,
        attempts     INT NOT NULL DEFAULT 0,
        expires_at   TIMESTAMPTZ NOT NULL,
        used         BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_otp_phone       ON otp_attempts (phone);
      CREATE INDEX IF NOT EXISTS idx_otp_expires_at  ON otp_attempts (expires_at);
    `,
  },
  {
    name: '011_create_refresh_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL,
        expires_at   TIMESTAMPTZ NOT NULL,
        revoked      BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens (user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked    ON refresh_tokens (revoked);
    `,
  },
  {
    name: '012_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) UNIQUE NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: '013_updated_at_triggers',
    sql: `
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DO $$ DECLARE t TEXT;
      BEGIN
        FOREACH t IN ARRAY ARRAY['users','agents','tag_categories','tag_orders','tags','tag_assets']
        LOOP
          EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
             CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t, t
          );
        END LOOP;
      END $$;
    `,
  },
];

async function runMigrations() {
  console.log('[MIGRATE] Starting database migrations...');

  const connected = await testConnection();
  if (!connected) {
    console.error('[MIGRATE] Cannot connect to database. Aborting.');
    process.exit(1);
  }

  // Ensure migrations table exists first
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows: applied } = await query('SELECT name FROM schema_migrations');
  const appliedNames = new Set(applied.map((r) => r.name));

  let ran = 0;
  for (const migration of MIGRATIONS) {
    if (appliedNames.has(migration.name)) {
      console.log(`[MIGRATE] Skipping (already applied): ${migration.name}`);
      continue;
    }
    try {
      await query(migration.sql);
      await query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      console.log(`[MIGRATE] Applied: ${migration.name}`);
      ran++;
    } catch (err) {
      console.error(`[MIGRATE] Failed on ${migration.name}:`, err.message);
      process.exit(1);
    }
  }

  if (ran === 0) {
    console.log('[MIGRATE] All migrations already applied. Database is up to date.');
  } else {
    console.log(`[MIGRATE] Done. Applied ${ran} migration(s).`);
  }
  process.exit(0);
}

runMigrations();
