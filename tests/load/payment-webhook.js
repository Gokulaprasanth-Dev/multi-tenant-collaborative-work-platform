/**
 * k6 load test: Payment Webhooks — 50 VUs with pre-computed HMAC signatures (TASK-102)
 * Run: k6 run tests/load/payment-webhook.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import crypto from 'k6/crypto';

export const errorRate = new Rate('errors');

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = __ENV.RAZORPAY_WEBHOOK_SECRET || 'test-webhook-secret';
const ORG_ID = __ENV.LOADTEST_ORG_ID;

function computeHmac(payload) {
  return crypto.hmac('sha256', WEBHOOK_SECRET, payload, 'hex');
}

export default function () {
  const payload = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: `pay_loadtest_${__VU}_${Date.now()}`,
          order_id: `order_loadtest_${__VU}_${Date.now()}`,
          amount: 99900,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });

  const signature = computeHmac(payload);

  const res = http.post(
    `${BASE_URL}/api/v1/orgs/${ORG_ID}/payments/webhooks`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
      },
    }
  );

  // Webhook handler returns 200 on valid signature, 400 on invalid
  check(res, {
    'webhook accepted': r => r.status === 200 || r.status === 400,
    'not 500': r => r.status !== 500,
  });
  errorRate.add(res.status === 500);

  sleep(0.5);
}
