/* Энергореестр РФ — вкладка «Закупки» (аудит ЭТП и поиск тендеров) */
(function () {
  'use strict';

  const D = window.TENDER_DATA || {};
  let records = (D.tenders && D.tenders.records) || [];
  const keywords = (D.keywords && D.keywords.keywords) || [];
  const enterprises = (D.enterprises && D.enterprises.items) || [];
  const platforms = (D.etps && D.etps.platforms) || [];
  const allEntities = D.allEntities || [];
  const settings = D.settings || {};
  let status = D.status || {};
  const $ = (id) => document.getElementById(id);

  const state = {
    q: '', enterprise: '', enterpriseText: '', from: '', to: '', source: '', keyword: '',
    view: 'cards', sort: 'date', pane: 'tenders',
    mode: settings.defaultMode === 'archive' ? 'archive' : 'active'
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const etpMap = Object.fromEntries(platforms.map(p => [p.code, p]));
  const entMap = Object.fromEntries(enterprises.map(e => [e.id, e]));
  const plural = (n) => (n % 10 === 1 && n % 100 !== 11) ? 'запись' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'записи' : 'записей';

  function fmtDate(s) {
    if (!s) return '—';
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : esc(s);
  }
  function priceNum(s) {
    const n = Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  function badge(text, cls) { return '<span class="t-badge t-badge--' + esc(cls) + '">' + esc(text) + '</span>'; }

  /* Подсветка совпадающего ключевого слова (с учётом окончаний: турбин/турбины, лопат/лопаток). */
  function highlight(raw, terms) {
    const stems = [...new Set((terms || [])
      .map(t => norm(t)).filter(t => t.length >= 4)
      .map(t => t.replace(/[^a-zа-яё0-9]/gi, '').slice(0, 5)).filter(Boolean))];
    if (!stems.length) return esc(raw);
    const re = new RegExp('(' + stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')[a-zа-яё]*', 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(String(raw || ''))) !== null) {
      out += esc(String(raw).slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + esc(String(raw || '').slice(last));
  }

  /* ---------- фильтрация ---------- */
  function entMatches(r, e) {
    if (!e) return true;
    if ((r.enterpriseIds || []).includes(e.id)) return true;
    const text = norm(r.title + ' ' + r.customer);
    return [e.query, ...(e.aliases || [])].some(n => text.includes(norm(n)));
  }

  function filtered() {
    const q = norm(state.q);
    const k = norm(state.keyword);
    let list = records.filter(r => {
      if (state.mode === 'archive' && r.phase !== 'archive') return false;
      if (state.mode === 'active' && r.phase === 'archive') return false;
      if (q && !norm(r.title + ' ' + r.customer + ' ' + (r.keywords || []).join(' ')).includes(q)) return false;
      if (state.enterprise) {
        const ent = allEntities.find(e => e.id === state.enterprise);
        const ok = r.matchedOrgId === state.enterprise ||
          (r.enterpriseIds || []).includes(state.enterprise) ||
          (ent && norm(r.customer + ' ' + (r.matchedOrgName || '')).includes(norm(ent.name)));
        if (!ok) return false;
      } else if (state.enterpriseText && !norm(r.customer + ' ' + (r.matchedOrgName || '') + ' ' + (r.title || '')).includes(norm(state.enterpriseText))) {
        return false;
      }
      if (state.from && String(r.published || '') < state.from) return false;
      if (state.to && String(r.published || '') > state.to) return false;
      if (state.source && r.etp !== state.source) return false;
      if (k && !(r.keywords || []).some(x => norm(x) === k) &&
          !norm(r.title + ' ' + r.customer).includes(k)) return false;
      return true;
    });
    const cmp = {
      date: (a, b) => String(b.published || '').localeCompare(String(a.published || '')),
      name: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'),
      company: (a, b) => String(a.customer || '').localeCompare(String(b.customer || ''), 'ru'),
      price: (a, b) => priceNum(b.price) - priceNum(a.price)
    }[state.sort] || (() => 0);
    return list.sort(cmp);
  }

  /* ---------- вывод ---------- */
  function entNames(r) {
    const ids = [...new Set([...(r.enterpriseIds || []), r.matchedOrgId].filter(Boolean))];
    return ids.map(id => (entMap[id] && entMap[id].name) ||
      ((allEntities.find(e => e.id === id) || {}).name) || id).join(', ');
  }

  function cardHtml(r) {
    const src = etpMap[r.etp];
    const terms = [...(r.keywords || []), r.matchedOrgName].filter(Boolean);
    const kws = (r.keywords || []).slice(0, 5).map(k => '<span class="t-chip t-chip--mini">' + esc(k) + '</span>').join('');
    const ent = entNames(r);
    return '<article class="t-card">' +
      '<div class="t-card__head"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + highlight(r.title || r.id, terms) + '</a>' +
      (src ? badge(src.name, 'src') : badge(r.etp || 'источник', 'src')) + '</div>' +
      '<div class="t-card__body">' +
        '<div><span class="t-label">Заказчик:</span> ' + highlight(r.customer || '—', terms) + '</div>' +
        (ent ? '<div><span class="t-label">Предприятие:</span> ' + esc(ent) + '</div>' : '') +
        '<div class="t-card__grid">' +
          '<div><span class="t-label">Опубликовано:</span> ' + fmtDate(r.published) + '</div>' +
          '<div><span class="t-label">Заявки до:</span> ' + fmtDate(r.deadline) + '</div>' +
          '<div><span class="t-label">Цена:</span> ' + esc(r.price || '—') + '</div>' +
          '<div><span class="t-label">Номер:</span> ' + esc(r.id) + '</div>' +
        '</div>' +
        (kws ? '<div class="t-chips t-chips--mini">' + kws + '</div>' : '') +
      '</div></article>';
  }

  function rowHtml(r) {
    const src = etpMap[r.etp];
    const terms = [...(r.keywords || []), r.matchedOrgName].filter(Boolean);
    return '<tr>' +
      '<td class="t-mut">' + fmtDate(r.published) + '</td>' +
      '<td><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + highlight(r.title || r.id, terms) + '</a></td>' +
      '<td>' + highlight(r.customer || '—', terms) + '</td>' +
      '<td>' + esc(entNames(r) || '—') + '</td>' +
      '<td>' + esc(r.price || '—') + '</td>' +
      '<td>' + esc(src ? src.name : r.etp) + '</td>' +
      '</tr>';
  }

  function renderEtps() {
    const rows = platforms.map(p => {
      const access = p.ok === true ? 'open' : (p.http === 403 || p.http === 503 ? 'blocked' : 'unreachable');
      const a = p.access === 'open' || access === 'open' ? 'open' : access;
      const cls = a === 'open' ? 'ok' : (a === 'blocked' ? 'warn' : 'bad');
      const label = a === 'open' ? 'доступна' : (a === 'blocked' ? 'ограничен' : 'недоступна');
      const link = p.urlTemplate && p.urlTemplate.includes('{')
        ? p.urlTemplate.replace('{q}', encodeURIComponent(state.q || 'турбина')).replace('{company}', encodeURIComponent(state.q || ''))
        : p.url;
      const kw = p.publicSearch === true ? 'да' : (p.keywordParam || '—');
      return '<article class="t-etp">' +
        '<div class="t-etp__head"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' + badge(label, cls) + '</div>' +
        '<div class="t-etp__meta">' +
          '<span>поиск без входа: <b>' + (p.publicSearch === true ? 'да' : (p.publicSearch === 'partial' ? 'частично' : 'нет/неизвестно')) + '</b></span>' +
          '<span>ключевое слово: <b>' + esc(kw) + '</b></span>' +
          '<span>надёжность: <b>' + esc(p.reliability || '—') + '</b></span>' +
          '<span>проверка: <b>' + esc(p.ms != null ? p.ms + ' мс / HTTP ' + p.http : 'нет данных') + '</b></span>' +
        '</div>' +
        '<p>' + esc(p.notes || '') + '</p>' +
        '<a class="btn btn--ghost btn--sm" href="' + esc(link) + '" target="_blank" rel="noopener">Открыть поиск</a>' +
      '</article>';
    }).join('');
    $('tEtps').innerHTML = rows;
  }

  function modeHint() {
    const el = $('tModeHint');
    if (!el) return;
    const m = (status.modes || []).find(x => x.phase === state.mode);
    const days = m ? m.depthDays : (state.mode === 'archive' ? settings.archiveDepthDays : settings.activeDepthDays);
    el.textContent = state.mode === 'archive'
      ? '· завершённые за ' + (days || 'всё время') + (days ? ' дн.' : '')
      : '· действующие';
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('[data-tmode]').forEach(b => b.classList.toggle('is-active', b.dataset.tmode === mode));
    modeHint();
    render();
  }

  function render() {
    modeHint();
    if (state.pane === 'etps') { renderEtps(); return; }
    const list = filtered();
    $('tCount').textContent = list.length;
    $('tCountWord').textContent = plural(list.length);
    $('tEmpty').hidden = list.length > 0;
    $('tCards').hidden = state.view !== 'cards';
    $('tTableWrap').hidden = state.view !== 'table';
    if (state.view === 'cards') $('tCards').innerHTML = list.map(cardHtml).join('');
    else $('tTbody').innerHTML = list.map(rowHtml).join('');
  }

  /* ---------- инициализация ---------- */
  function fillSelect(el, pairs, placeholder) {
    el.innerHTML = '<option value="">' + esc(placeholder) + '</option>' +
      pairs.map(([v, t]) => '<option value="' + esc(v) + '">' + esc(t) + '</option>').join('');
  }

  function renderKeywords() {
    $('tKeywords').innerHTML = '<button class="t-chip is-active" data-kw="" type="button">Все</button>' +
      keywords.map(k => '<button class="t-chip" data-kw="' + esc(k) + '" type="button">' + esc(k) + '</button>').join('');
    document.querySelectorAll('#tKeywords .t-chip').forEach(b => {
      b.classList.toggle('is-active', norm(b.dataset.kw) === norm(state.keyword));
      b.addEventListener('click', () => {
        state.keyword = b.dataset.kw === state.keyword ? '' : b.dataset.kw;
        $('tLinkQuery').value = state.keyword || state.q;
        renderKeywords(); render();
      });
    });
  }

  function setPane(pane) {
    state.pane = pane;
    document.querySelectorAll('.t-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tview === pane));
    $('tTendersPane').hidden = pane !== 'tenders';
    $('tEtpsPane').hidden = pane !== 'etps';
    render();
  }

  function selectEntity(id) {
    const e = allEntities.find(x => x.id === id);
    if (!e) return;
    state.enterprise = e.id;
    state.enterpriseText = e.name;
    $('tEnterprise').value = e.name;
    $('tEnterpriseSuggest').hidden = true;
    $('tLinkQuery').value = e.name;
    render();
  }

  function renderSuggest() {
    const box = $('tEnterpriseSuggest');
    const q = norm($('tEnterprise').value);
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const list = allEntities.filter(e =>
      norm(e.name + ' ' + e.full + ' ' + e.holding + ' ' + e.region + ' ' + e.inn).includes(q)
    ).slice(0, 12);
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = list.map(e => '<button type="button" data-ent="' + esc(e.id) + '">' +
      '<b>' + esc(e.name) + '</b><small>' + esc([e.holding, e.region, e.type].filter(Boolean).join(' · ')) + '</small></button>').join('');
    box.hidden = false;
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => selectEntity(b.dataset.ent)));
  }

  function bind() {
    const input = (id, key, evt) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(evt || 'change', () => { state[key] = el.value; render(); });
    };
    input('tQ', 'q', 'input');
    $('tEnterprise').addEventListener('input', () => {
      state.enterpriseText = $('tEnterprise').value;
      state.enterprise = '';
      renderSuggest();
      render();
    });
    $('tEnterprise').addEventListener('blur', () => {
      setTimeout(() => { $('tEnterpriseSuggest').hidden = true; }, 180);
    });
    input('tDateFrom', 'from');
    input('tDateTo', 'to');
    input('tSource', 'source');
    input('tSort', 'sort');

    $('tReset').addEventListener('click', () => {
      Object.assign(state, { q: '', enterprise: '', enterpriseText: '', from: '', to: '', source: '', keyword: '', view: 'cards', sort: 'date' });
      ['tQ', 'tEnterprise', 'tDateFrom', 'tDateTo', 'tSource', 'tSort'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('tEnterpriseSuggest').hidden = true;
      $('tSort').value = 'date';
      $('tLinkQuery').value = '';
      document.querySelectorAll('[data-tcards]').forEach(b => b.classList.toggle('is-active', b.dataset.tcards === 'cards'));
      renderKeywords(); render();
    });

    document.querySelectorAll('[data-tcards]').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('[data-tcards]').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.view = b.dataset.tcards;
      render();
    }));

    document.querySelectorAll('.t-tab').forEach(b => b.addEventListener('click', () => setPane(b.dataset.tview)));
    document.querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tmode)));

    $('tSearch').addEventListener('click', async () => {
      const btn = $('tSearch');
      const prevText = btn.textContent;
      btn.textContent = 'Обновляю…';
      btn.disabled = true;
      try {
        const ts = Date.now();
        const [rRes, sRes] = await Promise.all([
          fetch('data/tenders.json?ts=' + ts, { cache: 'no-store' }),
          fetch('data/tenders-status.json?ts=' + ts, { cache: 'no-store' })
        ]);
        if (rRes.ok) {
          const data = await rRes.json();
          records = (data.records || []).slice();
          const sources = [...new Set(records.map(r => r.etp).filter(Boolean))];
          fillSelect($('tSource'), sources.map(c => [c, (etpMap[c] && etpMap[c].name) || c]), 'Все источники');
          $('tSource').value = state.source;
        }
        if (sRes.ok) status = await sRes.json();
        const upd = status.lastRun ? new Date(status.lastRun).toLocaleString('ru-RU') : 'нет данных';
        $('tUpdated').textContent = 'Обновлено: ' + upd + (status.total != null ? ' · закупок: ' + status.total : '');
        $('tWordHint').textContent = 'Выдача обновлена с сервера. Новые слова подхватятся после публикации файла и сбора.';
        render();
      } catch (e) {
        $('tWordHint').textContent = 'Не удалось обновить выдачу: ' + (e.message || e);
      } finally {
        btn.textContent = prevText;
        btn.disabled = false;
      }
    });

    const changeWord = (remove) => {
      const w = $('tNewWord').value.trim();
      if (!w) return;
      const cmd = 'node scripts/keywords.js ' + (remove ? 'remove' : 'add') + ' "' + w + '"';
      $('tWordHint').innerHTML = 'Список хранится в репозитории. Выполните: <code>' + esc(cmd) + '</code> — после публикации слово появится у всех.';
      try { navigator.clipboard.writeText(cmd); } catch (e) { /* noop */ }
    };
    $('tAddWord').addEventListener('click', () => changeWord(false));
    $('tRemoveWord').addEventListener('click', () => changeWord(true));

    $('tOpenSearch').addEventListener('click', () => {
      const p = etpMap[$('tLinkEtp').value];
      const q = $('tLinkQuery').value.trim() || state.keyword || state.q;
      if (!p) return;
      const tpl = p.urlTemplate && p.urlTemplate.includes('{') ? p.urlTemplate : p.url;
      const url = tpl.replace('{q}', encodeURIComponent(q)).replace('{company}', encodeURIComponent(q));
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    $('tLinkQuery').addEventListener('input', () => { /* значение берётся при открытии */ });
  }

  function init() {
    if (!$('tendersView')) return;
    const sources = [...new Set(records.map(r => r.etp).filter(Boolean))];
    fillSelect($('tSource'), sources.map(c => [c, (etpMap[c] && etpMap[c].name) || c]), 'Все источники');
    fillSelect($('tLinkEtp'), platforms.filter(p => p.urlTemplate && p.urlTemplate.includes('{')).map(p => [p.code, p.name]), 'Выберите площадку');
    $('tLinkEtp').value = (platforms.find(p => p.code === 'EIS') || {}).code || '';
    const upd = status.lastRun ? new Date(status.lastRun).toLocaleString('ru-RU') : 'нет данных';
    $('tUpdated').textContent = 'Обновлено: ' + upd + (status.total != null ? ' · закупок: ' + status.total : '');
    $('tVer').textContent = 'v2.0';
    document.querySelectorAll('[data-tmode]').forEach(b => b.classList.toggle('is-active', b.dataset.tmode === state.mode));
    renderKeywords(); bind(); render();
  }

  window.EnergoTenders = {
    onTab(tab) {
      if (tab === 'tenders') {
        if ($('tendersView')) $('tendersView').hidden = false;
        render();
      }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
