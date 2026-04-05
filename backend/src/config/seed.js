// File: backend/src/config/seed.js
'use strict';

require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, testConnection } = require('./db');

// ─────────────────────────────────────────────────────────────
// TAG CATEGORIES
// ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    name: 'Vehicle Tag',
    slug: 'vehicle',
    yearly_price: 299.00,
    premium_unlock_price: null,
    fields_schema: JSON.stringify([
      { key: 'vehicle_number', label: 'Vehicle Number', type: 'text', required: true },
      { key: 'vehicle_model', label: 'Vehicle Model', type: 'text', required: true },
      { key: 'vehicle_type', label: 'Vehicle Type', type: 'select', required: true,
        options: ['Car', 'Bike', 'Scooty', 'Truck', 'Auto-rickshaw', 'Other'] },
    ]),
    icon_url: null,
  },
  {
    name: 'Pet Tag',
    slug: 'pet',
    yearly_price: 349.00,
    premium_unlock_price: 199.00,
    fields_schema: JSON.stringify([
      { key: 'pet_name', label: 'Pet Name', type: 'text', required: true },
      { key: 'pet_type', label: 'Pet Type', type: 'select', required: true,
        options: ['Dog', 'Cat', 'Bird', 'Exotic', 'Other'] },
      { key: 'breed', label: 'Breed', type: 'text', required: false },
      { key: 'vet_contact', label: 'Vet Contact', type: 'text', required: false, premium: true },
    ]),
    icon_url: null,
  },
  {
    name: 'Phone Tag',
    slug: 'phone',
    yearly_price: 199.00,
    premium_unlock_price: null,
    fields_schema: JSON.stringify([
      { key: 'device_type', label: 'Device Type', type: 'select', required: true,
        options: ['Smartphone', 'Tablet', 'Laptop', 'Other'] },
      { key: 'device_imei', label: 'IMEI (optional)', type: 'text', required: false },
    ]),
    icon_url: null,
  },
];

// ─────────────────────────────────────────────────────────────
// SEED FUNCTION
// ─────────────────────────────────────────────────────────────
async function seed() {
  console.log('[SEED] Starting database seed...');

  const connected = await testConnection();
  if (!connected) {
    console.error('[SEED] Cannot connect to database. Aborting.');
    process.exit(1);
  }

  // ── Seed categories ─────────────────
  console.log('[SEED] Seeding categories...');
  for (const cat of CATEGORIES) {
    await query(
      `INSERT INTO tag_categories (name, slug, yearly_price, premium_unlock_price, fields_schema, icon_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         yearly_price = EXCLUDED.yearly_price,
         premium_unlock_price = EXCLUDED.premium_unlock_price,
         fields_schema = EXCLUDED.fields_schema`,
      [cat.name, cat.slug, cat.yearly_price, cat.premium_unlock_price, cat.fields_schema, cat.icon_url]
    );
    console.log(`  ✓ ${cat.name}`);
  }

  // ─────────────────────────────────────────
  // 🔥 ADMIN UPSERT (CRITICAL FIX)
  // ─────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@vahantag.com';
  const adminPass  = process.env.ADMIN_PASSWORD || '123456';
  const adminName  = process.env.ADMIN_NAME || 'Super Admin';
  const adminPhone = process.env.ADMIN_PHONE || '9999999999';

  const passwordHash = await bcrypt.hash(adminPass, 12);

  await query(
    `INSERT INTO users (role, name, email, phone, password_hash, is_active)
     VALUES ('admin', $1, $2, $3, $4, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       is_active = true`,
    [adminName, adminEmail, adminPhone, passwordHash]
  );

  console.log(`[SEED] ✓ Admin ensured: ${adminEmail}`);
  console.log(`[SEED] 🔑 Password: ${adminPass}`);

  console.log('[SEED] DONE ✅');
  process.exit(0);
}

// ─────────────────────────────────────────
seed().catch((err) => {
  console.error('[SEED] ERROR:', err);
  process.exit(1);
});