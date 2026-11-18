/*
 * PROCESSING — the production application.
 * Its question: what runs, in what order, finishing when?
 * Reads the variable engine; holds no delivery logic.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  // The forward production view, read-only over engine state — nothing
  // here writes to the engine. The engine's own projection for the run
  // on a machine now is now + (1 - progress) / rate: the same figure
  // the 85% alert publishes and the machine card shows. A queued order
  // starts when the runs ahead of it on its machine finish, and it runs
  // from zero, so its projected ready time is the finish ahead of it
  // plus its own full run (1 / rate). Rows come back in the order the
  // orders come off the machines: by projected ready time.
  function productionSchedule(engine) {
    var S = engine.state;
    var rows = [];
    S.machines.forEach(function (machine) {
      var cursor = S.now;
      if (machine.current) {
        var o = machine.current;
        cursor = S.now + (1 - o.progress) / o.rate;
        rows.push({ order: o, machineId: machine.id, position: 0, ready: cursor });
      }
      machine.queue.forEach(function (q, i) {
        cursor = cursor + 1 / q.rate;
        rows.push({ order: q, machineId: machine.id, position: i + 1, ready: cursor });
      });
    });
    rows.sort(function (a, b) {
      return (a.ready - b.ready) ||
        (a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : 0) ||
        (a.position - b.position);
    });
    return rows;
  }

  function render(engine, el) {
    var S = engine.state;
    var readyById = {};
    productionSchedule(engine).forEach(function (r) { readyById[r.order.id] = r.ready; });
    var html = '';
    S.machines.forEach(function (machine) {
      var o = machine.current;
      html += '<div class="machine">';
      html += '<div class="machine-head"><strong>' + machine.id + '</strong>';
      if (o) {
        var pct = Math.min(100, Math.round(o.progress * 100));
        var ready = o.progress > 0 ? S.now + (1 - o.progress) / o.rate : null;
        html += '<span class="m-order">' + esc(o.business) + ' · ' + esc(o.lane) + ' · ' + o.pallets + ' pallets</span></div>';
        html += '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div>' +
          '<span class="bar-mark" style="left:85%"></span><span class="bar-mark" style="left:95%"></span></div>';
        html += '<div class="m-meta">' + pct + '% · projected ready ' + (ready ? engine.fmtTime(ready) : '—') +
          ' · materials in ' + Math.round(o.materialsIn) + ' · recycling out ' + Math.round(o.recyclingOut) + '</div>';
      } else {
        html += '<span class="m-order">idle</span></div>';
      }
      if (machine.queue.length) {
        html += '<div class="m-queue">Next: ' + machine.queue.map(function (q) {
          return esc(q.business) + ' (' + q.pallets + ' pallets · ' + esc(q.lane) +
            ' · ready ' + engine.fmtTime(readyById[q.id]) + ')';
        }).join(' → ') + '</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  // The production queue panel: every order in production, in the order
  // it comes off the machines, with its projected ready time. Orders
  // from the Upcoming Orders set that have not reached a machine yet
  // (passed in as `waiting`, when the day was loaded from data sets)
  // sit below the queue proper with their delivery window — no ready
  // time is projected for them, because no machine has taken them yet.
  function renderQueue(engine, el, waiting) {
    var rows = productionSchedule(engine);
    var html = '';
    if (rows.length) {
      html += rows.map(function (r) {
        var o = r.order;
        var status = r.position === 0 ? 'running'
          : (r.position === 1 ? 'next in line' : 'in line — position ' + r.position);
        return '<div class="q-row"><span class="q-ready">' + engine.fmtTime(r.ready) + '</span> · ' +
          (o.orderNo != null ? 'Order #' + o.orderNo : esc(o.id)) + ' ' + esc(o.business) + ' · ' + r.machineId + ' · ' + o.pallets +
          ' pallets · ' + esc(o.lane) + ' · <span class="q-status">' + status + '</span></div>';
      }).join('');
    } else {
      html += '<span class="dim">Nothing in production.</span>';
    }
    if (waiting && waiting.length) {
      html += '<div class="q-wait-head">Waiting to be placed — in the Upcoming Orders set, not yet on a machine</div>';
      html += waiting.map(function (w) {
        return '<div class="q-row">' + esc(w.id) + ' ' + esc(w.business) + ' · ' + w.pallets +
          ' pallets · ' + esc(w.lane) + ' · delivery window ' + engine.fmtTime(w.windowStart) +
          ' – ' + engine.fmtTime(w.windowEnd) + '</div>';
      }).join('');
    }
    el.innerHTML = html;
  }

  window.ProcessingUI = { render: render, renderQueue: renderQueue, productionSchedule: productionSchedule };
})();
