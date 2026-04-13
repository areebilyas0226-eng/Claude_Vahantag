'use strict';

const bcrypt = require('bcrypt');
const { customAlphabet } = require('nanoid');
const { query, withTransaction } = require('../config/db');
const { success, error } = require('../utils/response');
const { sendSms } = require('../services/smsService');
const logger = require('../utils/logger');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);
const SALT_ROUNDS = 10;

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');
const clean = (v) => (v && String(v).trim() ? String(v).trim() : null);

// ─── helper: get real column names from a table ──────────────────────────────
const getColumns = async (table) => {
  try {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    return rows.map((r) => r.column_name);
  } catch {
    return [];
  }
};

// ───────── ANALYTICS ─────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res) => {
  try {
    // Detect active tag status value from real data
    const statusCheck = await query(
      `SELECT DISTINCT status FROM tags LIMIT 20`
    );
    const statuses = statusCheck.rows.map((r) => r.status);
    logger.info('TAG STATUSES IN DB:', statuses);

    // Try both 'active' and 'Active' and '1'
    const activeStatus = statuses.find((s) =>
      ['active', 'Active', 'ACTIVE', '1', 'enabled'].includes(s)
    ) || 'active';

    const expiredStatus = statuses.find((s) =>
      ['expired', 'Expired', 'EXPIRED', '0', 'inactive'].includes(s)
    ) || 'expired';

    const [revenueRes, scans, totalTags, activeTags, expiredTags, agents, orders, pendingOrders] =
      await Promise.all([
        query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments`).catch(() => ({ rows: [{ total: 0 }] })),
        query(`SELECT COUNT(*) AS total FROM scans`).catch(() => ({ rows: [{ total: 0 }] })),
        query(`SELECT COUNT(*) AS count FROM tags`),
        query(`SELECT COUNT(*) AS count FROM tags WHERE status = $1`, [activeStatus]),
        query(`SELECT COUNT(*) AS count FROM tags WHERE status = $1`, [expiredStatus]),
        query(`SELECT COUNT(*) AS count FROM agents`),
        query(`SELECT COUNT(*) AS count FROM tag_orders`),
        query(`SELECT COUNT(*) AS count FROM tag_orders WHERE status = 'pending'`).catch(() => ({ rows: [{ count: 0 }] })),
      ]);

    const data = {
      revenue:       Number(revenueRes.rows[0]?.total   || 0),
      totalScans:    Number(scans.rows[0]?.total        || 0),
      totalTags:     Number(totalTags.rows[0]?.count    || 0),
      activeTags:    Number(activeTags.rows[0]?.count   || 0),
      expiredTags:   Number(expiredTags.rows[0]?.count  || 0),
      activeAgents:  Number(agents.rows[0]?.count       || 0),
      totalOrders:   Number(orders.rows[0]?.count       || 0),
      pendingOrders: Number(pendingOrders.rows[0]?.count || 0),
    };

    logger.info('RAW ANALYTICS:', data);
    return success(res, data);
  } catch (err) {
    logger.error('Analytics error:', err.message, err.stack);
    return error(res, 'Analytics failed', 500);
  }
};

// ───────── CREATE AGENT ──────────────────────────────────────────────────────
exports.createAgent = async (req, res) => {
  try {
    let { name, phone, businessName, city, state, address, ownerName } = req.body;

    if (!name || !phone || !businessName)
      return error(res, 'Name, Phone, Business Name required', 400);

    const adminId = req.user?.id;
    if (!adminId) return error(res, 'Unauthorized', 401);

    phone = normalizePhone(phone);
    const tempPassword = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const result = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        `SELECT id FROM users WHERE phone=$1`, [phone]
      );
      if (existing.length) throw { message: 'Phone already exists', statusCode: 409 };

      const { rows: userRows } = await client.query(
        `INSERT INTO users (name, phone, password_hash, role, is_active)
         VALUES ($1,$2,$3,'agent',true) RETURNING id`,
        [clean(name), phone, hash]
      );
      const userId = userRows[0].id;

      const { rows: agentRows } = await client.query(
        `INSERT INTO agents (
           user_id, business_name, owner_name,
           city, state, address, generated_user_id, created_by_admin
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [userId, clean(businessName), clean(ownerName),
         clean(city), clean(state), clean(address), userId, adminId]
      );
      return { agent: agentRows[0], userId };
    });

    sendSms(phone, `Login ID: ${result.userId} Password: ${tempPassword}`).catch(() => {});

    return success(res, {
      agent: result.agent,
      loginId: result.agent.generated_user_id,
      tempPassword,
    });
  } catch (err) {
    logger.error(err);
    return error(res, err.message || 'Failed', err.statusCode || 500);
  }
};

