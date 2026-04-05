/**
 * Compare k6 results against baseline (TASK-102).
 * Usage: node scripts/compare-baseline.js tests/load/baseline.json tests/load/results.json
 */
const fs = require('fs');

const [,, baselinePath, resultsPath] = process.argv;

if (!baselinePath || !resultsPath) {
  console.error('Usage: node compare-baseline.js <baseline.json> <results.json>');
  process.exit(1);
}

function readLastMetrics(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const metrics = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'Point' && entry.metric) {
        if (!metrics[entry.metric]) metrics[entry.metric] = [];
        metrics[entry.metric].push(entry.data.value);
      }
    } catch {}
  }
  return metrics;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

const baseline = readLastMetrics(baselinePath);
const results = readLastMetrics(resultsPath);

const checks = [
  { metric: 'http_req_duration', p: 95, maxRegressionPct: 20 },
  { metric: 'http_req_duration', p: 99, maxRegressionPct: 30 },
];

let passed = true;

for (const { metric, p, maxRegressionPct } of checks) {
  const baseVals = baseline[metric];
  const currVals = results[metric];

  if (!baseVals || !currVals) {
    console.log(`SKIP  ${metric} p${p}: no data`);
    continue;
  }

  const baseP = percentile(baseVals, p);
  const currP = percentile(currVals, p);
  const regressionPct = ((currP - baseP) / baseP) * 100;

  if (regressionPct > maxRegressionPct) {
    console.error(`FAIL  ${metric} p${p}: baseline=${baseP.toFixed(0)}ms, current=${currP.toFixed(0)}ms (+${regressionPct.toFixed(1)}% > ${maxRegressionPct}% threshold)`);
    passed = false;
  } else {
    console.log(`PASS  ${metric} p${p}: baseline=${baseP.toFixed(0)}ms, current=${currP.toFixed(0)}ms (+${regressionPct.toFixed(1)}%)`);
  }
}

process.exit(passed ? 0 : 1);
