// migrations/018_push_subscriptions.js
'use strict';

exports.up = async (sql) => {
  await sql`
    CREATE TABLE push_subscriptions (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      endpoint   TEXT        NOT NULL,
      p256dh     TEXT        NOT NULL,
      auth       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, endpoint)
    )
  `;
};

exports.down = async (sql) => {
  await sql`DROP TABLE IF EXISTS push_subscriptions`;
};
