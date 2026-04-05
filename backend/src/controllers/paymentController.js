// AFTER PAYMENT SUCCESS
const plan = await query(
  `SELECT * FROM subscription_plans WHERE id=$1`,
  [planId]
);

const expiry = new Date();
expiry.setDate(expiry.getDate() + plan.rows[0].duration_days);

await query(`
  INSERT INTO subscriptions (tag_id, user_id, plan_id, expires_at)
  VALUES ($1,$2,$3,$4)
`, [tagId, userId, planId, expiry]);