// AFTER PAYMENT SUCCESS

// 1. Get plan
const planRes = await query(
  'SELECT * FROM subscription_plans WHERE id = $1',
  [planId]
);

if (!planRes.rows.length) {
  throw new Error('Invalid plan selected');
}

const plan = planRes.rows[0];

// 2. Activation date
const now = new Date();

// 3. Check existing subscription (latest)
const existingRes = await query(
  `SELECT * FROM subscriptions 
   WHERE user_id = $1 AND tag_id = $2 
   ORDER BY expires_at DESC 
   LIMIT 1`,
  [userId, tagId]
);

// 4. Decide start date
let startDate = new Date();

if (
  existingRes.rows.length &&
  new Date(existingRes.rows[0].expires_at) > now
) {
  // extend from current expiry
  startDate = new Date(existingRes.rows[0].expires_at);
}

// 5. Calculate expiry
const expiry = new Date(startDate);

if (plan.duration_days) {
  expiry.setDate(expiry.getDate() + plan.duration_days);
} else if (plan.duration_months) {
  expiry.setMonth(expiry.getMonth() + plan.duration_months);
} else if (plan.duration_years) {
  expiry.setFullYear(expiry.getFullYear() + plan.duration_years);
} else {
  throw new Error('Plan duration not defined properly');
}

// 6. Insert new subscription (NO DELETE)
await query(
  `INSERT INTO subscriptions (tag_id, user_id, expires_at, created_at)
   VALUES ($1, $2, $3, NOW())`,
  [tagId, userId, expiry]
);