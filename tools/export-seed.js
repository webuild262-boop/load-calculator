/*
 * export-seed.js — write the seeded Judge Mode day out as data sets.
 *
 * Runs the engine's own seed construction (seed 262), then emits the
 * day as JSON documents: one file per placed data set, in the shape the
 * Cosmos containers hold (partition key /id) and the Function API
 * serves. Loading these documents back through createEngine(seed,
 * payload) rebuilds the same day from data instead of from the seed —
 * tools/verify-roundtrip.js proves the day comes out identical.
 *
 * Usage: node tools/export-seed.js [output-dir]
 * Default output dir: tools/seed-data/
 */
'use strict';
const fs = require('fs');
const path = require('path');
const LoadEngine = require('../packages/variable-engine/engine.js');

const outDir = process.argv[2] || path.join(__dirname, 'seed-data');
// deferMatcher: the export is the day exactly as placed, before the
// first calculation runs — the intake engine runs its own morning fill.
const engine = LoadEngine.createEngine(262, null, { deferMatcher: true });
const S = engine.state;
const C = engine.config;

function orderDoc(o) {
  return {
    id: o.id, machineId: o.machineId, business: o.business, lane: o.lane,
    pallets: o.pallets, windowStart: o.windowStart, windowEnd: o.windowEnd,
    partialAllowed: o.partialAllowed, rate: o.rate, progress: o.progress
  };
}

const sets = {};

// (1) Warehouse Inventory — finished orders waiting, in floor order.
sets['warehouse-inventory'] = S.loadOrder
  .map(function (id) { return S.loads[id]; })
  .filter(function (L) { return L && L.source === 'inventory'; })
  .map(function (L) {
    return {
      id: L.id, business: L.business, lane: L.lane, pallets: L.pallets,
      windowStart: L.windowStart, windowEnd: L.windowEnd,
      partialAllowed: L.partialAllowed, ageDays: L.ageDays, readyTime: L.readyTime
    };
  });

// (2) Production — each machine and the run on it now.
sets['production'] = S.machines.map(function (m) {
  return { id: m.id, current: orderDoc(m.current) };
});

// (3) Upcoming Orders — the queue behind each machine's current run.
sets['upcoming-orders'] = [];
S.machines.forEach(function (m) {
  m.queue.forEach(function (o, idx) {
    const doc = orderDoc(o);
    doc.queuePosition = idx;
    sets['upcoming-orders'].push(doc);
  });
});

// (4) Dock and Trailer Schedule — the pickups the plant set.
sets['dock-trailer-schedule'] = S.departures.map(function (d) {
  return { id: d.id, dock: d.dock, time: d.time, lane: d.lane, box: d.box };
});

// (5) Cost Table — plant settings, one document per lane rate, one per box.
const costTable = [{
  id: 'plant-settings',
  dayStart: C.dayStart, closeTime: C.closeTime, dayEnd: C.dayEnd,
  alertPublish: C.alertPublish, alertFinal: C.alertFinal,
  watcherThreshold: C.watcherThreshold, preLadenMinutes: C.preLadenMinutes,
  handlingPerPallet: C.handlingPerPallet, fuelSurchargePct: C.fuelSurchargePct,
  materialsInPerMinute: C.materialsInPerMinute,
  recyclingOutPerMinute: C.recyclingOutPerMinute,
  machines: C.machines, docks: C.docks.slice()
}];
Object.keys(C.laneRates).forEach(function (lane) {
  costTable.push({ id: 'lane:' + lane, kind: 'laneRate', lane: lane, rates: Object.assign({}, C.laneRates[lane]) });
});
Object.keys(C.boxes).forEach(function (box) {
  const b = C.boxes[box];
  costTable.push({ id: 'box:' + box, kind: 'box', box: box, label: b.label, cap: b.cap, loadRate: b.loadRate, setup: b.setup });
});
sets['cost-table'] = costTable;

// (6) Recycling — the material flow rates the production tally runs on.
sets['recycling'] = [{
  id: 'recycling-flow',
  materialsInPerMinute: C.materialsInPerMinute,
  recyclingOutPerMinute: C.recyclingOutPerMinute
}];

// (7) Common Orders and Runs — the standing daily run's pattern.
const cr = LoadEngine.COMMON_RUN;
sets['common-orders-and-runs'] = [{
  id: 'common-run:' + cr.business,
  business: cr.business, lane: cr.lane, pallets: cr.pallets,
  completesAt: cr.completesAt, windowStart: cr.windowStart,
  windowEnd: cr.windowEnd, partialAllowed: cr.partialAllowed
}];

fs.mkdirSync(outDir, { recursive: true });
Object.keys(sets).forEach(function (name) {
  const file = path.join(outDir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(sets[name], null, 2) + '\n');
  console.log(name + ': ' + sets[name].length + ' document(s) -> ' + file);
});
console.log('Exported the seeded day (seed 262) as ' + Object.keys(sets).length + ' data sets.');
