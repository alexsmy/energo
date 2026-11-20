/* Энергореестр РФ — клиентская логика */
(function () {
  'use strict';

  const R = window.REGISTRY || { items: [], etps: [], sources: [], meta: {}, stats: {} };
  const items = R.items;
  const etpMap = Object.fromEntries((R.etps || []).map(e => [e.code, e]));
  const srcMap = Object.fromEntries((R.sources || []).map(s => [s.id, s]));

  const $ = (id) => document.getElementById(id);
  const state = {
    tab: 'all',
    q: '',
    holding: '',
    region: '',
    type: '',
    method: '',
    etp: '',
    onlyOrg: false,
    view: 'cards',
    sort: 'path'
  };

  /* ---------- utils ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

  const SEARCH_FIELDS = [
    ['name', 'Название'], ['full', 'Полное наименование'], ['type', 'Тип'],
    ['activity', 'Деятельность'], ['region', 'Регион'], ['address', 'Адрес'],
    ['phone', 'Телефон'], ['email', 'E-mail'], ['site', 'Сайт'], ['procUrl', 'Раздел закупок'],
    ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН'], ['ceo', 'Руководитель'],
    ['contact', 'Контакт'], ['method', 'Способ закупки'], ['capacity', 'Мощность'],
    ['status', 'Статус'], ['notes', 'Примечание'],
    ['chiefEngineer', 'Главный инженер'], ['chiefDesigner', 'Главный конструктор'],
    ['procContact', 'Ответственный по закупкам'], ['procPhone', 'Телефон закупок'],
    ['procEmail', 'E-mail закупок']
  ];
  let searchIndex = null;
  function getSearchIndex() {
    if (searchIndex) return searchIndex;
    searchIndex = items.map(it => {
      const parts = [];
      const add = (value, label) => {
        const v = String(value == null ? '' : value).trim();
        if (v) parts.push({ value: v, label });
      };
      SEARCH_FIELDS.forEach(([field, label]) => {
        const v = it[field];
        if (Array.isArray(v)) v.forEach(x => add(x, label)); else add(v, label);
      });
      (it.etp || []).forEach(c => add(etpMap[c] ? etpMap[c].name : c, 'ЭТП'));
      (it.sources || []).forEach(s => add(srcMap[s] ? srcMap[s].title : s, 'Источник'));
      add(it.path, 'Структура');
      add(it.holdingName, 'Холдинг');
      return { it, parts, hay: norm(parts.map(p => p.value).join(' ')) };
    });
    return searchIndex;
  }

  function suggestFor(query) {
    const nq = norm(query);
    if (!nq) return [];
    const seen = new Set();
    const out = [];
    for (const rec of getSearchIndex()) {
      for (const p of rec.parts) {
        const key = p.label + '\u0000' + p.value;
        if (seen.has(key)) continue;
        if (!norm(p.value).includes(nq)) continue;
        seen.add(key);
        out.push({ value: p.value, label: p.label });
        if (out.length >= 40) return out;
      }
    }
    return out.sort((a, b) => {
      const ap = norm(a.value).startsWith(nq) ? 0 : 1;
      const bp = norm(b.value).startsWith(nq) ? 0 : 1;
      return ap - bp || a.value.length - b.value.length;
    });
  }
  const isRepair = (i) => i.type === 'ремонт';
  const isOem = (i) => i.type === 'ОЕМ' || i.type === 'инжиниринг';
  const isGen = (i) => !isRepair(i) && !isOem(i);

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  const STATE_KEY = 'energo-registry-state';

  function saveState() {
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
  }

  function restoreState() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); sessionStorage.removeItem(STATE_KEY); } catch (e) { /* noop */ }
    if (!saved) return;
    Object.assign(state, {
      q: saved.q || '', holding: saved.holding || '', region: saved.region || '',
      type: saved.type || '', method: saved.method || '', etp: saved.etp || '',
      onlyOrg: !!saved.onlyOrg,
      view: saved.view === 'table' ? 'table' : 'cards',
      sort: ['path', 'name', 'region'].includes(saved.sort) ? saved.sort : 'path'
    });
    const fields = { q: 'q', fHolding: 'holding', fRegion: 'region', fType: 'type', fMethod: 'method', fEtp: 'etp', sort: 'sort' };
    Object.entries(fields).forEach(([id, key]) => {
      if ($(id)) $(id).value = state[key] || '';
    });
    $('fOnlyOrg').checked = state.onlyOrg;
    document.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === state.view));
  }

  function typeBadge(it) {
    if (it.kind === 'holding') return '<span class="badge badge--holding">холдинг</span>';
    if (isRepair(it)) return '<span class="badge badge--repair">ремонт</span>';
    if (isOem(it)) return '<span class="badge badge--oem">' + esc(it.type) + '</span>';
    if (it.kind === 'plant') return '<span class="badge badge--plant">' + esc(it.type || 'станция') + '</span>';
    return '<span class="badge">' + esc(it.type || 'компания') + '</span>';
  }

  /* ---------- options ---------- */
  function fillSelect(el, values, placeholder) {
    const opts = ['<option value="">' + esc(placeholder) + '</option>'];
    values.forEach(v => opts.push('<option value="' + esc(v) + '">' + esc(v) + '</option>'));
    el.innerHTML = opts.join('');
  }

  function initFilters() {
    const holdings = [...new Set(items.filter(i => i.kind === 'holding').map(i => i.name))].sort((a, b) => a.localeCompare(b, 'ru'));
    fillSelect($('fHolding'), holdings, 'Все');

    const regions = [...new Set(items.map(i => i.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    fillSelect($('fRegion'), regions, 'Все');

    const typeOrder = ['ТЭЦ', 'ГРЭС', 'ГЭС', 'АЭС', 'ТЭС', 'ГеоЭС', 'ВЭС', 'СЭС', 'ремонт', 'ОЕМ', 'инжиниринг', 'холдинг', 'компания', 'филиал'];
    const types = [...new Set(items.map(i => i.type).filter(Boolean))]
      .sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99) || a.localeCompare(b, 'ru'));
    fillSelect($('fType'), types, 'Все');

    const etps = (R.etps || []).map(e => e.name);
    fillSelect($('fEtp'), etps, 'Все');
  }

  /* ---------- filtering ---------- */
  function inTab(it) {
    if (state.tab === 'map') return true;
    if (state.tab === 'gen') return isGen(it);
    if (state.tab === 'rep') return isRepair(it);
    if (state.tab === 'oem') return isOem(it);
    return true;
  }

  function methodMatch(it) {
    const m = norm(it.method);
    if (!m) return false;
    if (state.method === '223') return m.includes('223');
    if (state.method === '44') return m.includes('44-фз');
    if (state.method === 'comp') return /конкур|аукцион|запрос|предложен/.test(m);
    if (state.method === 'direct') return /прямы|единственн|ед\. поставщик|малые закупки/.test(m);
    return true;
  }

  function matches(it) {
    if (!inTab(it)) return false;
    if (state.onlyOrg && it.kind === 'plant') return false;
    if (state.holding && it.holdingName !== state.holding) return false;
    if (state.region && it.region !== state.region) return false;
    if (state.type && it.type !== state.type) return false;
    if (state.method && !methodMatch(it)) return false;
    if (state.etp) {
      const target = (R.etps || []).find(e => e.name === state.etp);
      if (!target || !(it.etp || []).includes(target.code)) return false;
    }
    if (state.q) {
      const rec = getSearchIndex().find(r => r.it === it);
      const hay = rec ? rec.hay : norm(it.name || '');
      const words = norm(state.q).split(/\s+/).filter(Boolean);
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  }

  function sortItems(list) {
    const api = window.EnergoSort;
    const mode = api && api.MODES.includes(state.sort) ? state.sort : 'path';
    return api ? api.sortItems(list, mode) : list.slice();
  }

  /* ---------- rendering ---------- */
  const byId = Object.fromEntries(items.map(i => [i.id, i]));

  /* ---------- map ---------- */
  const LAYERS = [
    { id: 'holding', label: 'Холдинги', color: '#0e3a52', test: i => i.kind === 'holding' },
    { id: 'gen', label: 'Генерация', color: '#1f6f9c', test: i => i.kind !== 'plant' && isGen(i) },
    { id: 'plant', label: 'Станции', color: '#e2701f', test: i => i.kind === 'plant' },
    { id: 'repair', label: 'Ремонт', color: '#7a4a1c', test: i => isRepair(i) },
    { id: 'oem', label: 'ОЕМ / производство', color: '#5b3d91', test: i => isOem(i) }
  ];
  const layerOn = Object.fromEntries(LAYERS.map(l => [l.id, true]));
  const mapState = { map: null, groups: {}, base: {}, baseId: 'osm', ready: false, fitKey: '', pending: null, lastListKey: '', raf: 0 };

  function pinType(it) {
    if (it.kind === 'holding') return ['holding', '★'];
    if (isRepair(it)) return ['repair', '🔧'];
    if (isOem(it)) return ['oem', '🏭'];
    if (it.kind === 'plant') {
      return ({
        'ТЭЦ': ['tec', '🔥'], 'ГРЭС': ['gres', '⚙️'], 'ГЭС': ['ges', '💧'], 'АЭС': ['aes', '☢️'],
        'ТЭС': ['tes', '♨️'], 'ГеоЭС': ['geo', '🌋'], 'ВЭС': ['ves', '🌬️'], 'СЭС': ['ses', '☀️']
      }[it.type]) || ['plant', '⚡'];
    }
    return ['gen', '⚡'];
  }

  function pinIcon(it) {
    const [cls, glyph] = pinType(it);
    const label = esc(it.name);
    return L.divIcon({
      className: 'pin-wrap',
      html: '<div class="pin pin--' + cls + '" title="' + label + '">' + esc(glyph) + '</div>',
      iconSize: [27, 27],
      iconAnchor: [13, 13],
      popupAnchor: [0, -13]
    });
  }

  function popupHTML(it) {
    const par = it.parent ? byId[it.parent] : null;
    const where = [it.city || it.region, par && par.kind !== 'holding' ? par.name : it.holdingName]
      .filter(Boolean).join(' · ');
    return '<div class="pop">' +
      '<div class="pop__type">' + esc(it.type || it.kind) + '</div>' +
      '<div class="pop__name">' + esc(it.name) + '</div>' +
      '<div class="pop__meta">' + esc(where) + '</div>' +
      (it.phone ? '<div class="pop__row">☎ ' + esc(it.phone) + '</div>' : '') +
      (it.email ? '<div class="pop__row">✉ ' + esc(it.email) + '</div>' : '') +
      (it.capacity ? '<div class="pop__row">⚡ ' + esc(it.capacity) + ' МВт</div>' : '') +
      '<button class="pop__btn" type="button" data-open-id="' + esc(it.id) + '">Подробная карточка</button>' +
    '</div>';
  }

  function ensureMap() {
    if (mapState.ready) return;
    if (typeof L === 'undefined') {
      $('mapFallback').hidden = false;
      $('map').style.display = 'none';
      return;
    }
    mapState.ready = true;
    const map = L.map('map', {
      center: [61.5, 95], zoom: 3, minZoom: 2, maxZoom: 13,
      zoomControl: true, worldCopyJump: true, attributionControl: true
    });
    // Базовый слой на данных OSM, но через устойчивый CDN CARTO:
    //tile.openstreetmap.org у части провайдеров отдаёт 403, Esri-слои работают.
    mapState.base.osm = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; CARTO'
    });
    mapState.base.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Imagery &copy; Esri'
    });
    mapState.base.hybrid = L.layerGroup([
      mapState.base.sat,
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, attribution: 'Labels &copy; Esri'
      })
    ]);
    mapState.base.osm.addTo(map);

    LAYERS.forEach(l => {
      const g = (typeof L.markerClusterGroup === 'function')
        ? L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 46,
            spiderfyOnMaxZoom: true,
            iconCreateFunction: (c) => {
              const n = c.getChildCount();
              return L.divIcon({
                html: '<div class="cluster' + (n >= 100 ? ' cluster--lg' : '') + '"><span>' + n + '</span></div>',
                className: 'pin-wrap',
                iconSize: [38, 38], iconAnchor: [19, 19]
              });
            }
          })
        : L.layerGroup();
      mapState.groups[l.id] = g;
      g.addTo(map);
    });
    mapState.map = map;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { if (!$('mapView').hidden) map.invalidateSize({ pan: false }); })
        .observe($('map'));
    }
    buildLayers();
    buildBasemap();
  }

  function buildBasemap() {
    const wrap = $('basemap');
    wrap.querySelectorAll('[data-base]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.base;
        if (id === mapState.baseId) return;
        Object.values(mapState.base).forEach(l => mapState.map.removeLayer(l));
        mapState.base[id].addTo(mapState.map);
        mapState.baseId = id;
        wrap.querySelectorAll('[data-base]').forEach(x => x.classList.toggle('is-active', x === b));
      });
    });
  }

  function buildLayers() {
    const wrap = $('layers');
    wrap.innerHTML = LAYERS.map(l =>
      '<label class="layer' + (layerOn[l.id] ? ' is-on' : '') + '" style="--c:' + l.color + '">' +
        '<input type="checkbox" data-layer="' + l.id + '"' + (layerOn[l.id] ? ' checked' : '') + '>' +
        '<i></i>' + esc(l.label) +
      '</label>'
    ).join('');
    wrap.querySelectorAll('input[data-layer]').forEach(inp => {
      inp.addEventListener('change', () => {
        layerOn[inp.dataset.layer] = inp.checked;
        inp.closest('.layer').classList.toggle('is-on', inp.checked);
        render();
      });
    });
  }

  function renderMap(list) {
    const map = mapState.map;
    if (!map) return;
    const visible = list.filter(it => it.lat != null && it.lon != null && LAYERS.some(l => l.test(it) && layerOn[l.id]));
    const listKey = visible.length + ':' + visible.map(it => it.id).join(',');
    if (listKey === mapState.lastListKey) return;
    mapState.lastListKey = listKey;

    LAYERS.forEach(l => { if (mapState.groups[l.id]) mapState.groups[l.id].clearLayers(); });
    const bounds = [];
    visible.forEach(it => {
      const layer = LAYERS.find(l => l.test(it) && layerOn[l.id]);
      const m = L.marker([it.lat, it.lon], { icon: pinIcon(it), title: it.name, riseOnHover: true, keyboard: false });
      m.bindPopup(popupHTML(it), { maxWidth: 280, minWidth: 250, closeButton: true, autoPan: true, autoPanPadding: [24, 24] });
      mapState.groups[layer.id].addLayer(m);
      bounds.push([it.lat, it.lon]);
    });
    if (bounds.length) mapState.pending = L.latLngBounds(bounds).pad(0.015);
  }

  function applyMapFrame() {
    const map = mapState.map;
    if (!map || $('mapView').hidden) return;
    map.invalidateSize({ pan: false });
    if (mapState.pending) {
      map.fitBounds(mapState.pending, { maxZoom: 7, animate: false });
      mapState.pending = null;
    }
  }


  function card(it) {
    const etps = (it.etp || []).slice(0, 3).map(c => '<i title="' + esc(etpMap[c] ? etpMap[c].name : c) + '">' + esc(c) + '</i>').join('');
    const more = (it.etp || []).length > 3 ? '<i>+' + ((it.etp || []).length - 3) + '</i>' : '';
    const phone = it.phone || '—';
    const email = it.email || '—';
    const cap = it.capacity ? '<span class="cap">' + esc(it.capacity) + ' МВт</span>' : '';
    const par = it.parent ? byId[it.parent] : null;
    const where = [it.region, par && par.kind !== 'holding' ? par.name : (it.kind === 'plant' ? it.holdingName : '')].filter(Boolean).join(' · ');
    return '' +
      '<article class="card" data-id="' + esc(it.id) + '" tabindex="0" role="button" aria-label="' + esc(it.name) + '">' +
        '<div class="card__top"><div class="card__name">' + esc(it.name) + '</div>' + typeBadge(it) + '</div>' +
        (it.full && it.full !== it.name ? '<div class="card__full">' + esc(it.full) + '</div>' : '') +
        '<div class="card__row"><span class="card__ico">📍</span><span>' + esc(where || '—') + '</span>' + cap + '</div>' +
        '<div class="card__row"><span class="card__ico">☎</span><span>' + esc(phone) + '</span></div>' +
        '<div class="card__row"><span class="card__ico">✉</span><span>' + esc(email) + '</span></div>' +
        '<div class="card__foot">' +
          '<div class="etp-mini">' + etps + more + '</div>' +
        '</div>' +
      '</article>';
  }

  function renderCards(list) {
    const wrap = $('cards');
    if (!list.length) { wrap.innerHTML = ''; return; }

    if (state.tab === 'rep' || state.tab === 'oem' || state.sort !== 'path') {
      wrap.innerHTML = '<div class="grid">' + list.map(card).join('') + '</div>';
      return;
    }

    // «По структуре»: группы холдингов в порядке появления записей,
    // без выноса ремонта/ОЕМ вниз — порядок совпадает с таблицей.
    const groups = new Map();
    list.forEach(it => {
      const key = it.holdingName || it.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    });

    wrap.innerHTML = [...groups.entries()].map(([name, arr]) => {
      const holdings = arr.filter(x => x.kind === 'holding');
      const h = holdings[0] || arr[0];
      const meta = [h.region, h.inn ? 'ИНН ' + h.inn : ''].filter(Boolean).join(' · ');
      return '<section class="group">' +
        '<div class="group__head">' +
          '<div class="group__title">' + esc(name) + '</div>' +
          '<span class="group__count">' + arr.length + '</span>' +
          '<div class="group__meta">' + esc(meta) + '</div>' +
        '</div>' +
        '<div class="grid">' + arr.map(card).join('') + '</div>' +
      '</section>';
    }).join('');
  }

  function renderTable(list) {
    const grouped = state.sort === 'path';
    const counts = {};
    if (grouped) list.forEach(it => { const k = it.holdingName || 'Прочее'; counts[k] = (counts[k] || 0) + 1; });
    let last = '';
    let html = '';
    list.forEach(it => {
      const key = it.holdingName || 'Прочее';
      if (grouped && key !== last) {
        last = key;
        html += '<tr class="group-row"><td colspan="6">' + esc(key) + '<small>' + (counts[key] || 0) + '</small></td></tr>';
      }
      const etps = (it.etp || []).slice(0, 2).map(c => etpMap[c] ? etpMap[c].name : c).join(', ');
      const td = (label, cls, content, title) =>
        '<td data-label="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + content + '</td>';
      html += '<tr class="data-row" data-id="' + esc(it.id) + '">' +
        td('Название', '', '<span class="t-name">' + esc(it.name) + '</span><span class="t-sub">' + esc(it.path || '') + '</span>', it.path) +
        td('Тип', 't-mut', esc(it.type || it.kind)) +
        td('Регион', 't-mut', esc(it.region)) +
        td('Телефон', 't-mut', esc(it.phone || '—'), it.phone) +
        td('E-mail', 't-mut', esc(it.email || '—'), it.email) +
        td('ЭТП', 't-mut', esc(etps || '—'), etps) +
      '</tr>';
    });
    $('tbody').innerHTML = html;
  }

  function render() {
    const isTenders = state.tab === 'tenders';
    const layout = document.querySelector('.layout');
    if (layout) layout.hidden = isTenders;
    if ($('tendersView')) $('tendersView').hidden = !isTenders;
    if (isTenders) {
      document.body.classList.remove('is-map', 'filters-open');
      if (window.EnergoTenders) window.EnergoTenders.onTab('tenders');
      return [];
    }
    const list = sortItems(items.filter(matches));
    const isMap = state.tab === 'map';
    $('count').textContent = list.length;
    $('countWord').textContent = plural(list.length, 'запись', 'записи', 'записей');
    $('empty').hidden = isMap || list.length > 0;
    $('mapView').hidden = !isMap;
    $('cards').hidden = isMap || state.view !== 'cards';
    $('tableWrap').hidden = isMap || state.view !== 'table';
    document.body.classList.toggle('is-map', isMap);
    if (isMap) {
      ensureMap();
      clearTimeout(mapState.raf);
      mapState.raf = setTimeout(() => {
        renderMap(list);
        applyMapFrame();
      }, 0);
    } else if (state.view === 'cards') {
      renderCards(list);
    } else {
      renderTable(list);
    }
    return list;
  }

  /* ---------- modal ---------- */
  let current = null;

  function kvRow(label, value) {
    if (!value) return '';
    return '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>';
  }

  function link(url, text) {
    if (!url) return '';
    const safe = esc(url);
    return '<a href="' + safe + '" target="_blank" rel="noopener">' + esc(text || url) + '</a>';
  }

  function openModal(id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    current = it;
    const kindLabel = it.kind === 'holding' ? 'Холдинг' : it.kind === 'plant' ? 'Электростанция / объект' : 'Организация';
    $('mKicker').textContent = kindLabel + (it.type && it.type !== 'холдинг' ? ' · ' + it.type : '');
    $('mTitle').textContent = it.name;
    $('mPath').textContent = it.path && it.path !== it.name ? it.path : (it.holdingName !== it.name ? it.holdingName : '');

    const etps = (it.etp || []).map(c => {
      const e = etpMap[c];
      return '<span class="chip chip--etp" title="' + esc(e ? e.note : '') + '">' + esc(e ? e.name : c) + '</span>';
    }).join('');

    const body = [];

    body.push('<div class="sec"><h3>Деятельность</h3><dl class="kv">' +
      kvRow('Полное наименование', esc(it.full)) +
      kvRow('Вид объекта', esc([it.type, it.kind === 'plant' ? 'станция' : ''].filter(Boolean).join(' · '))) +
      kvRow('Деятельность', esc(it.activity)) +
      kvRow('Регион', esc(it.region)) +
      kvRow('Мощность', it.capacity ? esc(it.capacity) + ' МВт' : '') +
      kvRow('Статус', esc(it.status)) +
    '</dl></div>');

    body.push('<div class="sec"><h3>Контакты</h3><dl class="kv">' +
      kvRow('Адрес', esc(it.address)) +
      kvRow('Телефон', it.phone ? '<a href="tel:' + esc(it.phone.replace(/[^\d+]/g, '')) + '">' + esc(it.phone) + '</a>' : '') +
      kvRow('E-mail', it.email ? '<a href="mailto:' + esc(it.email) + '">' + esc(it.email) + '</a>' : '') +
      kvRow('Сайт', link(it.site)) +
      kvRow('Раздел закупок', link(it.procUrl)) +
    '</dl></div>');

    body.push('<div class="sec"><h3>Реквизиты и руководство</h3><dl class="kv">' +
      kvRow('ИНН', esc(it.inn)) +
      kvRow('КПП', esc(it.kpp)) +
      kvRow('ОГРН', esc(it.ogrn)) +
      kvRow('Руководитель', esc(it.ceo)) +
      kvRow('Контакт по закупкам', esc(it.contact)) +
      kvRow('Главный инженер', esc(it.chiefEngineer)) +
      kvRow('Главный конструктор', esc(it.chiefDesigner)) +
      kvRow('Ответственный по закупкам', esc(it.procContact)) +
      kvRow('Телефон закупок', esc(it.procPhone)) +
      kvRow('E-mail закупок', esc(it.procEmail)) +
    '</dl></div>');

    body.push('<div class="sec"><h3>Закупки</h3>' +
      '<div class="meth">' + esc(it.method || '—') + '</div>' +
      '<div class="chips" style="margin-top:10px">' + (etps || '<span class="chip">не указаны</span>') + '</div>' +
    '</div>');

    if (it.notes) {
      body.push('<div class="sec"><h3>Примечание</h3><div class="note">' + esc(it.notes) + '</div></div>');
    }

    const srcs = (it.sources || []).map(s => {
      const o = srcMap[s];
      return '<span class="tag">' + esc(o ? o.title : s) + '</span>';
    }).join('');
    body.push('<div class="sec"><h3>Источники</h3>' +
      '<div class="srcs" style="margin-top:8px">' + srcs + '</div>' +
    '</div>');

    $('mBody').innerHTML = body.join('');
    $('mBody').scrollTop = 0;
    const site = it.site || '';
    const btn = $('mSite');
    btn.href = site || '#';
    btn.style.display = site ? '' : 'none';
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('mClose').focus();
  }

  function closeModal() {
    $('modal').hidden = true;
    document.body.style.overflow = '';
    current = null;
  }

  function cardText(it) {
    const etps = (it.etp || []).map(c => (etpMap[c] ? etpMap[c].name : c)).join(', ');
    return [
      it.name,
      it.full && it.full !== it.name ? it.full : '',
      it.activity || '',
      'Регион: ' + (it.region || '—'),
      'Адрес: ' + (it.address || '—'),
      'Телефон: ' + (it.phone || '—'),
      'E-mail: ' + (it.email || '—'),
      'Сайт: ' + (it.site || '—'),
      'Закупки: ' + (it.procUrl || '—'),
      'ИНН: ' + (it.inn || '—') + (it.kpp ? ' / КПП ' + it.kpp : '') + (it.ogrn ? ' / ОГРН ' + it.ogrn : ''),
      'Руководитель: ' + (it.ceo || '—'),
      'Контакт по закупкам: ' + (it.contact || '—'),
      'Способ закупки: ' + (it.method || '—'),
      'ЭТП: ' + (etps || '—')
    ].filter(Boolean).join('\n');
  }

  /* ---------- export ---------- */
  function exportCSV() {
    const list = sortItems(items.filter(matches));
    const cols = ['name', 'full', 'type', 'holdingName', 'path', 'region', 'address', 'phone', 'email', 'site', 'procUrl', 'inn', 'kpp', 'ogrn', 'ceo', 'contact', 'method', 'etp', 'capacity', 'status', 'sources', 'notes', 'chiefEngineer', 'chiefDesigner', 'procContact', 'procPhone', 'procEmail'];
    const head = ['Название', 'Полное наименование', 'Тип', 'Холдинг', 'Структура', 'Регион', 'Адрес', 'Телефон', 'E-mail', 'Сайт', 'Закупки', 'ИНН', 'КПП', 'ОГРН', 'Руководитель', 'Контакт по закупкам', 'Способ закупки', 'ЭТП', 'Мощность, МВт', 'Статус', 'Источники', 'Примечание', 'Главный инженер', 'Главный конструктор', 'Ответственный по закупкам', 'Телефон закупок', 'E-mail закупок'];
    const escCSV = (v) => {
      const s = Array.isArray(v) ? v.join('; ') : String(v == null ? '' : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [head.join(';')].concat(list.map(it => cols.map(c => escCSV(it[c])).join(';')));
    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'энергореестр-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- init ---------- */
  function initStats() {
    const s = R.stats || {};
    const data = [
      [s.holdings || 0, 'холдингов'],
      [s.companies || 0, 'юрлиц'],
      [s.plants || 0, 'станций'],
      [s.repair || 0, 'ремонтных'],
      [s.high || 0, 'проверено']
    ];
    $('stats').innerHTML = data.map(([n, l]) => '<div class="stat"><b>' + n + '</b><span>' + l + '</span></div>').join('');
    $('disclaimer').textContent = (R.meta && R.meta.disclaimer) || '';
    $('ver').textContent = 'v' + ((R.meta && R.meta.version) || '1.0') + ' от ' + ((R.meta && R.meta.date) || '');
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => { x.classList.remove('is-active'); x.setAttribute('aria-selected', 'false'); });
      t.classList.add('is-active'); t.setAttribute('aria-selected', 'true');
      state.tab = t.dataset.tab;
      if (window.EnergoTenders) window.EnergoTenders.onTab(state.tab);
      if (state.tab === 'all') history.replaceState(null, '', location.pathname + location.search);
      else history.replaceState(null, '', '#tab=' + state.tab);
      render();
    }));

    let searchTimer = 0;
    const bindInput = (id, key, evt) => {
      const el = $(id);
      el.addEventListener(evt || 'change', () => {
        state[key] = el.value;
        if (key === 'q') {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(render, 130);
        } else render();
      });
    };
    bindInput('q', 'q', 'input');

    const qEl = $('q');
    const sBox = $('qSuggest');
    let sIdx = -1, sItems = [];
    const hideSuggest = () => { sBox.hidden = true; sBox.innerHTML = ''; sIdx = -1; sItems = []; };
    const drawSuggest = () => {
      sItems = suggestFor(qEl.value.trim());
      if (!sItems.length) { hideSuggest(); return; }
      sBox.innerHTML = '<div class="t-suggest__head">Совпадения в карточках</div>' + sItems.map((s, i) =>
        '<button type="button" data-i="' + i + '"><b>' + esc(s.value) + '</b><small>' + esc(s.label) + '</small></button>').join('');
      sBox.hidden = false;
      sIdx = -1;
    };
    let suggestTimer = 0;
    qEl.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(drawSuggest, 100);
    });
    const pickSuggest = (i) => {
      const s = sItems[i];
      if (!s) return;
      qEl.value = s.value;
      state.q = s.value;
      hideSuggest();
      render();
    };
    sBox.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) pickSuggest(Number(b.dataset.i));
    });
    qEl.addEventListener('keydown', e => {
      if (sBox.hidden || !sItems.length) return;
      if (e.key === 'Escape') { hideSuggest(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sIdx = e.key === 'ArrowDown' ? (sIdx + 1) % sItems.length : (sIdx - 1 + sItems.length) % sItems.length;
        Array.from(sBox.querySelectorAll('button[data-i]')).forEach((b, i) => b.classList.toggle('is-active', i === sIdx));
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); pickSuggest(sIdx >= 0 ? sIdx : 0); }
    });
    document.addEventListener('click', e => {
      if (!sBox.hidden && !e.target.closest('.t-auto')) hideSuggest();
    });
    bindInput('fHolding', 'holding');
    bindInput('fRegion', 'region');
    bindInput('fType', 'type');
    bindInput('fMethod', 'method');
    bindInput('fEtp', 'etp');
    bindInput('sort', 'sort');

    $('fOnlyOrg').addEventListener('change', e => { state.onlyOrg = e.target.checked; render(); });

    $('resetBtn').addEventListener('click', () => {
      Object.assign(state, { q: '', holding: '', region: '', type: '', method: '', etp: '', onlyOrg: false, sort: 'path' });
      ['q', 'fHolding', 'fRegion', 'fType', 'fMethod', 'fEtp', 'sort'].forEach(id => { $(id).value = ''; });
      $('sort').value = 'path';
      $('fOnlyOrg').checked = false;
      hideSuggest();
      render();
    });

    document.querySelectorAll('.seg__btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.seg__btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.view = b.dataset.view;
      render();
    }));

    $('cards').addEventListener('click', e => {
      const c = e.target.closest('.card');
      if (c) openModal(c.dataset.id);
    });
    $('cards').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const c = e.target.closest('.card');
        if (c) { e.preventDefault(); openModal(c.dataset.id); }
      }
    });
    $('tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr');
      if (tr) openModal(tr.dataset.id);
    });

    $('modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('copyBtn').addEventListener('click', async () => {
      if (!current) return;
      try {
        await navigator.clipboard.writeText(cardText(current));
        $('copyBtn').textContent = 'Скопировано ✓';
        setTimeout(() => { $('copyBtn').textContent = 'Скопировать карточку'; }, 1600);
      } catch (err) {
        alert('Не удалось скопировать. Используйте выделение текста.');
      }
    });
    $('exportBtn').addEventListener('click', exportCSV);

    $('filterToggle').addEventListener('click', () => {
      const panel = $('filtersPanel');
      const open = panel.classList.toggle('is-open');
      document.body.classList.toggle('filters-open', open);
      $('filterToggle').setAttribute('aria-expanded', String(open));
    });

    $('mapFit').addEventListener('click', () => {
      mapState.lastListKey = '';
      render();
    });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-id]');
      if (b) {
        if (mapState.map) mapState.map.closePopup();
        openModal(b.dataset.openId);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault(); $('q').focus();
      }
    });
  }

  /* ---------- уведомления ---------- */
  function createNotice(kind, icon) {
    const el = document.createElement('div');
    el.className = 'notice notice--' + kind;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="notice__icon" aria-hidden="true">' + esc(icon) + '</span>' +
      '<span class="notice__body"></span>' +
      '<button class="notice__close" type="button" aria-label="Закрыть уведомление">✕</button>';
    el.querySelector('.notice__close').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    return el;
  }

  /* ---------- автообновление ---------- */
  function initAutoUpdate() {
    const current = (R.meta && R.meta.version) || '1.0';
    const SEEN_KEY = 'energo-reloaded-version';
    let lastCheck = 0;
    let notice = null;

    function reload() {
      saveState();
      location.reload();
    }

    function showNotice(version) {
      if (notice && notice.isConnected) return;
      // Защита от бесконечного цикла: на одной и той же версии перезагружаемся один раз.
      let seen = '';
      try { seen = sessionStorage.getItem(SEEN_KEY) || ''; } catch (e) { /* приватный режим */ }
      if (seen === version) return;
      notice = createNotice('update', 'i');
      const body = notice.querySelector('.notice__body');
      body.innerHTML = 'Обновление данных, страница будет перезагружена · <b>10</b> с';
      let seconds = 10;
      const counter = body.querySelector('b');
      const timer = setInterval(() => {
        seconds -= 1;
        if (counter) counter.textContent = String(Math.max(0, seconds));
        if (seconds <= 0) {
          clearInterval(timer);
          try { sessionStorage.setItem(SEEN_KEY, version); } catch (e) { /* приватный режим */ }
          reload();
        }
      }, 1000);
    }

    async function check(force) {
      if (document.hidden && !force) return;
      const now = Date.now();
      if (!force && now - lastCheck < 5 * 60 * 1000) return;
      lastCheck = now;
      try {
        const res = await fetch('version.json?ts=' + now, { cache: 'no-store' });
        if (!res.ok) return;
        const info = await res.json();
        if (!info.version || info.version === current) return;
        showNotice(info.version);
      } catch (e) { /* офлайн — работает локальная версия */ }
    }

    check(false);
    setInterval(() => check(false), 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(true); });
  }

  initStats();
  initFilters();
  bind();
  restoreState();
  initAutoUpdate();
  const hash = (location.hash || '').replace('#tab=', '');
  if (['gen', 'rep', 'oem', 'tenders', 'map'].includes(hash)) {
    const b = document.querySelector('[data-tab="' + hash + '"]');
    if (b) { b.click(); return; }
  }
  render();
})();
