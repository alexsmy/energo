/* Просмотр журнала сбора закупок */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? esc(iso) : d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  };

  async function load() {
    const res = await fetch('data/collect-log.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  function render(runs) {
    const runSel = $('runFilter'), srcSel = $('sourceFilter');
    const prevRun = runSel.value, prevSrc = srcSel.value;
    runSel.innerHTML = '<option value="">Все запуски</option>' + runs.map((r, i) =>
      '<option value="' + i + '">' + fmt(r.started) + ' · ' + esc(r.mode || '') + '</option>').join('');
    const sources = [...new Set(runs.flatMap(r => (r.entries || []).map(e => e.source)))].filter(Boolean);
    srcSel.innerHTML = '<option value="">Все источники</option>' + sources.map(s =>
      '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    runSel.value = prevRun; srcSel.value = prevSrc;
    $('runCount').textContent = runs.length;

    const shown = (runSel.value === '' ? runs : [runs[+runSel.value]]).filter(Boolean);
    $('runs').innerHTML = shown.map((r, idx) => {
      const entries = (r.entries || []).filter(e => !srcSel.value || e.source === srcSel.value);
      const s = r.summary || {};
      const bad = (r.entries || []).filter(e => e.ok === false).length;
      const rows = entries.map(e => {
        const url = e.url && /^https?:\/\//i.test(e.url)
          ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener" title="' + esc(e.url) + '">открыть</a>'
          : '—';
        return '<tr><td class="t-mut">' + fmt(e.ts) + '</td>' +
          '<td>' + esc(e.source) + '</td>' +
          '<td>' + esc(e.query) + '</td>' +
          '<td>' + (e.ok ? '<span class="t-badge t-badge--ok">успех</span>' : '<span class="t-badge t-badge--bad">ошибка</span>') + '</td>' +
          '<td>' + esc(e.http || '—') + '</td>' +
          '<td>' + esc(e.ms != null ? e.ms + ' мс' : '—') + '</td>' +
          '<td>' + esc(e.bytes != null ? e.bytes : '—') + '</td>' +
          '<td>' + esc(e.records != null ? e.records : '—') + '</td>' +
          '<td>' + esc(e.kept != null ? e.kept : '—') + '</td>' +
          '<td>' + esc(e.phase || '—') + '</td>' +
          '<td>' + esc(e.budget || '—') + '</td>' +
          '<td>' + esc(e.error || '') + '</td>' +
          '<td>' + url + '</td></tr>';
      }).join('');
      return '<section style="margin:16px 0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px">' +
        '<h2 style="font-size:15px">' + fmt(r.started) + ' · ' + esc(r.mode || '') + '</h2>' +
        '<p style="font-size:12px;color:var(--muted);margin:5px 0 10px">' +
          'Источник: <b>' + esc(s.source || '—') + '</b> · всего <b>' + esc(s.total || 0) + '</b> · ' +
          'действующих <b>' + esc(s.active || 0) + '</b> · завершённых <b>' + esc(s.archive || 0) + '</b> · ' +
          'совпало с реестром <b>' + esc(s.matchedOrg || 0) + '</b> · ошибок <b>' + esc(s.errors || bad) + '</b>' +
          (s.budget ? ' · бюджет запросов: <b>' + esc(Object.entries(s.budget).map(([k, v]) => k + ' ' + v.used + '/' + v.limit).join(', ')) + '</b>' : '') +
        '</p>' +
        '<div class="t-table-wrap"><table class="table t-table" style="min-width:1500px">' +
        '<thead><tr><th>Время</th><th>Источник</th><th>Запрос</th><th>Статус</th><th>HTTP</th><th>ms</th><th>Байт</th><th>Найдено</th><th>Взято</th><th>Режим</th><th>Лимит</th><th>Ошибка</th><th>URL</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></section>';
    }).join('') || '<p style="color:var(--muted)">Нет записей журнала.</p>';
  }

  async function init() {
    try { render(await load()); }
    catch (e) { $('runs').innerHTML = '<p style="color:#a13333">Не удалось загрузить журнал: ' + esc(e.message || e) + '</p>'; }
    $('refreshLog').addEventListener('click', init);
    $('runFilter').addEventListener('change', () => render(cached));
    $('sourceFilter').addEventListener('change', () => render(cached));
  }
  let cached = [];
  const _load = load;
  load = async function () { cached = await _load(); return cached; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