// ───────── LIST AGENTS ────────────────────────────────────────────────────────
exports.listAgents = async (req, res) => {
  try {
    // Check if agents table has city/state columns
    const cols = await getColumns('agents');
    logger.info('agents columns:', cols);

    const cityCol   = cols.includes('city')  ? 'a.city'  : 'NULL';
    const stateCol  = cols.includes('state') ? 'a.state' : 'NULL';
    const phoneCol  = cols.includes('phone') ? 'u.phone' : 'NULL';

    const { rows } = await query(`
      SELECT
        a.id,
        a.user_id,
        u.name,
        ${phoneCol}  AS phone,
        a.business_name,
        ${cityCol}   AS city,
        ${stateCol}  AS state,
        COALESCE(u.is_active, true) AS is_active,
        (
          SELECT COUNT(*) FROM tag_orders o
          WHERE o.agent_id = a.id AND o.status = 'pending'
        )::int AS active_order_count
      FROM agents a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC
    `);

    logger.info('Agents API response:', JSON.stringify(rows[0] || {}));
    return success(res, rows);
  } catch (err) {
    logger.error('listAgents error:', err.message, err.stack);
    return error(res, 'Failed to fetch agents', 500);
  }
};

// ───────── AGENT DETAIL ───────────────────────────────────────────────────────
exports.getAgentDetail = async (req, res) => {
  try {
    const agentParam = req.params.id;
    logger.info('Agent ID:', agentParam);

    // Introspect columns
    const agentCols = await getColumns('agents');
    const tagCols   = await getColumns('tags');
    logger.info('agent cols:', agentCols);
    logger.info('tag cols:', tagCols);

    // Find agent — support lookup by user_id OR agent.id
    const { rows: agentRows } = await query(`
      SELECT a.*, u.name, u.phone, u.email, u.is_active
      FROM agents a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id::text = $1 OR a.id::text = $1
      LIMIT 1
    `, [agentParam]);

    if (!agentRows.length) return error(res, 'Agent not found', 404);
    const agent = agentRows[0];
    const agentId = agent.id;

    // ── Orders ───────────────────────────────────────────────────────────────
    let orders = [];
    try {
      const orderCols = await getColumns('tag_orders');
      const qtyCol = orderCols.includes('qty_ordered')
        ? 'o.qty_ordered'
        : orderCols.includes('qty')
        ? 'o.qty'
        : orderCols.includes('quantity')
        ? 'o.quantity'
        : '0';

      const qtyGenCol = orderCols.includes('qty_generated') ? 'o.qty_generated' : '0';
      const catJoin   = orderCols.includes('category_id')
        ? `LEFT JOIN tag_categories tc ON tc.id = o.category_id`
        : '';
      const catName   = orderCols.includes('category_id') ? `tc.name AS category_name,` : `NULL AS category_name,`;

      const { rows } = await query(`
        SELECT
          o.id,
          o.status,
          o.created_at,
          ${catName}
          COALESCE(${qtyCol}, 0)    AS qty_ordered,
          COALESCE(${qtyGenCol}, 0) AS qty_generated
        FROM tag_orders o
        ${catJoin}
        WHERE o.agent_id = $1
        ORDER BY o.created_at DESC
      `, [agentId]);
      orders = rows;
    } catch (e) {
      logger.error('Orders sub-query failed:', e.message);
    }

    // ── Tags ─────────────────────────────────────────────────────────────────
    let tags = [];
    try {
      const hasAgentId  = tagCols.includes('agent_id');
      const hasOwnerId  = tagCols.includes('owner_id');
      const hasCatId    = tagCols.includes('category_id');
      const hasActivated = tagCols.includes('activated_at');
      const hasExpires  = tagCols.includes('expires_at');

      if (hasAgentId) {
        const { rows } = await query(`
          SELECT
            t.id,
            t.qr_code,
            t.status,
            ${hasActivated ? 't.activated_at,' : 'NULL AS activated_at,'}
            ${hasExpires   ? 't.expires_at,'   : 'NULL AS expires_at,'}
            ${hasCatId     ? 'tc.name AS category_name,' : 'NULL AS category_name,'}
            ${hasOwnerId   ? 'u.name AS owner_name'     : 'NULL AS owner_name'}
          FROM tags t
          ${hasCatId   ? 'LEFT JOIN tag_categories tc ON tc.id = t.category_id' : ''}
          ${hasOwnerId ? 'LEFT JOIN users u ON u.id = t.owner_id' : ''}
          WHERE t.agent_id = $1
          ORDER BY t.id DESC
          LIMIT 50
        `, [agentId]);
        tags = rows;
      }
    } catch (e) {
      logger.error('Tags sub-query failed:', e.message);
    }

    // ── Subscription ──────────────────────────────────────────────────────────
    let subscription = null;
    try {
      const subCols = await getColumns('subscriptions');
      if (subCols.length) {
        const hasAgentId = subCols.includes('agent_id');
        const col = hasAgentId ? 'agent_id' : 'user_id';
        const val = hasAgentId ? agentId : agent.user_id;

        const { rows: subRows } = await query(`
          SELECT s.id, s.status, s.expires_at
          FROM subscriptions s
          WHERE s.${col} = $1 AND s.status = 'active'
          ORDER BY s.expires_at DESC
          LIMIT 1
        `, [val]);
        subscription = subRows[0] || null;
      }
    } catch (e) {
      logger.error('Subscription sub-query failed:', e.message);
    }

    return success(res, { ...agent, orders, tags, subscription });
  } catch (err) {
    logger.error('getAgentDetail error:', err.message, err.stack);
    return error(res, 'Failed', 500);
  }
};

