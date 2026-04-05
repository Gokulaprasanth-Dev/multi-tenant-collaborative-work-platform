/**
 * k6 load test: Task API — 100 VUs, 5 minutes (TASK-102)
 * Requires: .env.loadtest with LOADTEST_ORG_ID, LOADTEST_USER_PREFIX, LOADTEST_PASSWORD
 * Run: k6 run tests/load/task-api.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const errorRate = new Rate('errors');

export const options = {
  vus: 100,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ORG_ID = __ENV.LOADTEST_ORG_ID;
const USER_PREFIX = __ENV.LOADTEST_USER_PREFIX;
const PASSWORD = __ENV.LOADTEST_PASSWORD || 'LoadTest123!';

// Cache tokens per VU
let token = null;
let workspaceId = null;

export function setup() {
  // Authenticate VU 0 to get a workspace
  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email: `${USER_PREFIX}-0@loadtest.invalid`,
    password: PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'setup login ok': r => r.status === 200 });
  const tok = loginRes.json('data.tokens.accessToken');

  // Create workspace
  const wsRes = http.post(
    `${BASE_URL}/api/v1/orgs/${ORG_ID}/workspaces`,
    JSON.stringify({ name: 'Load Test Workspace' }),
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` } }
  );
  check(wsRes, { 'workspace created': r => r.status === 201 });
  return { workspaceId: wsRes.json('data.id') };
}

export default function (data) {
  const vuIndex = __VU % 100;

  // Login if not cached
  if (!token) {
    const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
      email: `${USER_PREFIX}-${vuIndex}@loadtest.invalid`,
      password: PASSWORD,
    }), { headers: { 'Content-Type': 'application/json' } });

    check(loginRes, { 'login ok': r => r.status === 200 });
    token = loginRes.json('data.tokens.accessToken');
    workspaceId = data.workspaceId;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Create task
  const createRes = http.post(
    `${BASE_URL}/api/v1/orgs/${ORG_ID}/workspaces/${workspaceId}/tasks`,
    JSON.stringify({ title: `Load test task ${Date.now()}`, status: 'todo' }),
    { headers }
  );
  check(createRes, { 'task created': r => r.status === 201 });
  errorRate.add(createRes.status !== 201);

  if (createRes.status === 201) {
    const taskId = createRes.json('data.id');

    // Update task
    const updateRes = http.put(
      `${BASE_URL}/api/v1/orgs/${ORG_ID}/workspaces/${workspaceId}/tasks/${taskId}`,
      JSON.stringify({ status: 'in_progress' }),
      { headers }
    );
    check(updateRes, { 'task updated': r => r.status === 200 });
    errorRate.add(updateRes.status !== 200);
  }

  sleep(1);
}
