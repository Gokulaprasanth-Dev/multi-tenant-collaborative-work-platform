/**
 * k6 load test: Chat WebSocket — 100 VUs (TASK-102)
 * Run: k6 run tests/load/chat-ws.js
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

export const errorRate = new Rate('errors');

export const options = {
  vus: 100,
  duration: '2m',
  thresholds: {
    errors: ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const USER_PREFIX = __ENV.LOADTEST_USER_PREFIX;
const PASSWORD = __ENV.LOADTEST_PASSWORD || 'LoadTest123!';
const ORG_ID = __ENV.LOADTEST_ORG_ID;

export default function () {
  const vuIndex = __VU % 100;

  // Get token
  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email: `${USER_PREFIX}-${vuIndex}@loadtest.invalid`,
    password: PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'login ok': r => r.status === 200 });
  const token = loginRes.json('data.tokens.accessToken');

  // WebSocket connection
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket&token=${token}&orgId=${ORG_ID}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      // Send presence heartbeat
      socket.send(JSON.stringify({ event: 'presence:heartbeat', data: {} }));
    });

    socket.on('message', function (msg) {
      check(msg, { 'received message': m => m !== null });
    });

    socket.on('error', function (e) {
      errorRate.add(1);
    });

    sleep(5);
    socket.close();
  });

  check(res, { 'ws connected': r => r && r.status === 101 });
  errorRate.add(!res || res.status !== 101 ? 1 : 0);
}