// ───────── GET ORDERS ─────────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;

    const orderCols = await getColumns('tag_orders');
    const qtyCol    = orderCols.includes('qty_ordered') ? 'o.qty_ordered'
                    : orderCols.includes('qty')         ? 'o.qty'
                    : orderCols.includes('quantity')    ? 'o.quantity'
                    : '0';
    const qtyGenCol = orderCols.includes('qty_generated') ? 'o.qty_generated' : '0';
    const hasCatId  = orderCols.includes('category_id');
    const hasNotes  = orderCols.includes('notes');

    const params = [];
    let where = '';

    if (status) {
      params.push(status);
      where = `WHERE o.status = $${params.length}`;
    }

    params.push(Number(limit));

    const { rows } = await query(`
      SELECT
        o.id,
        o.status,
        o.created_at,
        COALESCE(${qtyCol}, 0)    AS qty_ordered,
        COALESCE(${qtyGenCol}, 0) AS qty_generated,
        ${hasNotes  ? 'o.notes,'                                              : 'NULL AS notes,'}
        ${hasCatId  ? 'tc.name AS category_name,'                             : 'NULL AS category_name,'}
        a.business_name
      FROM tag_orders o
      JOIN agents a ON a.id = o.agent_id
      ${hasCatId ? 'LEFT JOIN tag_categories tc ON tc.id = o.category_id' : ''}
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${params.length}
    `, params);

    return success(res, rows);
  } catch (err) {
    logger.error('getOrders error:', err.message, err.stack);
    return error(res, 'Failed to fetch orders', 500);
  }
};

