/*
 * PROCESSING — the production application.
 * Its question: what runs, in what order, finishing when?
 * Reads the variable engine; holds no shipping logic.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function render(engine, el) {
    var S = engine.state;
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
          return esc(q.business) + ' (' + q.pallets + ')';
        }).join(' → ') + '</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  }

  window.ProcessingUI = { render: render };
})();
