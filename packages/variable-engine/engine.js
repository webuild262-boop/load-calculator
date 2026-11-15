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
    machines: 5,
    gates: ['G1', 'G2']
  };

  var LANES = Object.keys(CONFIG.laneRates);
  var BUSINESSES = ['Acme Packaging', 'BlueLine Foods', 'Garden State Apparel',
    'Metro Pharma', 'Hudson Home Goods', 'Liberty Beverages'];

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

  // ---------- Engine ----------
  function createEngine(seed) {
    var rnd = mulberry32(seed || 262);
    var uid = 1;
    function nextId(prefix) { return prefix + (uid++); }

    var S = {
      now: CONFIG.dayStart,
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
      hotUsed: false
    };

    function log(text) {
      S.log.push({ t: S.now, text: text });
      if (S.log.length > 60) S.log.shift();
    }

    function addLoad(fields) {
      var load = Object.assign({
        id: nextId('L'), state: 'inventory', readyTime: CONFIG.dayStart,
        ageDays: 0, assignedTo: null, source: 'inventory', partialOf: null
      }, fields);
      S.loads[load.id] = load;
      S.loadOrder.push(load.id);
      return load;
    }

    function makeOrder(machineId) {
      var lane = LANES[Math.floor(rnd() * LANES.length)];
      return {
        id: nextId('O'),
        machineId: machineId,
        business: BUSINESSES[Math.floor(rnd() * BUSINESSES.length)],
        lane: lane,
        pallets: 10 + Math.floor(rnd() * 16), // 10–25
        windowStart: CONFIG.dayStart + 120 + Math.floor(rnd() * 240),
        windowEnd: CONFIG.dayStart + 480 + Math.floor(rnd() * 240),
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
        windowStart: CONFIG.dayStart + Math.floor(rnd() * 180),
        windowEnd: CONFIG.dayStart + 420 + Math.floor(rnd() * 300),
        partialAllowed: rnd() < 0.6,
        ageDays: Math.floor(rnd() * 5),
        source: 'inventory'
      });
    }
    // (2) Production: machines with running orders and a queue behind each.
    for (var m = 0; m < CONFIG.machines; m++) {
      var machine = { id: 'M' + (m + 1), current: makeOrder('M' + (m + 1)), queue: [] };
      machine.current.progress = 0.15 + rnd() * 0.5;
      machine.queue.push(makeOrder(machine.id));
      machine.queue.push(makeOrder(machine.id));
      S.machines.push(machine);
    }
    // (3) Gate and trailer schedule: the plant sets the pickups; the engine
    //     builds each load backward from its scheduled cutoff.
    var sched = [
      ['G1', 9 * 60 + 30, '45T'], ['G2', 10 * 60 + 15, '45T'],
      ['G1', 11 * 60, '26B'], ['G2', 12 * 60, '26B'],
      ['G1', 12 * 60 + 45, '45T'], ['G2', 13 * 60 + 45, '45T'],
      ['G1', 14 * 60 + 30, '45T'], ['G2', 15 * 60 + 30, '45T']
    ];
    sched.forEach(function (row, idx) {
      S.departures.push({
        id: nextId('D'), gate: row[0], time: row[1],
        lane: LANES[idx % LANES.length], box: row[2],
        bol: false, departed: false, preLadenDone: false
      });
    });

    // ----- Core calculations -----
    function loadDuration(load, boxKey) {
      var b = CONFIG.boxes[boxKey];
      return load.pallets * b.loadRate + b.setup;
    }

    function planCost(dep, pallets) {
      return CONFIG.laneRates[dep.lane][dep.box] * (1 + CONFIG.fuelSurchargePct) + CONFIG.handlingPerPallet * pallets;
    }

    function candidateLoads(dep) {
      var out = [];
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (!L) return;
        if (L.state !== 'inventory' && L.state !== 'projected' && L.state !== 'calculated') return;
        if (L.assignedTo) return;
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
      var cap = CONFIG.boxes[dep.box].cap;
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
      var cap = CONFIG.boxes[dep.box].cap;
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
              c.load.pallets = rest;
              partLoad.state = 'assigned'; partLoad.assignedTo = dep.id;
            } else {
              c.load.state = 'assigned'; c.load.assignedTo = dep.id;
            }
          });
          S.enginePlans[dep.id] = {
            fill: best.pallets / CONFIG.boxes[dep.box].cap,
            cost: planCost(dep, best.pallets), pallets: best.pallets, strategy: bestName
          };
        } else {
          delete S.enginePlans[dep.id];
        }
      });
      computeBaseline();
      if (reason) log('Matcher re-ran (' + reason + ') — ' + S.variations + ' variations evaluated so far.');
    }

    // Engine-off comparison: first-fit over finished inventory only —
    // no projections, no partials, no ready-time math.
    function computeBaseline() {
      var used = {}, fillSum = 0, fillN = 0, costSum = 0, palletSum = 0;
      S.departures.forEach(function (dep) {
        if (dep.departed) return;
        var cap = CONFIG.boxes[dep.box].cap, pallets = 0;
        var pool = S.loadOrder.map(function (id) { return S.loads[id]; })
          .filter(function (L) {
            return L && !used[L.id] && L.source === 'inventory' &&
              (L.state === 'inventory') && L.lane === dep.lane;
          })
          .sort(function (a, b) { return b.ageDays - a.ageDays; });
        pool.forEach(function (L) {
          if (pallets + L.pallets <= cap) { used[L.id] = true; pallets += L.pallets; }
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
      runMatcher('pre-laden confirmation for ' + dep.gate + ' ' + fmtTime(dep.time));
      dep.bol = true;
      S.loadOrder.forEach(function (id) {
        var L = S.loads[id];
        if (L && L.assignedTo === dep.id && (L.state === 'assigned' || L.state === 'set to move')) {
          L.state = 'set to go';
        }
      });
      log('Bill of lading issued — ' + dep.gate + ' ' + fmtTime(dep.time) + ' (' + dep.lane + '). Dispatch runs from the bill.');
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
      if (n) log(dep.gate + ' ' + fmtTime(dep.time) + ' departed — ' + n + ' load(s), ' + pallets + ' pallets shipped.');
    }

    // ----- Watcher: after the close, speak only when the numbers earn it.
    // Two triggers, both from the spec: an alternative saving of at least the
    // placed threshold on an affected load, or rescuing a delivery window
    // the plan the close set would miss. A truck already on its bill is still
    // a candidate — the truck does not change; the correction is load-side.
    function watcherCheck(newLoad) {
      if (!S.closed) return;
      if (newLoad.assignedTo || newLoad.state === 'shipped' || newLoad.state === 'pulled') return;
      S.departures.forEach(function (dep) {
        if (dep.departed) return;
        if (dep.lane !== newLoad.lane) return;
        var plan = S.enginePlans[dep.id];
        if (!plan) return;
        var cap = CONFIG.boxes[dep.box].cap;
        var space = cap - plan.pallets;
        if (space <= 0) return;
        var dupe = S.watcher.some(function (w) { return w.loadId === newLoad.id && w.depId === dep.id; });
        if (dupe) return;
        var msg = null;
        if (newLoad.pallets <= space) {
          var before = plan.cost / Math.max(plan.pallets, 1);
          var after = planCost(dep, plan.pallets + newLoad.pallets) / (plan.pallets + newLoad.pallets);
          if (before > 0 && (before - after) / before >= CONFIG.watcherThreshold) {
            var pct = Math.round(((before - after) / before) * 100);
            msg = 'A better out-of-process plan exists — adding ' + newLoad.id +
              ' (' + newLoad.business + ', ' + newLoad.pallets + ' pallets) to the ' + dep.gate + ' ' +
              fmtTime(dep.time) + ' ' + dep.lane + ' departure cuts cost per pallet by ' + pct +
              '%. The plan the close set still stands until a human accepts.';
          }
        }
        if (!msg && newLoad.windowEnd <= CONFIG.dayEnd && newLoad.windowEnd >= dep.time) {
          var take = Math.min(space, newLoad.pallets);
          if (take >= 4 && (take === newLoad.pallets || newLoad.partialAllowed)) {
            msg = 'A better out-of-process plan exists — the plan the close set leaves ' + newLoad.id +
              ' (' + newLoad.business + ', ' + newLoad.lane + ') behind past its delivery window. Putting ' +
              take + ' of its ' + newLoad.pallets + ' pallets on the ' + dep.gate + ' ' + fmtTime(dep.time) +
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
        o.materialsIn += dt * 2;
        o.recyclingOut += dt * 0.7;
        if (!o.alerted85 && o.progress >= CONFIG.alertPublish) {
          o.alerted85 = true;
          var ready = S.now + (1 - o.progress) / o.rate;
          var load = addLoad({
            business: o.business, lane: o.lane, pallets: o.pallets,
            windowStart: o.windowStart, windowEnd: o.windowEnd,
            partialAllowed: o.partialAllowed, readyTime: ready,
            source: 'production', state: 'projected'
          });
          o.loadId = load.id;
          log('85% alert — ' + machine.id + ' (' + o.business + ', ' + o.lane + '): projected ready ' + fmtTime(ready) + ' published to the matcher.');
          runMatcher('85% alert');
        }
        if (!o.alerted95 && o.progress >= CONFIG.alertFinal) {
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
      if (!S.closeLogged && S.now >= CONFIG.closeTime) { S.closeLogged = true; doClose(); }
      // (7) Common orders and runs: a standing daily run, placed on its
      //     recurring pattern — it completes mid-afternoon, after the close.
      if (!S.commonRunDone && S.now >= 14 * 60 + 5) {
        S.commonRunDone = true;
        var cr = addLoad({
          business: 'Liberty Beverages (common run)', lane: 'DC / Baltimore', pallets: 8,
          windowStart: 14 * 60, windowEnd: 15 * 60 + 55, partialAllowed: true,
          readyTime: S.now, source: 'common run', state: 'inventory'
        });
        log('Common run completed — Liberty Beverages, DC / Baltimore, 8 pallets, window to ' + fmtTime(cr.windowEnd) + '.');
        watcherCheck(cr);
      }
      S.departures.forEach(function (dep) {
        if (!dep.preLadenDone && S.now >= dep.time - CONFIG.preLadenMinutes && S.now < dep.time) doPreLaden(dep);
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
        var space = CONFIG.boxes[dep.box].cap - plan0.pallets;
        var moving = load;
        if (load.pallets > space && space >= 4 && load.partialAllowed) {
          // Partial rescue: part of the load moves; the rest stays behind.
          var partLoad = addLoad({
            business: load.business, lane: load.lane, pallets: space,
            windowStart: load.windowStart, windowEnd: load.windowEnd,
            partialAllowed: load.partialAllowed, ageDays: load.ageDays,
            readyTime: load.readyTime, source: load.source, partialOf: load.id
          });
          load.pallets -= space;
          moving = partLoad;
        }
        moving.assignedTo = dep.id;
        moving.state = dep.bol ? 'set to go' : 'set to move';
        plan0.pallets += moving.pallets;
        plan0.cost = planCost(dep, plan0.pallets);
        plan0.fill = plan0.pallets / CONFIG.boxes[dep.box].cap;
        S.enginePlans[dep.id] = plan0;
        log('Watcher proposal accepted by the operator — ' + moving.id + ' joins the ' + dep.gate + ' ' + fmtTime(dep.time) + ' departure.');
      } else if (accept && dep && dep.departed) {
        w.status = 'moot';
        log('Watcher proposal arrived too late to use — that departure has already left.');
      } else {
        w.status = 'ignored';
        log('Watcher proposal ignored by the operator — the plan the close set stands.');
      }
    }

    runMatcher('morning fill');

    return {
      config: CONFIG,
      state: S,
      tick: tick,
      runMatcher: runMatcher,
      hotOrder: hotOrder,
      pullOrder: pullOrder,
      watcherDecision: watcherDecision,
      health: health,
      fmtTime: fmtTime,
      addLoad: addLoad
    };
  }

  var api = { createEngine: createEngine, CONFIG: CONFIG, fmtTime: fmtTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LoadEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