// ───────── GENERATE TAGS ─────────────────────────────────────────────────────
exports.generateTags = async (req, res) => {
  try {
    const orderId = req.params.id;

    const { rows: orderRows } = await query(
      `SELECT * FROM tag_orders WHERE id = $1`, [orderId]
    );
    if (!orderRows.length) return error(res, 'Order not found', 404);

    const order = orderRows[0];
    if (order.status !== 'pending')
      return error(res, `Order is already ${order.status}`, 400);

    const qty = Number(order.qty_ordered || order.qty || order.quantity || 0);
    if (!qty) return error(res, 'Order has no quantity', 400);

    // Detect tags table columns
    const tagCols    = await getColumns('tags');
    const hasAgentId = tagCols.includes('agent_id');
    const hasCatId   = tagCols.includes('category_id');
    const hasOrderId = tagCols.includes('order_id');

    const generated = await withTransaction(async (client) => {
      let count = 0;
      for (let i = 0; i < qty; i++) {
        const qrCode = `VT-${nanoid()}`;

        // Build dynamic insert
        const colNames = ['qr_code', 'status'];
        const values   = [qrCode, 'unassigned'];

        if (hasAgentId) { colNames.push('agent_id');   values.push(order.agent_id); }
        if (hasCatId)   { colNames.push('category_id'); values.push(order.category_id); }
        if (hasOrderId) { colNames.push('order_id');    values.push(orderId); }

        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        await client.query(
          `INSERT INTO tags (${colNames.join(', ')}) VALUES (${placeholders})`,
          values
        );
        count++;
      }

      const orderCols = await getColumns('tag_orders');
      const qtyGenCol = orderCols.includes('qty_generated') ? 'qty_generated = $1,' : '';

      await client.query(
        `UPDATE tag_orders SET ${qtyGenCol} status = $2 WHERE id = $3`,
        qtyGenCol ? [qty, 'fulfilled', orderId] : ['fulfilled', orderId]
      );

      return count;
    });

    return success(res, { generated, orderId });
  } catch (err) {
    logger.error('generateTags error:', err.message, err.stack);
    return error(res, err.message || 'Generate failed', 500);
  }
};

// ───────── GET TAGS ──────────────────────────────────────────────────────────
exports.getTags = async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    const tagCols    = await getColumns('tags');
    const hasCatId   = tagCols.includes('category_id');
    const hasOwnerId = tagCols.includes('owner_id');
    const hasAgentId = tagCols.includes('agent_id');
    const hasActivated = tagCols.includes('activated_at');
    const hasExpires = tagCols.includes('expires_at');

    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      conditions.push(`t.qr_code ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) AS count FROM tags t ${where}`, params);
    const total = Number(countRes.rows[0]?.count || 0);

    params.push(Number(limit), Number(offset));

    const { rows } = await query(`
      SELECT
        t.id,
        t.qr_code,
        t.status,
        ${hasActivated ? 't.activated_at,' : 'NULL AS activated_at,'}
        ${hasExpires   ? 't.expires_at,'   : 'NULL AS expires_at,'}
        ${hasCatId     ? 'tc.name AS category_name,' : 'NULL AS category_name,'}
        ${hasAgentId   ? 'a.business_name,' : 'NULL AS business_name,'}
        ${hasOwnerId   ? 'u.name AS owner_name' : 'NULL AS owner_name'}
      FROM tags t
      ${hasCatId   ? 'LEFT JOIN tag_categories tc ON tc.id = t.category_id' : ''}
      ${hasAgentId ? 'LEFT JOIN agents a ON a.id = t.agent_id'              : ''}
      ${hasOwnerId ? 'LEFT JOIN users u ON u.id = t.owner_id'               : ''}
      ${where}
      ORDER BY t.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return res.json({
      success: true,
      data: rows,
      pagination: { total, limit: Number(limit), offset: Number(offset) },
    });
  } catch (err) {
    logger.error('getTags error:', err.message, err.stack);
    return error(res, 'Failed to fetch tags', 500);
  }
};

// ───────── RESET PASSWORD ────────────────────────────────────────────────────
exports.resetAgentPassword = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT user_id FROM agents WHERE user_id::text = $1 OR id::text = $1`,
      [req.params.id]
    );
    if (!rows.length) return error(res, 'Not found', 404);

    const newPass = `Vahan@${nanoid().slice(0, 6)}`;
    const hash = await bcrypt.hash(newPass, SALT_ROUNDS);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rows[0].user_id]);

    return success(res, { newPass });
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed', 500);
  }
};

