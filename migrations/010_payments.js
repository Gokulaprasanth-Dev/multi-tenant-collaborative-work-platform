exports.up = async (pgm) => {
  await pgm.db.query(`
    CREATE TABLE subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
      razorpay_subscription_id VARCHAR(255) UNIQUE,
      plan_tier VARCHAR(20) NOT NULL DEFAULT 'free'
        CHECK (plan_tier IN ('free','pro','business','enterprise')),
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','halted','cancelled','expired','pending')),
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      cancelled_at TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      subscription_id UUID REFERENCES subscriptions(id),
      razorpay_order_id VARCHAR(255) NOT NULL UNIQUE,
      razorpay_payment_id VARCHAR(255) UNIQUE,
      amount_paise INTEGER NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      status VARCHAR(20) NOT NULL CHECK (status IN ('created','authorized','captured','failed','refunded','disputed')),
      failure_reason TEXT,
      captured_at TIMESTAMPTZ,
      refunded_at TIMESTAMPTZ,
      idempotency_key VARCHAR(255) NOT NULL UNIQUE,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_payments_org_id ON payments(org_id)`);
  await pgm.db.query(`CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

  await pgm.db.query(`
    CREATE TABLE idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key_hash VARCHAR(255) NOT NULL UNIQUE,
      org_id UUID,
      user_id UUID,
      endpoint VARCHAR(200) NOT NULL,
      response_status INTEGER,
      response_body JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgm.db.query(`CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at)`);
};

exports.down = async (pgm) => {
  await pgm.db.query(`DROP TABLE IF EXISTS idempotency_keys CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS payments CASCADE`);
  await pgm.db.query(`DROP TABLE IF EXISTS subscriptions CASCADE`);
};
