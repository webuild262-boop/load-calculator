/*
 * DELIVERY — the freight application.
 * Its question: what goes out, in which box, from which dock, at what time, at what cost?
 * Reads the variable engine; holds no production logic.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  // One number per order, everywhere the board shows it: a load that
  // descends from a production order carries that order's number —
  // the engine stamps it at creation — so the order's number
  // displays, written as Order # with the number itself. A load
  // with no number starts as a load, so its load id displays as
  // it stands.
  function idLabel(id) {
    return id.charAt(0) === 'O' ? 'Order #' + id.slice(1) : id;
  }
  function displayId(L) {
    if (L.orderNo != null) return 'Order #' + L.orderNo;
    return idLabel(L.orderId || L.id);
  }

  // The identity block: an order number is tied to the company at its
  // address. A carrier holding a typed address shows that address.
  // Any other carrier resolves to the company directory by company
  // name — the directory is placed demo data on the engine module.
  // A company the directory does not hold shows as not on file; no
  // address is invented at render time.
  function resolveAddress(carrier) {
    if (!carrier) return null;
    if (carrier.address) return carrier.address;
    var dir = (window.LoadEngine && window.LoadEngine.COMPANY_ADDRESSES) || {};
    var name = carrier.business || '';
    if (dir[name]) return dir[name];
    var base = name.replace(/\s*\([^)]*\)\s*$/, '');
    if (base !== name && dir[base]) return dir[base];
    return null;
  }
  function addressText(carrier) {
    return resolveAddress(carrier) || 'address not on file';
  }

  function hueFor(health) {
    // Sliding green-yellow-red shade scale: health is an OUTPUT of the calculation.
    return Math.round(health * 125); // 0 = red, ~60 = yellow, 125 = green
  }

  function renderBoard(engine, el) {
    var S = engine.state;
    var html = '';
    S.loadOrder.forEach(function (id) {
      var L = S.loads[id];
      if (!L || L.state === 'pulled') return;
      var h = engine.health(L);
      var color = 'hsl(' + hueFor(h) + ', 75%, 52%)';
      html += '<span class="dot" title="' + displayId(L) + ' · ' + esc(L.business) + ' · ' + esc(L.lane) +
        ' · ' + L.pallets + ' pallets · ' + L.state + '" style="background:' + color + '"></span>';
    });
    el.innerHTML = html || '<span class="dim">No loads yet.</span>';
  }

  function renderDepartures(engine, el) {
    var S = engine.state, C = engine.config;
    var html = '';
    S.departures.forEach(function (dep) {
      var plan = S.enginePlans[dep.id];
      var box = C.boxes[dep.box];
      var assigned = S.loadOrder.map(function (id) { return S.loads[id]; })
        .filter(function (L) { return L && L.assignedTo === dep.id && L.state !== 'pulled'; });
      var pallets = assigned.reduce(function (s, L) { return s + L.pallets; }, 0);
      var fill = Math.round((pallets / box.cap) * 100);
      var status = dep.departed ? 'departed' : (dep.bol ? 'bill of lading issued' : (S.closed ? 'set at the close' : 'planning'));
      html += '<div class="dep">';
      html += '<div class="dep-head"><strong>' + dep.dock + ' · ' + engine.fmtTime(dep.time) + '</strong>' +
        '<span>' + esc(dep.lane) + ' · ' + box.label + ' (' + box.cap + ' pallets) · ' + status + '</span></div>';
      html += '<div class="bar"><div class="bar-fill ship" style="width:' + fill + '%"></div></div>';
      html += '<div class="dep-meta">' + fill + '% full · ' + pallets + '/' + box.cap + ' pallets' +
        (plan ? ' · $' + plan.cost + ' · $' + (plan.cost / Math.max(plan.pallets, 1)).toFixed(2) + '/pallet' : ' · no plan yet') + '</div>';
      if (assigned.length) {
        html += '<div class="dep-loads">' + assigned.map(function (L) {
          return displayId(L) + ' ' + esc(L.business) + ' (' + L.pallets + (L.partialOf ? ', partial' : '') + ') — ' + L.state;
        }).join('<br>') + '</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  function renderCounters(engine, el) {
    var S = engine.state;
    var plans = Object.keys(S.enginePlans).map(function (k) { return S.enginePlans[k]; });
    var engFill = 0, engCost = 0, engPallets = 0;
    plans.forEach(function (p) { engFill += p.fill; engCost += p.cost; engPallets += p.pallets; });
    var engFillPct = plans.length ? Math.round((engFill / plans.length) * 100) : 0;
    var engCpp = engPallets ? (engCost / engPallets).toFixed(2) : '—';
    var baseFillPct = S.baseline.fillN ? Math.round((S.baseline.fillSum / S.baseline.fillN) * 100) : 0;
    var baseCpp = S.baseline.palletSum ? (S.baseline.costSum / S.baseline.palletSum).toFixed(2) : '—';
    el.innerHTML =
      '<div class="counter"><span class="c-num">' + S.variations.toLocaleString() + '</span><span class="c-lbl">variations evaluated</span></div>' +
      '<div class="counter"><span class="c-num">' + engFillPct + '%</span><span class="c-lbl">engine avg fill</span></div>' +
      '<div class="counter"><span class="c-num">$' + engCpp + '</span><span class="c-lbl">engine cost / pallet</span></div>' +
      '<div class="counter off"><span class="c-num">' + baseFillPct + '%</span><span class="c-lbl">manual avg fill</span></div>' +
      '<div class="counter off"><span class="c-num">$' + baseCpp + '</span><span class="c-lbl">manual cost / pallet</span></div>' +
      '<div class="counter"><span class="c-num">' + S.shippedPallets + '</span><span class="c-lbl">pallets shipped</span></div>';
  }

  function renderLog(engine, logEl, watchEl) {
    var S = engine.state;
    logEl.innerHTML = S.log.slice(-9).map(function (e) {
      return '<div><span class="log-t">' + engine.fmtTime(e.t) + '</span> ' + esc(e.text) + '</div>';
    }).join('');
    watchEl.innerHTML = S.watcher.length
      ? S.watcher.map(function (w, i) {
          var buttons = w.status === 'pending'
            ? ' <button onclick="window.__watcherDecision(' + i + ', true)">Accept</button>' +
              ' <button onclick="window.__watcherDecision(' + i + ', false)">Ignore</button>'
            : ' <em>(' + w.status + ')</em>';
          return '<div class="watcher-item">⚠ ' + esc(w.msg) + buttons + '</div>';
        }).join('')
      : '<div class="dim">Watcher quiet — no better out-of-process plan has met the threshold.</div>';
  }

  // The forward delivery view, read-only over engine state — nothing
  // here writes to the engine. Upcoming departures come back in the
  // order they go out: by time, then dock, then id. Each row carries
  // the same assigned loads, fill, plan, and status wording the
  // departure cards show.
  function deliverySchedule(engine) {
    var S = engine.state, C = engine.config;
    var rows = [];
    S.departures.forEach(function (dep) {
      if (dep.departed) return;
      var box = C.boxes[dep.box];
      var assigned = S.loadOrder.map(function (id) { return S.loads[id]; })
        .filter(function (L) { return L && L.assignedTo === dep.id && L.state !== 'pulled'; });
      var pallets = assigned.reduce(function (s, L) { return s + L.pallets; }, 0);
      rows.push({
        dep: dep, box: box, assigned: assigned, pallets: pallets,
        fill: Math.round((pallets / box.cap) * 100),
        plan: S.enginePlans[dep.id] || null,
        status: dep.bol ? 'bill of lading issued' : (S.closed ? 'set at the close' : 'planning')
      });
    });
    rows.sort(function (a, b) {
      return (a.dep.time - b.dep.time) ||
        (a.dep.dock < b.dep.dock ? -1 : a.dep.dock > b.dep.dock ? 1 : 0) ||
        (a.dep.id < b.dep.id ? -1 : a.dep.id > b.dep.id ? 1 : 0);
    });
    return rows;
  }

  // The delivery queue panel: every departure still to go out, in the
  // order it goes out, with the loads on each truck. Loads with no
  // truck yet sit below the queue proper.
  function renderQueue(engine, el) {
    var S = engine.state;
    var rows = deliverySchedule(engine);
    var html = '';
    if (rows.length) {
      html += rows.map(function (r, i) {
        var position = i === 0 ? 'next out' : 'in line — position ' + (i + 1);
        var line = '<div class="q-row"><span class="q-ready">' + engine.fmtTime(r.dep.time) + '</span> · ' +
          esc(r.dep.lane) + ' · ' + r.dep.dock + ' · ' + esc(r.box.label) + ' · ' + r.fill + '% full · ' +
          r.pallets + ' pallets' + (r.plan ? ' · $' + r.plan.cost : '') + ' · ' + r.status +
          ' · <span class="q-status">' + position + '</span>';
        if (r.assigned.length) {
          line += ' · on it: ' + r.assigned.map(function (L) {
            return displayId(L) + ' ' + esc(L.business) + ' (' + L.pallets + ')';
          }).join(', ');
        }
        return line + '</div>';
      }).join('');
    } else {
      html += '<span class="dim">Nothing left to go out.</span>';
    }
    var waiting = S.loadOrder.map(function (id) { return S.loads[id]; })
      .filter(function (L) { return L && !L.assignedTo && L.state !== 'shipped' && L.state !== 'pulled'; });
    if (waiting.length) {
      html += '<div class="q-wait-head">Waiting for a departure — planned, not yet on a truck</div>';
      html += waiting.map(function (L) {
        return '<div class="q-row">' + displayId(L) + ' ' + esc(L.business) + ' · ' + L.pallets +
          ' pallets · ' + esc(L.lane) + ' · ' + L.state + '</div>';
      }).join('');
    }
    el.innerHTML = html;
  }

  // ----- Shelved loads: where each load sits, and where it goes out -----
  // A load's location is derived from engine state at render time —
  // nothing here stores a location, and no one types one in. A load
  // assigned to a departure that has not left sits at staging for that
  // departure's dock. A finished load with no departure sits on the
  // warehouse shelf. A shipped load is out, and a pulled load left the
  // plan: neither appears. A load still in production — projected, or
  // calculated with its finish still ahead — is not shelved yet.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) {
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  // The demo day is the viewer's today. A warehouse load finished
  // ageDays before today; a load finished during the day finished
  // today. One rule covers both: today minus the load's age.
  function finishedDate(L) {
    var d = new Date();
    d.setDate(d.getDate() - (L.ageDays || 0));
    return fmtDate(d);
  }
  // The delivery date is the date of the load's delivery deadline.
  // Every deadline in the demo falls on the demo day, so that date is
  // today. A load with no window carries no delivery date at all —
  // the row says so rather than inventing one.
  function deliveryDate(L) {
    if (L.windowEnd == null) return null;
    return fmtDate(new Date());
  }

  function shelfGroups(engine) {
    var S = engine.state;
    var depById = {};
    S.departures.forEach(function (d) { depById[d.id] = d; });
    var idxOf = {};
    S.loadOrder.forEach(function (id, i) { idxOf[id] = i; });
    var staging = {};
    var shelf = [];
    S.loadOrder.forEach(function (id) {
      var L = S.loads[id];
      if (!L || L.state === 'shipped' || L.state === 'pulled') return;
      var dep = L.assignedTo ? depById[L.assignedTo] : null;
      if (dep && !dep.departed) {
        (staging[dep.dock] = staging[dep.dock] || []).push({ load: L, dep: dep });
      } else if (L.state === 'inventory' ||
                 (L.state === 'calculated' && L.readyTime <= S.now)) {
        shelf.push(L);
      }
    });
    Object.keys(staging).forEach(function (dock) {
      staging[dock].sort(function (a, b) {
        return (a.dep.time - b.dep.time) || (idxOf[a.load.id] - idxOf[b.load.id]);
      });
    });
    shelf.sort(function (a, b) {
      return ((b.ageDays || 0) - (a.ageDays || 0)) || (idxOf[a.id] - idxOf[b.id]);
    });
    return { staging: staging, shelf: shelf };
  }

  // One shelved load's row: its one number, its business, its pallets,
  // its lane, its finished date, its delivery date, its state. A
  // staging row leads with the pickup time; a shelf row leads with
  // the load's number, since no pickup exists yet.
  function shelfRow(engine, entry) {
    var L = entry.load;
    var del = deliveryDate(L);
    var tail = ' · ' + esc(addressText(L)) + ' · ' + L.pallets + ' pallets · ' + esc(L.lane) +
      ' · finished ' + finishedDate(L) +
      (del ? ' · Delivery ' + del : ' · delivery date not specified') +
      ' · <span class="q-status">' + L.state + '</span>';
    if (entry.dep) {
      return '<div class="q-row"><span class="q-ready">' + engine.fmtTime(entry.dep.time) +
        '</span> · ' + displayId(L) + ' ' + esc(L.business) + tail + '</div>';
    }
    return '<div class="q-row"><span class="q-ready">' + displayId(L) + '</span> ' +
      esc(L.business) + tail + '</div>';
  }

  // The shelved loads panel: staging at each dock first, in pickup
  // order, then the warehouse shelf, oldest on top.
  function renderShelf(engine, el) {
    var groups = shelfGroups(engine);
    var docks = (engine.config.docks && engine.config.docks.length)
      ? engine.config.docks.slice() : ['D1', 'D2'];
    Object.keys(groups.staging).forEach(function (dock) {
      if (docks.indexOf(dock) === -1) docks.push(dock);
    });
    var html = '';
    docks.forEach(function (dock) {
      var name = /^D\d+$/.test(dock) ? 'Dock ' + dock.slice(1) : dock;
      html += '<div class="shelf-head">Staging — ' + esc(name) + '</div>';
      var rows = groups.staging[dock] || [];
      html += rows.length
        ? rows.map(function (en) { return shelfRow(engine, en); }).join('')
        : '<div class="q-row"><span class="dim">Nothing staged at this dock.</span></div>';
    });
    html += '<div class="shelf-head">Warehouse shelf</div>';
    html += groups.shelf.length
      ? groups.shelf.map(function (L) { return shelfRow(engine, { load: L, dep: null }); }).join('')
      : '<div class="q-row"><span class="dim">The shelf is empty.</span></div>';
    el.innerHTML = html;
  }

  // The all-orders view joins both applications in one list. A live
  // order on a machine speaks for its load; a load with no live order
  // speaks for itself. Partial splits fold into their root load, so
  // every order appears exactly once. Rows with a pickup sort by
  // pickup time; the rest sort by projected ready time behind them.
  function allOrders(engine) {
    var S = engine.state;
    var sched = (window.ProcessingUI && window.ProcessingUI.productionSchedule)
      ? window.ProcessingUI.productionSchedule(engine) : [];
    var schedById = {};
    sched.forEach(function (r) { schedById[r.order.id] = r; });
    var depById = {};
    S.departures.forEach(function (d) { depById[d.id] = d; });

    function rootOf(L) {
      var seen = {};
      while (L && L.partialOf && S.loads[L.partialOf] && !seen[L.id]) {
        seen[L.id] = true;
        L = S.loads[L.partialOf];
      }
      return L;
    }
    var groups = {};
    S.loadOrder.forEach(function (id) {
      var L = S.loads[id];
      if (!L) return;
      var root = rootOf(L);
      (groups[root.id] = groups[root.id] || []).push(L);
    });
    function pickupOf(root) {
      var loads = root ? (groups[root.id] || []) : [];
      var deps = [];
      loads.forEach(function (L) {
        if (L.assignedTo && L.state !== 'pulled' && depById[L.assignedTo] &&
            deps.indexOf(depById[L.assignedTo]) === -1) {
          deps.push(depById[L.assignedTo]);
        }
      });
      deps.sort(function (a, b) { return a.time - b.time; });
      return deps.length ? { dep: deps[0], count: deps.length } : null;
    }

    var rows = [];
    var liveLoadIds = {};
    S.machines.forEach(function (m) {
      var orders = (m.current ? [m.current] : []).concat(m.queue);
      orders.forEach(function (o) {
        var root = o.loadId ? rootOf(S.loads[o.loadId]) : null;
        if (root) liveLoadIds[root.id] = true;
        var sr = schedById[o.id];
        rows.push({
          key: 'N:' + o.orderNo, label: 'Order #' + o.orderNo,
          id: o.id, business: o.business, address: addressText(o), lane: o.lane, pallets: o.pallets,
          position: sr ? sr.position : null, ready: sr ? sr.ready : null,
          origin: o.machineId, deadline: o.windowEnd, loadId: o.loadId || null,
          pickup: pickupOf(root), finished: false, state: null, nextPickup: false
        });
      });
    });
    Object.keys(groups).forEach(function (rootId) {
      if (liveLoadIds[rootId]) return;
      var root = S.loads[rootId];
      var pallets = groups[rootId].reduce(function (s, L) { return s + L.pallets; }, 0);
      var origin = root.source === 'production' ? 'from production'
        : (root.source === 'common run' ? 'common run' : 'from inventory');
      rows.push({
        key: root.orderNo != null ? 'N:' + root.orderNo : 'L:' + root.id,
        label: root.orderNo != null ? 'Order #' + root.orderNo : root.id,
        id: root.orderId || root.id, business: root.business, address: addressText(root), lane: root.lane, pallets: pallets,
        position: null, ready: root.readyTime, pickup: pickupOf(root),
        origin: origin, deadline: root.windowEnd, loadId: null,
        finished: true, state: root.state, nextPickup: false
      });
    });

    var nextTime = null;
    rows.forEach(function (r) {
      if (r.pickup && !r.pickup.dep.departed && (nextTime === null || r.pickup.dep.time < nextTime)) {
        nextTime = r.pickup.dep.time;
      }
    });
    rows.forEach(function (r) {
      r.nextPickup = !!(r.pickup && !r.pickup.dep.departed && r.pickup.dep.time === nextTime);
    });

    rows.sort(function (a, b) {
      var ka = a.pickup ? a.pickup.dep.time : null;
      var kb = b.pickup ? b.pickup.dep.time : null;
      if (ka !== null && kb !== null && ka !== kb) return ka - kb;
      if (ka !== null && kb === null) return -1;
      if (ka === null && kb !== null) return 1;
      if (ka === null && kb === null) {
        var ra = a.ready != null ? a.ready : Infinity;
        var rb = b.ready != null ? b.ready : Infinity;
        if (ra !== rb) return ra - rb;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return rows;
  }

  // The all-orders panel: one trail per order, under one number
  // from start to finish. The row leads with the order's number,
  // then the path from its origin to its dock, its lane, its
  // deadline, its pickup time, with its production state last.
  // A live order joins its load through loadId — a field the engine
  // sets at the 85% alert. A finished order's load carries the
  // order's number as a stamp, written at creation, so the finished
  // row keys on that same number; a load with no stamp starts as
  // a load, so its row keys on the load id.
  function renderOrders(engine, el) {
    var rows = allOrders(engine);
    if (!rows.length) {
      el.innerHTML = '<span class="dim">No orders in the day.</span>';
      return;
    }
    el.innerHTML = rows.map(function (r) {
      var status;
      if (!r.finished) {
        status = r.position === 0 ? 'processing'
          : (r.position === 1 ? 'next in line'
          : (r.position != null ? 'in line — position ' + r.position : 'in production'));
        if (r.ready != null) status += ', ready ' + engine.fmtTime(r.ready);
      } else {
        status = r.state === 'shipped' ? 'shipped'
          : (r.state === 'pulled' ? 'pulled' : 'finished — ' + r.state);
      }
      var dock = r.pickup ? r.pickup.dep.dock : 'dock not set yet';
      var pickup;
      if (!r.pickup) {
        pickup = 'pickup not set yet';
      } else {
        pickup = (r.nextPickup ? 'next pickup — ' : 'pickup ') + engine.fmtTime(r.pickup.dep.time) +
          (r.pickup.count > 1 ? ' · split across ' + r.pickup.count + ' pickups' : '');
      }
      return '<div class="q-row"><span class="q-ready">' + r.label + '</span> · ' + esc(r.business) +
        ' · ' + esc(r.address) + ' · ' + r.pallets + ' pallets · ' + r.origin + ' → ' + dock +
        ' · ' + esc(r.lane) + ' · deadline ' + engine.fmtTime(r.deadline) +
        ' · ' + pickup + ' · <span class="q-status">' + status + '</span></div>';
    }).join('');
  }

  window.DeliveryUI = {
    renderBoard: renderBoard,
    renderDepartures: renderDepartures,
    renderCounters: renderCounters,
    renderLog: renderLog,
    deliverySchedule: deliverySchedule,
    renderQueue: renderQueue,
    shelfGroups: shelfGroups,
    shelfRow: shelfRow,
    renderShelf: renderShelf,
    allOrders: allOrders,
    renderOrders: renderOrders
  };
})();
