/* Energo Visits dashboard behaviours: live poll, sorting, chart, toasts. */
(function () {
  'use strict';
  var S = window.EV || {};

  function setText(sel, value) {
    var text = String(value);
    document.querySelectorAll(sel).forEach(function (el) {
      if (el.textContent !== text) { el.textContent = text; }
    });
  }

  var busy = false;
  var lastPoll = 0;
  function poll() {
    if (busy || document.visibilityState !== 'visible' || !S.ajax || !S.nonce) { return; }
    busy = true;
    var body = new URLSearchParams({ action: 'ev_live_poll', _ajax_nonce: S.nonce, from: S.from || '', to: S.to || '' });
    fetch(S.ajax, { method: 'POST', credentials: 'same-origin', body: body })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.success || !j.data) { return; }
        setText('[data-ev-kpi="online"]', j.data.online);
        setText('[data-ev-live="count"]', j.data.online);
        setText('[data-ev-live="ago"]', '0 с назад');
        setText('[data-ev-updated]', 'Обновлено только что');
        lastPoll = Date.now();
      })
      .catch(function () { /* silent: next tick will retry */ })
      .finally(function () { busy = false; });
  }
  if (S.ajax) {
    setInterval(poll, S.poll || 15000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { poll(); } });
  }

  /* Generic client-side table sorting. */
  document.querySelectorAll('.ev-sortable').forEach(function (table) {
    var dir = {};
    table.querySelectorAll('th button[data-sort]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var col = btn.dataset.sort;
        var key = col + '|' + (dir[col] === 'asc' ? 'desc' : 'asc');
        dir[col] = key.split('|')[1];
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (a, b) {
          var av = (a.cells[col] && a.cells[col].dataset.value) || a.cells[col].textContent.trim();
          var bv = (b.cells[col] && b.cells[col].dataset.value) || b.cells[col].textContent.trim();
          var an = parseFloat(av.replace(/\s/g, '')), bn = parseFloat(bv.replace(/\s/g, ''));
          if (!isNaN(an) && !isNaN(bn)) { return dir[col] === 'asc' ? an - bn : bn - an; }
          return dir[col] === 'asc' ? String(av).localeCompare(String(bv), 'ru') : String(bv).localeCompare(String(av), 'ru');
        });
        rows.forEach(function (row) { body.appendChild(row); });
        table.querySelectorAll('th').forEach(function (th) { th.removeAttribute('aria-sort'); });
        btn.closest('th').setAttribute('aria-sort', dir[col] === 'asc' ? 'ascending' : 'descending');
      });
    });
  });

  /* uPlot time series from the JSON emitted by PHP. */
  var holder = document.getElementById('evChart');
  var dataNode = document.getElementById('evChartData');
  if (holder && dataNode && window.uPlot) {
    try {
      var data = JSON.parse(dataNode.textContent || '[]');
      var xs = data.map(function (row) { return row[0]; });
      var ys = data.map(function (row) { return row[1]; });
      var series = [
        { label: 'Дата' },
        { label: 'События', stroke: getComputedStyle(document.documentElement).getPropertyValue('--ev-accent').trim() || '#0d6b85', fill: 'rgba(13,107,133,.10)', width: 2 }
      ];
      var chart = new uPlot({
        width: holder.clientWidth || 800,
        height: 210,
        scales: { x: { time: true } },
        axes: [
          { stroke: getComputedStyle(document.documentElement).getPropertyValue('--ev-muted').trim() || '#5d7180', grid: { stroke: getComputedStyle(document.documentElement).getPropertyValue('--ev-line').trim() || '#e0eaf0' } },
          { stroke: getComputedStyle(document.documentElement).getPropertyValue('--ev-muted').trim() || '#5d7180', grid: { stroke: getComputedStyle(document.documentElement).getPropertyValue('--ev-line').trim() || '#e0eaf0' } }
        ],
        legend: { show: false },
        cursor: { drag: { x: true, y: false } },
        series: series
      }, [xs, ys], holder);
      if (window.ResizeObserver) { new ResizeObserver(function () { chart.setSize({ width: holder.clientWidth, height: 210 }); }).observe(holder); }
    } catch (e) { /* chart is optional */ }
  }

  /* Toast auto-hide. */
  var toast = document.querySelector('.ev-toast');
  if (toast) { setTimeout(function () { toast.remove(); }, 3500); }

  /* Copy current filtered URL. */
  var copy = document.getElementById('evCopyLink');
  if (copy) {
    copy.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          var t = document.createElement('div');
          t.className = 'ev-toast';
          t.setAttribute('role', 'status');
          t.textContent = 'Ссылка на фильтр скопирована';
          document.body.appendChild(t);
          setTimeout(function () { t.remove(); }, 2500);
        });
      }
    });
  }
})();
