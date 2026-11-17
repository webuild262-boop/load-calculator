/*
 * verify-roundtrip.js — prove the exported day IS the seeded day.
 *
 * Loads the seven data sets written by export-seed.js, hands them to
 * createEngine as a payload (no seed construction runs), plays the day
 * out, and compares the outcome against the seeded engine: headline
 * numbers plus a deep digest of the day log, the plans, every load,
 * and the manual comparison. Both must come out identical.
 *
 * Usage: node tools/verify-roundtrip.js [seed-data-dir]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const LoadEngine = require('../packages/variable-engine/engine.js');

const dataDir = process.argv[2] || path.join(__dirname, 'seed-data');
const NAMES = ['warehouse-inventory', 'production', 'dock-trailer-schedule',
  'upcoming-orders', 'cost-table', 'recycling', 'common-orders-and-runs'];

const payload = {};
NAMES.forEach(function (name) {
  payload[name] = JSON.parse(fs.readFileSync(path.join(dataDir, name + '.json'), 'utf8'));
});

function runDay(e) {
  let guard = 0;
  while (e.state.now < e.config.dayEnd && guard++ < 5000) e.tick(0.5);
  return e;
}
function metrics(e) {
  const S = e.state;
  const plans = Object.keys(S.enginePlans).map(function (k) { return S.enginePlans[k]; });
  let fill = 0, cost = 0, pallets = 0;
  plans.forEach(function (p) { fill += p.fill; cost += p.cost; pallets += p.pallets; });
  return {
    variations: S.variations,
    engFillPct: plans.length ? Math.round((fill / plans.length) * 1000) / 10 : 0,
    engCpp: pallets ? (cost / pallets).toFixed(2) : '—',
    manFillPct: S.baseline.fillN ? Math.round((S.baseline.fillSum / S.baseline.fillN) * 100) : 0,
    manCpp: S.baseline.palletSum ? (S.baseline.costSum / S.baseline.palletSum).toFixed(2) : '—',
    departed: S.departures.filter(function (d) { return d.departed; }).length,
    shippedPallets: S.shippedPallets
  };
}
function digest(e) {
  const S = e.state;
  return JSON.stringify({
    log: S.log.map(function (x) { return x.t + '|' + x.text; }),
    plans: S.enginePlans,
    loads: S.loadOrder.map(function (id) { const L = S.loads[id]; return [L.id, L.state, L.pallets, L.assignedTo]; }),
    baseline: S.baseline, variations: S.variations, shipped: S.shippedPallets
  });
}

const seeded = runDay(LoadEngine.createEngine(262));
const loaded = runDay(LoadEngine.createEngine(262, payload));

console.log('seeded:', JSON.stringify(metrics(seeded)));
console.log('loaded:', JSON.stringify(metrics(loaded)));
const sameMetrics = JSON.stringify(metrics(seeded)) === JSON.stringify(metrics(loaded));
const sameDigest = digest(seeded) === digest(loaded);
console.log(sameMetrics ? 'METRICS IDENTICAL' : 'METRICS DIFFER');
console.log(sameDigest ? 'DEEP DIGEST IDENTICAL (log, plans, loads, baseline)' : 'DEEP DIGEST DIFFERS');
if (!sameMetrics || !sameDigest) process.exit(1);
console.log('ROUND TRIP PROVEN — the loaded day is the seeded day.');
