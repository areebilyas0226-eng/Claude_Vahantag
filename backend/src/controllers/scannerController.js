'use strict';

const { query } = require('../config/db');
const { success, error } = require('../utils/response');
const { sendSms, makeProxyCall } = require('../services/smsService');
const logger = require('../utils/logger');

function isExpired(date) {
  return date && new Date(date) < new Date();
}

// ─────────────────────────────────────────
// SCAN TAG
// ─────────────────────────────────────────
exports.scanTag = async (req, res) => {
  try {
    const { qrCode } = req.params;

    const { rows } = await query(
      `SELECT t.id, t.status, t.expires_at, t.is_active,
              tc.name AS category_name, tc.slug,
              ta.owner_name, ta.blood_group,
              ta.emergency_contact_name, ta.asset_data
       FROM tags t
       JOIN tag_categories tc ON tc.id = t.category_id
       LEFT JOIN tag_assets ta ON ta.tag_id = t.id
       WHERE t.qr_code = $1`,
      [qrCode]
    );

    if (!rows.length) return error(res, 'Tag not found', 404);

    const tag = rows[0];

    // log
    try {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
      await query(`INSERT INTO scan_logs (tag_id, scanner_ip) VALUES ($1, $2)`, [tag.id, ip]);
    } catch {}

    if (!tag.is_active) return error(res, 'Tag inactive', 403);

    if (tag.status === 'unassigned') {
      return success(res, { status: 'unassigned' });
    }

    if (isExpired(tag.expires_at)) {
      return success(res, { status: 'expired', canContact: false });
    }

    return success(res, {
      status: 'active',
      ownerName: tag.owner_name,
      category: tag.category_name
    });

  } catch (err) {
    logger.error(err);
    return error(res, 'Server error', 500);
  }
};