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
      html += '<span class="dot" title="' + L.id + ' · ' + esc(L.business) + ' · ' + esc(L.lane) +
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
          return L.id + ' ' + esc(L.business) + ' (' + L.pallets + (L.partialOf ? ', partial' : '') + ') — ' + L.state;
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

  window.DeliveryUI = {
    renderBoard: renderBoard,
    renderDepartures: renderDepartures,
    renderCounters: renderCounters,
    renderLog: renderLog
  };
})();
