// AFTER PAYMENT SUCCESS

// 1. Get plan
const planRes = await query(
  'SELECT * FROM subscription_plans WHERE id=$1',
  [planId]
);

if (!planRes.rows.length) {
  throw new Error('Invalid plan selected');
}

const plan = planRes.rows[0];

// 2. Calculate expiry
const expiry = new Date();
expiry.setDate(expiry.getDate() + (plan.duration_days || 365));

// 3. Insert subscription (NO plan_id)
await query(
  `INSERT INTO subscriptions (tag_id, user_id, expires_at, created_at)
   VALUES ($1, $2, $3, NOW())`,
  [tagId, userId, expiry]
);