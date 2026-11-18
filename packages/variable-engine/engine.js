/*
 * Load Calculator — variable engine (packages/variable-engine)
 * Webuild262. One reusable engine: the operator places the variables,
 * the placed variables create the equation, the equation calculates
 * the best output for the outcome requested.
 *
 * This file is pure logic — no DOM. It runs in the browser (window.LoadEngine)
 * and in node for tests (module.exports).
 *
 * Design words held from the spec: the plan is SET at the close.
 * Load states: inventory, projected, calculated, assigned,
 *              set to move, set to go, shipped.
 */
(function (global) {
  'use strict';

  // ---------- Placed variables (demo configuration, spec section 12) ----------
  var CONFIG = {
    dayStart: 7 * 60,          // 7:00 AM, minutes after midnight
    closeTime: 13 * 60 + 30,   // the close: 1:30 PM
    dayEnd: 16 * 60,           // last departures land by 4:00 PM
    alertPublish: 0.85,        // 85%: projected ready time published to the matcher
    alertFinal: 0.95,          // 95%: run ending shortly — final ready-time calculation
    watcherThreshold: 0.05,    // watcher speaks at >= 5% saving on an affected load
    preLadenMinutes: 15,       // pre-laden confirmation looks 15 minutes ahead
    handlingPerPallet: 6,      // dollars (plant-side figure)
    fuelSurchargePct: 0.12,    // FSC on the lane rate — Q1 2026 actual: fuel $30,386 on line haul $253,995 (ECHO review deck)
    materialsInPerMinute: 2,   // production flow tallies (the recycling data set carries these)
    recyclingOutPerMinute: 0.7,
    boxes: {
      '45T': { label: "45' trailer", cap: 22, loadRate: 2.5, setup: 10 },
      '26B': { label: "26' box truck", cap: 12, loadRate: 2.0, setup: 8 }
    },
    laneRates: { // dollars per box, per lane — grounded in the ECHO Q1 2026 freight review (Jersey City plant):
      // 45' = TL average total spend per shipment on the matching real lane (Brentwood NY $682, 18 shipments;
      // Breinigsville PA $555; Canton MA $700; DC / Baltimore uses the deck-wide TL average $855, 190 shipments,
      // no DC lane in the deck's top lanes). 26' = 45' x 0.83, the deck's small-shipment ratio
      // (expedite average $710 / TL average $855). Fuel surcharge is applied on top in planCost.
      'NYC Metro':    { '45T': 682, '26B': 566 },
      'Philadelphia': { '45T': 555, '26B': 461 },
      'Boston':       { '45T': 700, '26B': 581 },
      'DC / Baltimore': { '45T': 855, '26B': 710 }
    },
    orderNumberBase: 723001, // first order number of the day — a placed default for the demo; the day's own numbers rise from here in creation order
    machines: 5,
    docks: ['D1', 'D2']
  };

  var LANES = Object.keys(CONFIG.laneRates);
  var BUSINESSES = ['Acme Packaging', 'BlueLine Foods', 'Garden State Apparel',
    'Metro Pharma', 'Hudson Home Goods', 'Liberty Beverages'];

  // Company directory: one fixed address per company, held as placed
  // demo data. An order number is tied to the company at its address:
  // renderers resolve a seeded order's address from this directory by
  // company name, so the seeded day stores nothing new.
  var COMPANY_ADDRESSES = {
    'Acme Packaging': '482 Industrial Ave, Carlstadt, NJ 07072',
    'BlueLine Foods': '77 Meadowlands Pkwy, Secaucus, NJ 07094',
    'Garden State Apparel': '900 Castle Rd, Secaucus, NJ 07094',
    'Metro Pharma': '214 Harbor Blvd, Jersey City, NJ 07302',
    'Hudson Home Goods': '35 Hudson St, Hoboken, NJ 07030',
    'Liberty Beverages': '88 Liberty Ave, Jersey City, NJ 07306'
  };

  // Common orders and runs: the standing daily run, placed on its
  // recurring pattern. It completes mid-afternoon, after the close.
  // A data-set payload can supply its own pattern; this is the default.
  var COMMON_RUN = {
    business: 'Liberty Beverages (common run)', lane: 'DC / Baltimore', pallets: 8,
    completesAt: 14 * 60 + 5, windowStart: 14 * 60, windowEnd: 15 * 60 + 55,
    partialAllowed: true
  };

  // Deterministic RNG so the demo day is the same day every run (Judge Mode seed).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtTime(mins) {
    mins = Math.round(mins);
    var h = Math.floor(mins / 60), m = mins % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  // ----- Data-set intake helpers -----
  // A payload is the day supplied from outside the page: one document
  // array per placed data set, in the shape tools/export-seed.js emits
  // and the Function API serves. The cost table arrives as documents —
  // one plant-settings document, one per lane rate, one per box — and is
  // reassembled here onto a copy of CONFIG, so a loaded day's rates can
  // never leak into another engine's day.
  function applyCostTable(base, docs) {
    var c = Object.assign({}, base);
    var laneRates = {}, boxes = {}, sawLane = false, sawBox = false;
    docs.forEach(function (d) {
      if (!d || !d.id) return;
      if (d.id === 'plant-settings') {
        ['dayStart', 'closeTime', 'dayEnd', 'alertPublish', 'alertFinal',
         'watcherThreshold', 'preLadenMinutes', 'handlingPerPallet',
         'fuelSurchargePct', 'materialsInPerMinute', 'recyclingOutPerMinute',
         'machines'].forEach(function (k) { if (d[k] != null) c[k] = d[k]; });
        if (d.docks) c.docks = d.docks.slice();
      } else if (d.kind === 'laneRate' && d.lane && d.rates) {
        laneRates[d.lane] = Object.assign({}, d.rates); sawLane = true;
      } else if (d.kind === 'box' && d.box) {
        boxes[d.box] = { label: d.label, cap: d.cap, loadRate: d.loadRate, setup: d.setup };
        sawBox = true;
      }
    });
    if (sawLane) c.laneRates = laneRates;
    if (sawBox) c.boxes = boxes;
    return c;
  }

  function requireSet(payload, name) {
    var docs = payload[name];
    if (!Array.isArray(docs)) throw new Error('data-set payload is missing "' + name + '"');
    return docs;
  }

  // ---------- Engine ----------
  function createEngine(seed, payload, options) {
    var rnd = mulberry32(seed || 262);
    var uid = 1;
    function nextId(prefix) { return prefix + (uid++); }

    // Effective configuration for this run of the engine. With no
    // payload it is the module CONFIG itself, untouched — the seeded
    // day runs exactly as it always has. A payload's cost table (and
    // its recycling flow rates) are applied to a copy.
    var C = CONFIG;
    if (payload) {
      if (payload['cost-table']) C = applyCostTable(CONFIG, payload['cost-table']);
      var recDocs = payload['recycling'];
      if (Array.isArray(recDocs)) {
        var rec = null;
        recDocs.forEach(function (d) { if (d && d.id === 'recycling-flow') rec = d; });
        if (rec) {
          if (C === CONFIG) C = Object.assign({}, CONFIG);
          if (rec.materialsInPerMinute != null) C.materialsInPerMinute = rec.materialsInPerMinute;
          if (rec.recyclingOutPerMinute != null) C.recyclingOutPerMinute = rec.recyclingOutPerMinute;
        }
      }
    }
    var lanes = Object.keys(C.laneRates);

    // The standing common run for this engine: the built-in pattern, or
    // the one the payload's common-orders-and-runs set supplies.
    var commonRun = COMMON_RUN;
    if (payload && Array.isArray(payload['common-orders-and-runs']) && payload['common-orders-and-runs'].length) {
      var crDoc = payload['common-orders-and-runs'][0];
      commonRun = {
        business: crDoc.business, lane: crDoc.lane, pallets: crDoc.pallets,
        completesAt: crDoc.completesAt, windowStart: crDoc.windowStart,
        windowEnd: crDoc.windowEnd, partialAllowed: !!crDoc.partialAllowed
      };
    }

    var S = {
      now: C.dayStart,
      closed: false,
      closeLogged: false,
      loads: {},        // id -> load
      loadOrder: [],    // ids in creation order
      machines: [],
      departures: [],
      variations: 0,
      log: [],
      watcher: [],
      shippedCount: 0,
      shippedPallets: 0,
      enginePlans: {},  // departureId -> {fill, cost, pallets}
      baseline: { fillSum: 0, fillN: 0, costSum: 0, palletSum: 0 },
      // Pristine copies of the day's placed inputs for the manual
      // (engine-off) comparison — see the snapshot below computeBaseline's
      // comment. The live loads and departures mutate as the day runs;
      // these copies never do, so the manual figure stays a full-day one.
      manualLoads: [],  // {key, lane, pallets, ageDays}
      manualDeps: [],   // {key, lane, box, time}
      hotUsed: false,
      // Operator-placed settings for this run of the day. They start at the
      // CONFIG values; placing new ones changes this run only, and a fresh
      // day starts from the placed defaults again.
      settings: {
        alertPublish: C.alertPublish,
        alertFinal: C.alertFinal,
        fuelSurchargePct: C.fuelSurchargePct
      }
    };

    function log(text) {
      S.log.push({ t: S.now, text: text });
      if (S.log.length > 60) S.log.shift();
    }

    function addLoad(fields) {
      var load = Object.assign({
        id: nextId('L'), state: 'inventory', readyTime: C.dayStart,
        ageDays: 0, assignedTo: null, source: 'inventory', partialOf: null
      }, fields);
      S.loads[load.id] = load;
      S.loadOrder.push(load.id);
      return load;
    }

    // ----- Order numbers: one number per order, never repeated -----
    // The day's own run starts at the placed base, rising in creation
    // order. An operator may enter any number in any manner; entry
    // never moves this run. The single hard rule is uniqueness: a
    // number on the board is never handed out twice, so the run skips
    // any number already carried by an order or a load.
    var nextAutoNo = C.orderNumberBase;
    function orderNumberInUse(n) {
      var used = false;
      S.machines.forEach(function (m) {
        if (m.current && m.current.orderNo === n) used = true;
        m.queue.forEach(function (o) { if (o.orderNo === n) used = true; });
      });
      if (!used) {
        S.loadOrder.forEach(function (id) {
          var L = S.loads[id];
          if (L && L.orderNo === n) used = true;
        });
      }
      return used;
    }
    function takeOrderNo() {
      while (orderNumberInUse(nextAutoNo)) nextAutoNo++;
      return nextAutoNo++;
    }

    function makeOrder(machineId) {
      var lane = lanes[Math.floor(rnd() * lanes.length)];
      return {
        id: nextId('O'),
        orderNo: takeOrderNo(),
        machineId: machineId,
        business: BUSINESSES[Math.floor(rnd() * BUSINESSES.length)],
        lane: lane,
        pallets: 10 + Math.floor(rnd() * 16), // 10–25
        windowStart: C.dayStart + 120 + Math.floor(rnd() * 240),
        windowEnd: C.dayStart + 480 + Math.floor(rnd() * 240),
        partialAllowed: rnd() < 0.6,
        rate: 0.004 + rnd() * 0.004, // fraction of the run per minute
        progress: 0,
        loadId: null,
        alerted85: false,
        alerted95: false,
        materialsIn: 0,
        recyclingOut: 0
      };
    }

    // ----- Seed the placed data sets -----
    // Two ways in, one day out: the built-in seed builds the day from
    // the deterministic pattern; a data-set payload builds the same
    // structures from documents loaded from outside the page.
    function seedFromRng() {
      // (1) Warehouse inventory: finished orders waiting, each with an age.
      //     The demo seed shapes the lanes the way a real plant looks —
      //     three heavy lanes and one light lane (DC / Baltimore).
      var laneBag = [];
      ['NYC Metro', 'NYC Metro', 'NYC Metro', 'NYC Metro', 'NYC Metro', 'NYC Metro', 'NYC Metro', 'NYC Metro',
       'Philadelphia', 'Philadelphia', 'Philadelphia', 'Philadelphia', 'Philadelphia', 'Philadelphia', 'Philadelphia',
       'Boston', 'Boston', 'Boston', 'Boston', 'Boston', 'Boston', 'Boston',
       'DC / Baltimore', 'DC / Baltimore'].forEach(function (l) { laneBag.push(l); });
      for (var i = 0; i < laneBag.length; i++) {
        var lane = laneBag[i];
        addLoad({
          business: BUSINESSES[Math.floor(rnd() * BUSINESSES.length)],
          lane: lane,
          pallets: lane === 'DC / Baltimore' ? 5 + Math.floor(rnd() * 5) : 8 + Math.floor(rnd() * 16),
          windowStart: C.dayStart + Math.floor(rnd() * 180),
          windowEnd: C.dayStart + 420 + Math.floor(rnd() * 300),
          partialAllowed: rnd() < 0.6,
          ageDays: Math.floor(rnd() * 5),
          source: 'inventory'
        });
      }
      // (2) Production: machines with running orders and a queue behind each.
      for (var m = 0; m < C.machines; m++) {
        var machine = { id: 'M' + (m + 1), current: makeOrder('M' + (m + 1)), queue: [] };
        machine.current.progress = 0.15 + rnd() * 0.5;
        machine.queue.push(makeOrder(machine.id));
        machine.queue.push(makeOrder(machine.id));
        S.machines.push(machine);
      }
      // (3) Dock and trailer schedule: the plant sets the pickups; the engine
      //     builds each load backward from its scheduled cutoff.
      var sched = [
        ['D1', 9 * 60 + 30, '45T'], ['D2', 10 * 60 + 15, '45T'],
        ['D1', 11 * 60, '26B'], ['D2', 12 * 60, '26B'],
        ['D1', 12 * 60 + 45, '45T'], ['D2', 13 * 60 + 45, '45T'],
        ['D1', 14 * 60 + 30, '45T'], ['D2', 15 * 60 + 30, '45T']
      ];
      sched.forEach(function (row, idx) {
        S.departures.push({
          id: nextId('D'), dock: row[0], time: row[1],
          lane: lanes[idx % lanes.length], box: row[2],
          bol: false, departed: false, preLadenDone: false
        });
      });
    }

    function orderFromDoc(doc) {
      return {
        id: doc.id, orderNo: takeOrderNo(), machineId: doc.machineId, business: doc.business,
        lane: doc.lane, pallets: doc.pallets,
        windowStart: doc.windowStart, windowEnd: doc.windowEnd,
        partialAllowed: !!doc.partialAllowed,
        rate: doc.rate, progress: doc.progress || 0,
        loadId: null, alerted85: false, alerted95: false,
        materialsIn: 0, recyclingOut: 0
      };
    }

    function seedFromPayload(payload) {
      // (1) Warehouse inventory, in the order the documents arrive —
      //     that order is the floor's order, and the matcher reads it.
      requireSet(payload, 'warehouse-inventory').forEach(function (doc) {
        addLoad({
          id: doc.id, business: doc.business, lane: doc.lane, pallets: doc.pallets,
          windowStart: doc.windowStart, windowEnd: doc.windowEnd,
          partialAllowed: !!doc.partialAllowed, ageDays: doc.ageDays || 0,
          readyTime: doc.readyTime != null ? doc.readyTime : C.dayStart,
          source: 'inventory', state: 'inventory'
        });
      });
      // (2) Production: each machine and the run on it now; the queue
      //     behind each run comes from the upcoming-orders set.
      var queues = {};
      requireSet(payload, 'upcoming-orders').forEach(function (doc) {
        (queues[doc.machineId] = queues[doc.machineId] || []).push(doc);
      });
      Object.keys(queues).forEach(function (mid) {
        queues[mid].sort(function (a, b) { return (a.queuePosition || 0) - (b.queuePosition || 0); });
      });
      requireSet(payload, 'production').forEach(function (doc) {
        S.machines.push({
          id: doc.id,
          current: doc.current ? orderFromDoc(doc.current) : null,
          queue: (queues[doc.id] || []).map(orderFromDoc)
        });
      });
      // (3) Dock and trailer schedule.
      requireSet(payload, 'dock-trailer-schedule').forEach(function (doc) {
        S.departures.push({
          id: doc.id, dock: doc.dock, time: doc.time, lane: doc.lane, box: doc.box,
          bol: false, departed: false, preLadenDone: false
        });
      });
      // Ids handed out from here on continue past every id the payload
      // brought in, so a load created during the day can never take
      // the name of one that was placed.
      var maxSuffix = 0;
      var seen = S.loadOrder.slice();
      S.machines.forEach(function (mach) {
        if (mach.current) seen.push(mach.current.id);
        mach.queue.forEach(function (o) { seen.push(o.id); });
      });
      S.departures.forEach(function (d) { seen.push(d.id); });
      seen.forEach(function (id) {
        var n = parseInt(String(id).slice(1), 10);
        if (!isNaN(n) && n > maxSuffix) maxSuffix = n;
      });
      uid = maxSuffix + 1;
    }

    // Snapshot the day's placed inputs for the manual comparison, before
    // the matcher touches anything: the finished inventory and the dock
    // schedule, copied field by field. Operator placements add their own
    // copies in placeOrder / placeDeparture.
    function snapshotManual() {
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (L && L.source === 'inventory') {
          S.manualLoads.push({ key: L.id, lane: L.lane, pallets: L.pallets, ageDays: L.ageDays || 0 });
        }
      });
      S.departures.forEach(function (dep) {
        S.manualDeps.push({ key: dep.id, lane: dep.lane, box: dep.box, time: dep.time });
      });
    }

    if (payload) seedFromPayload(payload); else seedFromRng();
    snapshotManual();

    // ----- Core calculations -----
    function loadDuration(load, boxKey) {
      var b = C.boxes[boxKey];
      return load.pallets * b.loadRate + b.setup;
    }

    function planCost(dep, pallets) {
      return C.laneRates[dep.lane][dep.box] * (1 + S.settings.fuelSurchargePct) + C.handlingPerPallet * pallets;
    }

    function candidateLoads(dep) {
      var out = [];
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (!L) return;
        if (L.state !== 'inventory' && L.state !== 'projected' && L.state !== 'calculated') return;
        if (L.assignedTo) return;
        // Choice 2 at entry, set to Warehouse: this load rests on the
        // shelf, so the matcher never takes it as a candidate.
        if (L.deliveryChoice === 'warehouse') return;
        if (L.lane !== dep.lane) return;
        if (L.windowEnd < dep.time) return; // latest delivery window check
        out.push(L);
      });
      return out;
    }

    // Feasibility: ready time + loading already queued at this departure
    // + this load's loading duration must land by the scheduled departure.
    function fits(dep, load, alreadyDur) {
      return load.readyTime + alreadyDur + loadDuration(load, dep.box) <= dep.time;
    }

    function scorePlan(dep, chosen, pallets) {
      var cap = C.boxes[dep.box].cap;
      var fill = pallets / cap;
      var cost = planCost(dep, pallets);
      var ageSum = 0;
      chosen.forEach(function (c) { ageSum += c.load.ageDays || 0; });
      var avgAge = chosen.length ? ageSum / chosen.length : 0;
      var tight = 0;
      chosen.forEach(function (c) { if (c.load.windowEnd - dep.time < 60) tight++; });
      return fill * 100 + avgAge * 2 - (cost / Math.max(pallets, 1)) * 1.2 - tight * 8;
    }

    var STRATEGIES = {
      ageFirst: function (a, b) { return (b.ageDays - a.ageDays) || (b.pallets - a.pallets); },
      fitFirst: function (a, b) { return b.pallets - a.pallets; },
      slackFirst: function (a, b) { return (a.windowEnd - b.windowEnd) || (b.ageDays - a.ageDays); },
      readyFirst: function (a, b) { return (a.readyTime - b.readyTime) || (b.ageDays - a.ageDays); }
    };

    function evaluatePlan(dep, strategyName) {
      var cap = C.boxes[dep.box].cap;
      var cands = candidateLoads(dep).slice().sort(STRATEGIES[strategyName]);
      var chosen = [], pallets = 0, dur = 0;
      cands.forEach(function (L) {
        if (pallets >= cap) return;
        if (!fits(dep, L, dur)) return;
        if (pallets + L.pallets <= cap) {
          chosen.push({ load: L, pallets: L.pallets, partial: false });
          pallets += L.pallets; dur += loadDuration(L, dep.box);
        } else if (L.partialAllowed && cap - pallets >= 4) {
          // Partial-ahead: part of the load ships early to fill the trailer.
          var part = cap - pallets;
          chosen.push({ load: L, pallets: part, partial: true });
          pallets += part; dur += loadDuration({ pallets: part }, dep.box);
        }
      });
      S.variations++;
      return { chosen: chosen, pallets: pallets, score: scorePlan(dep, chosen, pallets) };
    }

    function runMatcher(reason) {
      // After the close, the plan the close set stands: the matcher no longer
      // re-plans the day. Only the pre-laden confirmation may fold in what
      // completes inside its 15-minute lookahead. Improvements the matcher
      // would have made surface through the watcher instead.
      if (S.closed && !(reason && reason.indexOf('pre-laden') === 0)) {
        computeBaseline();
        return;
      }
      S.departures.forEach(function (dep) {
        if (dep.departed || dep.bol) return;
        if (dep.time <= S.now) return;
        var best = null, bestName = null;
        Object.keys(STRATEGIES).forEach(function (name) {
          var plan = evaluatePlan(dep, name);
          if (!best || plan.score > best.score) { best = plan; bestName = name; }
        });
        // Clear this departure's previous tentative assignments.
        S.loadOrder.forEach(function (id) {
          var L = S.loads[id];
          if (L && L.assignedTo === dep.id && L.state === 'assigned') {
            L.assignedTo = null;
            L.state = L.source === 'production' ? 'calculated' : 'inventory';
          }
        });
        if (best && best.pallets > 0) {
          best.chosen.forEach(function (c) {
            if (c.partial) {
              var rest = c.load.pallets - c.pallets;
              var partLoad = addLoad({
                business: c.load.business, lane: c.load.lane, pallets: c.pallets,
                windowStart: c.load.windowStart, windowEnd: c.load.windowEnd,
                partialAllowed: c.load.partialAllowed, ageDays: c.load.ageDays,
                readyTime: c.load.readyTime, source: c.load.source, partialOf: c.load.id
              });
              if (c.load.orderId) partLoad.orderId = c.load.orderId;
              if (c.load.orderNo != null) partLoad.orderNo = c.load.orderNo;
              if (c.load.deliveryChoice) partLoad.deliveryChoice = c.load.deliveryChoice;
              if (c.load.address) partLoad.address = c.load.address;
              c.load.pallets = rest;
              partLoad.state = 'assigned'; partLoad.assignedTo = dep.id;
            } else {
              c.load.state = 'assigned'; c.load.assignedTo = dep.id;
            }
          });
          S.enginePlans[dep.id] = {
            fill: best.pallets / C.boxes[dep.box].cap,
            cost: planCost(dep, best.pallets), pallets: best.pallets, strategy: bestName
          };
        } else {
          delete S.enginePlans[dep.id];
        }
      });
      computeBaseline();
      if (reason) log('Matcher re-ran (' + reason + ') — ' + S.variations + ' variations evaluated so far.');
    }

    // Engine-off comparison — the MANUAL model, in plain terms.
    // Question it answers: what would this same day cost if a person
    // planned it by hand, the way the floor has always done it?
    // Rules (deliberately simpler than the engine — that gap is the point):
    //   - Finished inventory only: the seeded warehouse loads plus any
    //     order the operator places. Nothing still on a machine counts.
    //   - Oldest first: within a lane, loads are taken by age (ageDays,
    //     highest first) so old stock moves before fresh stock.
    //   - Whole loads only: a load goes on the truck entire or not at
    //     all — no partials, no splitting a load across trucks.
    //   - First-fit: trucks are worked in departure-time order; each
    //     truck takes the oldest loads of its lane that fit its box.
    //   - No ready-time math: if it is in the warehouse and matches the
    //     lane, it can go — production timing is not the manual planner's
    //     problem in this model.
    //   - Same prices as the engine: planCost() below (lane rate x
    //     (1 + fuel surcharge) + handling per pallet), so the comparison
    //     isolates the planning, never the price list.
    // It runs over the pristine copies in S.manualLoads / S.manualDeps —
    // the day as placed at creation, plus operator placements — never
    // over live loads, so trucks departing and loads changing state
    // cannot drain it. The figure is the same at 7 AM and at day-complete.
    // Knobs for tweaking: the rules live in this one function (sort key,
    // whole-load test, truck order). The pool lives in the snapshot taken
    // at creation plus the copies added in placeOrder / placeDeparture.
    // Prices live in CONFIG (laneRates, handlingPerPallet) and in
    // S.settings.fuelSurchargePct — the same knobs the engine side uses.
    function computeBaseline() {
      var used = {}, fillSum = 0, fillN = 0, costSum = 0, palletSum = 0;
      var deps = S.manualDeps.slice().sort(function (a, b) { return a.time - b.time; });
      deps.forEach(function (dep) {
        var cap = C.boxes[dep.box].cap, pallets = 0;
        var pool = S.manualLoads
          .filter(function (L) { return !used[L.key] && L.lane === dep.lane; })
          .sort(function (a, b) { return b.ageDays - a.ageDays; });
        pool.forEach(function (L) {
          if (pallets + L.pallets <= cap) { used[L.key] = true; pallets += L.pallets; }
        });
        if (pallets > 0) {
          fillSum += pallets / cap; fillN++;
          costSum += planCost(dep, pallets); palletSum += pallets;
        }
      });
      S.baseline = { fillSum: fillSum, fillN: fillN, costSum: costSum, palletSum: palletSum };
    }

    // ----- Board health: an output of the calculation, never an input -----
    function health(load) {
      if (load.state === 'shipped') return 1;
      if (load.state === 'assigned' || load.state === 'set to move' || load.state === 'set to go') {
        var dep = S.departures.filter(function (d) { return d.id === load.assignedTo; })[0];
        var plan = dep ? S.enginePlans[dep.id] : null;
        var fill = plan ? plan.fill : 0.5;
        if (fill >= 0.85) return 0.95;
        if (fill >= 0.6) return 0.65;
        return 0.35;
      }
      var slack = load.windowEnd - S.now;
      if (slack < 120) return 0.15;
      if (slack < 300) return 0.45;
      return 0.6;
    }

    // ----- The close, pre-laden confirmation, dispatch -----
    function doClose() {
      S.closed = true;
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (L && L.state === 'assigned') L.state = 'set to move'; // setup, confirmed for the plan the close set
      });
      log('1:30 PM close — the plan is set. Bills of lading follow per departure; jobs go to inventory only where the customer calls for it.');
    }

    function doPreLaden(dep) {
      dep.preLadenDone = true;
      // Confirmation calculation: the plan is checked current, and anything
      // completing inside the next 15 minutes is folded in before the laden.
      runMatcher('pre-laden confirmation for ' + dep.dock + ' ' + fmtTime(dep.time));
      dep.bol = true;
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (L && L.assignedTo === dep.id && (L.state === 'assigned' || L.state === 'set to move')) {
          L.state = 'set to go';
        }
      });
      log('Bill of lading issued — ' + dep.dock + ' ' + fmtTime(dep.time) + ' (' + dep.lane + '). Dispatch runs from the bill.');
    }

    function doDeparture(dep) {
      dep.departed = true;
      var n = 0, pallets = 0;
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (L && L.assignedTo === dep.id && L.state === 'set to go') {
          L.state = 'shipped'; n++; pallets += L.pallets;
        }
      });
      S.shippedCount += n; S.shippedPallets += pallets;
      if (n) log(dep.dock + ' ' + fmtTime(dep.time) + ' departed — ' + n + ' load(s), ' + pallets + ' pallets shipped.');
    }

    // ----- Watcher: after the close, speak only when the numbers earn it.
    // Two triggers, both from the spec: an alternative saving of at least the
    // placed threshold on an affected load, or rescuing a delivery window
    // the plan the close set would miss. A truck already on its bill is still
    // a candidate — the truck does not change; the correction is load-side.
    function watcherCheck(newLoad) {
      if (!S.closed) return;
      // A Warehouse-choice load rests on the shelf by the operator's
      // own entry decision, so the watcher never proposes it either.
      if (newLoad.deliveryChoice === 'warehouse') return;
      if (newLoad.assignedTo || newLoad.state === 'shipped' || newLoad.state === 'pulled') return;
      S.departures.forEach(function (dep) {
        if (dep.departed) return;
        if (dep.lane !== newLoad.lane) return;
        var plan = S.enginePlans[dep.id];
        if (!plan) return;
        var cap = C.boxes[dep.box].cap;
        var space = cap - plan.pallets;
        if (space <= 0) return;
        var dupe = S.watcher.some(function (w) { return w.loadId === newLoad.id && w.depId === dep.id; });
        if (dupe) return;
        var msg = null;
        if (newLoad.pallets <= space) {
          var before = plan.cost / Math.max(plan.pallets, 1);
          var after = planCost(dep, plan.pallets + newLoad.pallets) / (plan.pallets + newLoad.pallets);
          if (before > 0 && (before - after) / before >= C.watcherThreshold) {
            var pct = Math.round(((before - after) / before) * 100);
            msg = 'A better out-of-process plan exists — adding ' + newLoad.id +
              ' (' + newLoad.business + ', ' + newLoad.pallets + ' pallets) to the ' + dep.dock + ' ' +
              fmtTime(dep.time) + ' ' + dep.lane + ' departure cuts cost per pallet by ' + pct +
              '%. The plan the close set still stands until a human accepts.';
          }
        }
        if (!msg && newLoad.windowEnd <= C.dayEnd && newLoad.windowEnd >= dep.time) {
          var take = Math.min(space, newLoad.pallets);
          if (take >= 4 && (take === newLoad.pallets || newLoad.partialAllowed)) {
            msg = 'A better out-of-process plan exists — the plan the close set leaves ' + newLoad.id +
              ' (' + newLoad.business + ', ' + newLoad.lane + ') behind past its delivery window. Putting ' +
              take + ' of its ' + newLoad.pallets + ' pallets on the ' + dep.dock + ' ' + fmtTime(dep.time) +
              ' departure rescues the window. The plan the close set still stands until a human accepts.';
          }
        }
        if (msg) {
          S.watcher.push({ msg: msg, loadId: newLoad.id, depId: dep.id, status: 'pending' });
          log('Watcher: ' + msg);
        }
      });
    }

    // ----- Production tick -----
    function tick(dt) {
      S.now += dt;
      S.machines.forEach(function (machine) {
        var o = machine.current;
        if (!o) return;
        o.progress += o.rate * dt;
        o.materialsIn += dt * C.materialsInPerMinute;
        o.recyclingOut += dt * C.recyclingOutPerMinute;
        if (!o.alerted85 && o.progress >= S.settings.alertPublish) {
          o.alerted85 = true;
          var ready = S.now + (1 - o.progress) / o.rate;
          var loadFields = {
            business: o.business, lane: o.lane, pallets: o.pallets,
            windowStart: o.windowStart, windowEnd: o.windowEnd,
            partialAllowed: o.partialAllowed, readyTime: ready,
            source: 'production', state: 'projected', orderId: o.id, orderNo: o.orderNo
          };
          // Entry stamps ride the order onto its load: Choice 2 for
          // where the load goes after processing, plus the typed
          // address where the operator entered one. Seeded orders
          // carry neither field, so their loads stay exactly as before.
          if (o.deliveryChoice) loadFields.deliveryChoice = o.deliveryChoice;
          if (o.address) loadFields.address = o.address;
          var load = addLoad(loadFields);
          o.loadId = load.id;
          log('85% alert — ' + machine.id + ' (' + o.business + ', ' + o.lane + '): projected ready ' + fmtTime(ready) + ' published to the matcher.');
          runMatcher('85% alert');
        }
        if (!o.alerted95 && o.progress >= S.settings.alertFinal) {
          o.alerted95 = true;
          var fin = S.now + (1 - o.progress) / o.rate;
          var l2 = o.loadId ? S.loads[o.loadId] : null;
          if (l2 && (l2.state === 'projected' || l2.state === 'calculated')) {
            l2.readyTime = fin;
            if (l2.state === 'projected') l2.state = 'calculated';
          }
          log('95% — ' + machine.id + ' run ending shortly: final ready-time calculation ' + fmtTime(fin) + '.');
          runMatcher('95% final calculation');
          if (l2) watcherCheck(l2);
        }
        if (o.progress >= 1) {
          var done = o.loadId ? S.loads[o.loadId] : null;
          if (done && (done.state === 'projected' || done.state === 'calculated')) {
            done.state = 'inventory'; done.readyTime = S.now; done.ageDays = 0;
          }
          log(machine.id + ' finished ' + o.business + ' (' + o.pallets + ' pallets). Materials in ' +
            Math.round(o.materialsIn) + ' units, recycling out ' + Math.round(o.recyclingOut) + ' units for the run.');
          machine.current = machine.queue.shift() || null;
          if (machine.current) { machine.current.progress = 0; }
          runMatcher('run finished');
          if (done) watcherCheck(done);
        }
      });
      if (!S.closeLogged && S.now >= C.closeTime) { S.closeLogged = true; doClose(); }
      // (7) Common orders and runs: a standing daily run, placed on its
      //     recurring pattern — it completes mid-afternoon, after the close.
      if (!S.commonRunDone && S.now >= commonRun.completesAt) {
        S.commonRunDone = true;
        var cr = addLoad({
          business: commonRun.business, lane: commonRun.lane, pallets: commonRun.pallets,
          windowStart: commonRun.windowStart, windowEnd: commonRun.windowEnd,
          partialAllowed: commonRun.partialAllowed,
          readyTime: S.now, source: 'common run', state: 'inventory'
        });
        log('Common run completed — Liberty Beverages, DC / Baltimore, 8 pallets, window to ' + fmtTime(cr.windowEnd) + '.');
        watcherCheck(cr);
      }
      S.departures.forEach(function (dep) {
        if (!dep.preLadenDone && S.now >= dep.time - C.preLadenMinutes && S.now < dep.time) doPreLaden(dep);
        if (!dep.departed && S.now >= dep.time) doDeparture(dep);
      });
    }

    // ----- Wrenches -----
    function hotOrder() {
      var target = S.machines.slice().sort(function (a, b) { return a.queue.length - b.queue.length; })[0];
      var o = makeOrder(target.id);
      o.business = 'RUSH — ' + o.business;
      o.rate = o.rate * 1.6;
      target.queue.unshift(o);
      log('Wrench: hot order ' + o.id + ' (' + o.business + ', ' + o.lane + ', ' + o.pallets +
        ' pallets) skips the line on ' + target.id + '. Ready times behind it shift.');
      runMatcher('hot order');
      return o;
    }

    function pullOrder() {
      var running = S.machines.filter(function (m) { return m.current; });
      if (!running.length) return null;
      var machine = running[Math.floor(rnd() * running.length)];
      var o = machine.current;
      if (o.loadId && S.loads[o.loadId]) {
        var L = S.loads[o.loadId];
        L.state = 'pulled'; L.assignedTo = null;
      }
      log('Wrench: order ' + o.id + ' (' + o.business + ') pulled from ' + machine.id +
        '. Its pallets leave the plan; the matcher backfills from inventory first.');
      machine.current = machine.queue.shift() || null;
      if (machine.current) machine.current.progress = 0;
      runMatcher('order pulled');
      return o;
    }

    // ----- The human decides: watcher proposals are accepted or ignored,
    //        and the decision is logged either way -----
    function watcherDecision(idx, accept) {
      var w = S.watcher[idx];
      if (!w || w.status !== 'pending') return;
      var dep = S.departures.filter(function (d) { return d.id === w.depId; })[0];
      var load = S.loads[w.loadId];
      if (accept && dep && load && !dep.departed) {
        w.status = 'accepted';
        var plan0 = S.enginePlans[dep.id] || { fill: 0, cost: 0, pallets: 0 };
        var space = C.boxes[dep.box].cap - plan0.pallets;
        var moving = load;
        if (load.pallets > space && space >= 4 && load.partialAllowed) {
          // Partial rescue: part of the load moves; the rest stays behind.
          var partLoad = addLoad({
            business: load.business, lane: load.lane, pallets: space,
            windowStart: load.windowStart, windowEnd: load.windowEnd,
            partialAllowed: load.partialAllowed, ageDays: load.ageDays,
            readyTime: load.readyTime, source: load.source, partialOf: load.id
          });
          if (load.orderId) partLoad.orderId = load.orderId;
          if (load.orderNo != null) partLoad.orderNo = load.orderNo;
          if (load.deliveryChoice) partLoad.deliveryChoice = load.deliveryChoice;
          if (load.address) partLoad.address = load.address;
          load.pallets -= space;
          moving = partLoad;
        }
        moving.assignedTo = dep.id;
        moving.state = dep.bol ? 'set to go' : 'set to move';
        plan0.pallets += moving.pallets;
        plan0.cost = planCost(dep, plan0.pallets);
        plan0.fill = plan0.pallets / C.boxes[dep.box].cap;
        S.enginePlans[dep.id] = plan0;
        log('Watcher proposal accepted by the operator — ' + moving.id + ' joins the ' + dep.dock + ' ' + fmtTime(dep.time) + ' departure.');
      } else if (accept && dep && dep.departed) {
        w.status = 'moot';
        log('Watcher proposal arrived too late to use — that departure has already left.');
      } else {
        w.status = 'ignored';
        log('Watcher proposal ignored by the operator — the plan the close set stands.');
      }
    }

    // ----- Operator-placed variables -----
    // The operator creates an entry and places it. A placed order enters the
    // same Warehouse Inventory set the seeded day uses; a placed departure
    // enters the Dock and Trailer Schedule; placed thresholds and rates set
    // this run's alert and costing inputs. Every placement re-runs the
    // matcher, and after the close the watcher judges the new entry against
    // the plan the close set — the same path a wrench travels. The placed
    // variables create the equation, and the equation resolves again.
    function placeOrder(fields) {
      // The order number: the operator may enter one in any manner, or
      // leave it out — the day's own run then assigns the next unused
      // number. A number already on the board is refused outright:
      // nothing is placed, so no order ever shares a number.
      var entered = fields.orderNumber;
      if (entered != null) {
        entered = Number(entered);
        if (!isFinite(entered) || orderNumberInUse(entered)) return null;
      }
      // A received load is ready when it is entered — finish time is
      // a calculated output, never an entry input. An API caller may
      // still pass a ready time explicitly; the form no longer does.
      var load = addLoad({
        orderNo: entered != null ? entered : takeOrderNo(),
        business: fields.business,
        lane: fields.lane,
        pallets: fields.pallets,
        weightPerPallet: fields.weightPerPallet || null,
        weightTotal: fields.weightPerPallet ? fields.weightPerPallet * fields.pallets : null,
        volumeGallons: fields.volumeGallons || null,
        chemicalForm: fields.chemicalForm || null,
        chemicalAmount: fields.chemicalAmount || null,
        windowStart: fields.windowStart != null ? fields.windowStart : S.now,
        windowEnd: fields.windowEnd,
        partialAllowed: !!fields.partialAllowed,
        readyTime: fields.readyTime != null ? fields.readyTime : S.now,
        ageDays: 0,
        source: 'placed',
        state: 'inventory'
      });
      // A typed address governs for this order; an empty one stores
      // nothing, so the company directory resolves the address at
      // display time.
      if (fields.address) load.address = fields.address;
      // The placed order also joins the manual pool: it is finished
      // inventory the operator put on the floor, so the by-hand plan
      // gets to use it too, under the manual rules.
      S.manualLoads.push({ key: load.id, lane: load.lane, pallets: load.pallets, ageDays: 0 });
      log('Variable placed — order ' + load.id + ' (' + load.business + ', ' + load.lane + ', ' +
        load.pallets + ' pallets, ready ' + fmtTime(load.readyTime) + '). The equation resolves again.');
      runMatcher('operator placed an order');
      watcherCheck(load);
      return load;
    }

    // Choice 1 at entry: the machine. An entered order joins the line
    // on the machine the operator names, runs through processing like
    // any other order, and carries Choice 2 with it — warehouse or
    // shipping — for the moment its load exists. The number follows
    // the same entry rules as a placed finished order: any manner,
    // never repeated. A refused number places nothing.
    function placeProductionOrder(fields) {
      var machine = null;
      S.machines.forEach(function (m) { if (m.id === fields.machineId) machine = m; });
      if (!machine) return null;
      var entered = fields.orderNumber;
      if (entered != null) {
        entered = Number(entered);
        if (!isFinite(entered) || orderNumberInUse(entered)) return null;
      }
      var order = {
        id: nextId('O'),
        orderNo: entered != null ? entered : takeOrderNo(),
        machineId: machine.id,
        business: fields.business,
        lane: fields.lane,
        pallets: fields.pallets,
        windowStart: fields.windowStart != null ? fields.windowStart : S.now,
        windowEnd: fields.windowEnd,
        partialAllowed: !!fields.partialAllowed,
        rate: 0.006,
        progress: 0,
        loadId: null,
        alerted85: false,
        alerted95: false,
        materialsIn: 0,
        recyclingOut: 0,
        deliveryChoice: fields.deliveryChoice === 'warehouse' ? 'warehouse' : 'shipping'
      };
      if (fields.address) order.address = fields.address;
      if (machine.current) machine.queue.push(order);
      else machine.current = order;
      log('Variable placed — production order ' + order.id + ' (' + order.business + ', ' + order.lane + ', ' +
        order.pallets + ' pallets) joins the line on ' + machine.id + '. The equation resolves again.');
      return order;
    }

    function placeDeparture(fields) {
      var dep = {
        id: nextId('D'), dock: fields.dock, time: fields.time,
        lane: fields.lane, box: fields.box,
        bol: false, departed: false, preLadenDone: false, placed: true
      };
      S.departures.push(dep);
      S.departures.sort(function (a, b) { return a.time - b.time; });
      // The placed departure also joins the manual plan as one more
      // truck the by-hand planner gets to fill.
      S.manualDeps.push({ key: dep.id, lane: dep.lane, box: dep.box, time: dep.time });
      log('Variable placed — departure ' + dep.dock + ' ' + fmtTime(dep.time) + ' (' + dep.lane + ', ' +
        C.boxes[dep.box].label + '). The equation resolves again.');
      runMatcher('operator placed a departure');
      return dep;
    }

    function placeSettings(fields) {
      if (fields.alertPublish != null) S.settings.alertPublish = fields.alertPublish;
      if (fields.alertFinal != null) S.settings.alertFinal = fields.alertFinal;
      if (fields.fuelSurchargePct != null) S.settings.fuelSurchargePct = fields.fuelSurchargePct;
      log('Variables placed — alert thresholds now ' + Math.round(S.settings.alertPublish * 100) + '% and ' +
        Math.round(S.settings.alertFinal * 100) + '%, fuel surcharge now ' +
        Math.round(S.settings.fuelSurchargePct * 100) + '%. The equation resolves again.');
      runMatcher('operator placed thresholds and rates');
      return S.settings;
    }

    // The morning fill is the day's first calculation. A caller that
    // needs the day exactly as placed — the seed exporter — can hold it
    // back with { deferMatcher: true }; every other caller gets it.
    if (!(options && options.deferMatcher)) runMatcher('morning fill');

    return {
      config: C,
      state: S,
      tick: tick,
      runMatcher: runMatcher,
      hotOrder: hotOrder,
      pullOrder: pullOrder,
      watcherDecision: watcherDecision,
      placeOrder: placeOrder,
      placeProductionOrder: placeProductionOrder,
      placeDeparture: placeDeparture,
      placeSettings: placeSettings,
      health: health,
      fmtTime: fmtTime,
      addLoad: addLoad
    };
  }

  var api = { createEngine: createEngine, CONFIG: CONFIG, fmtTime: fmtTime, COMMON_RUN: COMMON_RUN, COMPANY_ADDRESSES: COMPANY_ADDRESSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LoadEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