// ───────── CATEGORIES ────────────────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const cols = await getColumns('tag_categories');
    logger.info('tag_categories cols:', cols);

    const hasIsActive     = cols.includes('is_active');
    const hasPremiumPrice = cols.includes('premium_unlock_price');
    const hasYearly       = cols.includes('yearly_price');

    const { rows } = await query(`
      SELECT
        id,
        name,
        ${hasYearly       ? 'yearly_price,'          : '0 AS yearly_price,'}
        ${hasPremiumPrice ? 'premium_unlock_price,'   : 'NULL AS premium_unlock_price,'}
        ${hasIsActive     ? 'is_active,'              : 'true AS is_active,'}
        created_at
      FROM tag_categories
      ORDER BY created_at DESC
    `);
    return success(res, rows);
  } catch (err) {
    logger.error('getCategories error:', err.message, err.stack);
    return error(res, 'Failed', 500);
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, yearly_price, yearlyPrice } = req.body;
    const price = yearly_price ?? yearlyPrice;
    if (!name || !price) return error(res, 'Name & price required', 400);

    const cols          = await getColumns('tag_categories');
    const hasIsActive   = cols.includes('is_active');

    const { rows } = await query(
      `INSERT INTO tag_categories (name, yearly_price ${hasIsActive ? ', is_active' : ''})
       VALUES ($1, $2 ${hasIsActive ? ', true' : ''}) RETURNING *`,
      [name.trim(), Number(price)]
    );
    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Create failed', 500);
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { yearly_price, yearlyPrice, isActive } = req.body;
    const price = yearly_price ?? yearlyPrice;

    const cols        = await getColumns('tag_categories');
    const hasIsActive = cols.includes('is_active');

    const fields = [];
    const params = [];

    if (price !== undefined) {
      params.push(Number(price));
      fields.push(`yearly_price = $${params.length}`);
    }
    if (isActive !== undefined && hasIsActive) {
      params.push(Boolean(isActive));
      fields.push(`is_active = $${params.length}`);
    }

    if (!fields.length) return error(res, 'Nothing to update', 400);

    params.push(id);
    const { rows } = await query(
      `UPDATE tag_categories SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return error(res, 'Category not found', 404);
    return success(res, rows[0]);
  } catch (err) {
    logger.error(err);
    return error(res, 'Update failed', 500);
  }
};

// ───────── SUBSCRIPTIONS ─────────────────────────────────────────────────────
exports.getSubscriptions = async (req, res) => {
  try {
    const { status = 'active', limit = 100 } = req.query;

    const subCols    = await getColumns('subscriptions');
    logger.info('subscriptions cols:', subCols);

    if (!subCols.length) {
      // Table doesn't exist — try from tags table instead
      const { rows } = await query(`
        SELECT
          t.id,
          t.qr_code,
          t.status,
          t.expires_at,
          tc.name AS category_name,
          a.business_name,
          u.name  AS owner_name
        FROM tags t
        LEFT JOIN tag_categories tc ON tc.id = t.category_id
        LEFT JOIN agents a          ON a.id  = t.agent_id
        LEFT JOIN users u           ON u.id  = t.owner_id
        WHERE t.status = $1
        ORDER BY t.expires_at ASC
        LIMIT $2
      `, [status, Number(limit)]);
      return success(res, rows);
    }

    const hasTagId    = subCols.includes('tag_id');
    const hasAgentId  = subCols.includes('agent_id');
    const hasCatId    = subCols.includes('category_id');
    const hasUserId   = subCols.includes('user_id');

    const { rows } = await query(`
      SELECT
        s.id,
        s.status,
        s.expires_at,
        ${hasTagId   ? 't.qr_code,'             : 'NULL AS qr_code,'}
        ${hasCatId   ? 'tc.name AS category_name,' : 'NULL AS category_name,'}
        ${hasAgentId ? 'a.business_name,'        : 'NULL AS business_name,'}
        ${hasUserId  ? 'u.name AS owner_name'    : 'NULL AS owner_name'}
      FROM subscriptions s
      ${hasTagId   ? 'LEFT JOIN tags t            ON t.id  = s.tag_id'        : ''}
      ${hasCatId   ? 'LEFT JOIN tag_categories tc ON tc.id = s.category_id'   : ''}
      ${hasAgentId ? 'LEFT JOIN agents a          ON a.id  = s.agent_id'      : ''}
      ${hasUserId  ? 'LEFT JOIN users u           ON u.id  = s.user_id'       : ''}
      WHERE s.status = $1
      ORDER BY s.expires_at ASC
      LIMIT $2
    `, [status, Number(limit)]);

    return success(res, rows);
  } catch (err) {
    logger.error('getSubscriptions error:', err.message, err.stack);
    return error(res, 'Failed to fetch subscriptions', 500);
  }
};

// ───────── USERS ─────────────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const cols     = await getColumns('users');
    const hasEmail = cols.includes('email');
    const hasRole  = cols.includes('role');

    const where = hasRole ? `WHERE role = 'user'` : '';

    const { rows } = await query(`
      SELECT
        id,
        name,
        phone,
        ${hasEmail ? 'email,' : 'NULL AS email,'}
        is_active,
        created_at
      FROM users
      ${where}
      ORDER BY created_at DESC
      LIMIT $1
    `, [Number(limit)]);

    return success(res, rows);
  } catch (err) {
    logger.error(err);
    return error(res, 'Failed to fetch users', 500);
  }
};
// ───────── DOWNLOAD TAGS PDF ─────────────────────────────────────────────────
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

exports.downloadTagsPdf = async (req, res) => {
  try {
    const { orderId } = req.params;

    // 1. Verify order exists
    const { rows: orderRows } = await query(
      `SELECT * FROM tag_orders WHERE id = $1`,
      [orderId]
    );
    if (!orderRows.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 2. Fetch all tags for this order
    const { rows: tags } = await query(
      `SELECT id, qr_code, status FROM tags WHERE order_id = $1 ORDER BY id ASC`,
      [orderId]
    );
    if (!tags.length) {
      return res.status(404).json({ success: false, message: 'No tags found for this order' });
    }

    // 3. Build PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=tags-${orderId}.pdf`);
    doc.pipe(res);

    for (let i = 0; i < tags.length; i++) {
      if (i > 0) doc.addPage();

      const tag = tags[i];

      // Generate QR buffer from qr_code string
      const qrBuffer = await QRCode.toBuffer(tag.qr_code, {
        width: 250,
        margin: 1,
      });

      doc
        .fontSize(14)
        .text(`Tag ${i + 1} of ${tags.length}`, { align: 'center' });
      
      doc.moveDown(0.5);
      
      // Center the QR image manually
      const pageWidth = doc.page.width;
      const imgSize = 250;
      const x = (pageWidth - imgSize) / 2;
      doc.image(qrBuffer, x, doc.y, { width: imgSize, height: imgSize });
      
      doc.moveDown(10);
      
      doc
        .fontSize(12)
        .text(tag.qr_code, { align: 'center' });
    }

    doc.end();

  } catch (err) {
    logger.error('downloadTagsPdf error:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};