/* Реестр предприятий РФ — клиентская логика */
(function () {
  'use strict';

  const R = window.REGISTRY || { items: [], etps: [], sources: [], meta: {}, stats: {} };
  const items = R.items;
  const etpMap = Object.fromEntries((R.etps || []).map(e => [e.code, e]));
  const srcMap = Object.fromEntries((R.sources || []).map(s => [s.id, s]));
  const TECH = window.EnergoTech || null;

  const $ = (id) => document.getElementById(id);
  const KINDS = ['', 'holding', 'company', 'plant', 'repair', 'oem'];
  const state = {
    tab: 'all',
    kind: '',
    q: '',
    holding: '',
    region: '',
    type: '',
    method: '',
    etp: '',
    onlyOrg: false,
    view: 'cards',
    sort: 'path',
    /* Порционная отрисовка: полный список фильтруется всегда, в DOM попадает
     * только первая порция — иначе 600+ карточек блокируют главный поток. */
    limit: 80,
    filterKey: ''
  };

  /* ---------- utils ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
  const digitsOnly = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  const SEARCH_FIELDS = [
    ['name', 'Название'], ['full', 'Полное наименование'], ['type', 'Тип'],
    ['activity', 'Деятельность'], ['region', 'Регион'], ['address', 'Адрес'],
    ['phone', 'Телефон'], ['email', 'E-mail'], ['site', 'Сайт'], ['procUrl', 'Раздел закупок'],
    ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН'], ['ceo', 'Руководитель'],
    ['contact', 'Контакт'], ['method', 'Способ закупки'], ['capacity', 'Мощность'],
    ['status', 'Статус'], ['notes', 'Примечание'],
    ['turbines', 'Типы турбин'], ['units', 'Состав мощности'], ['equipment', 'Оборудование'],
    ['repairs', 'Ремонты'], ['year', 'Год ввода'],
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
      (TECH ? TECH.labels(it.tech) : []).forEach(l => add(l, 'Тип турбины'));
      add(it.path, 'Структура');
      add(it.holdingName, 'Холдинг');
      const digits = parts
        .filter(p => /Телефон|ИНН|КПП|ОГРН/.test(p.label))
        .map(p => digitsOnly(p.value)).filter(Boolean).join(' ');
      return { it, parts, hay: norm(parts.map(p => p.value).join(' ')), digits };
    });
    return searchIndex;
  }

  const SUGGEST_PRIORITY = {
    'Название': 0, 'ИНН': 1, 'Регион': 2, 'Телефон': 3,
    'Полное наименование': 4, 'E-mail': 5
  };
  function suggestFor(query) {
    const nq = norm(query);
    const dq = digitsOnly(nq);
    if (!nq) return [];
    const seen = new Set();
    const found = [];
    for (const rec of getSearchIndex()) {
      for (const p of rec.parts) {
        const key = p.label + '\u0000' + p.value;
        if (seen.has(key)) continue;
        const value = norm(p.value);
        const dvalue = digitsOnly(p.value);
        const digitHit = dq.length >= 7 && dvalue.includes(dq);
        if (!value.includes(nq) && !digitHit) continue;
        seen.add(key);
        const exact = value === nq || (dq.length >= 7 && dvalue === dq) ? -1 : 0;
        const starts = value.startsWith(nq) ? 0 : 1;
        found.push({
          value: p.value, label: p.label,
          rank: exact + starts + (SUGGEST_PRIORITY[p.label] == null ? 6 : SUGGEST_PRIORITY[p.label]) / 100,
          len: p.value.length
        });
      }
    }
    return found
      .sort((a, b) => a.rank - b.rank || a.len - b.len || a.value.localeCompare(b.value, 'ru'))
      .slice(0, 12)
      .map(({ value, label }) => ({ value, label }));
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

  /* ---------- избранное и возврат к карточке ---------- */
  const F = window.EnergoFavorites || null;
  let returnContext = null;

  function updateFavIcon(kind, id, el) {
    if (!el || !F) return;
    const on = F.has(kind, id);
    el.textContent = on ? '★' : '☆';
    el.setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное');
    el.setAttribute('data-tip', on ? 'В избранном' : 'В избранное');
    el.classList.toggle('is-fav', on);
  }
  function updateFavCount() {
    const n = F ? F.count() : 0;
    const badge = $('favCount');
    if (badge) { badge.hidden = n === 0; badge.textContent = String(n); }
  }
  function favToggle(kind, id, el) {
    if (!F || !id) return;
    F.toggle(kind, id);
    updateFavIcon(kind, id, el);
    if (kind === 'org') {
      document.querySelectorAll('[data-fav-org]').forEach((s) => {
        if (s.dataset.favOrg === id) updateFavIcon('org', id, s);
      });
      if (current && current.id === id) updateFavIcon('org', id, $('mFav'));
    }
    updateFavCount();
    window.dispatchEvent(new Event('energo-favorites-changed'));
    if ($('favModal') && !$('favModal').hidden) renderFavorites();
  }
  function renderFavorites() {
    if (!F) return;
    const data = F.load();
    const tenders = (((window.TENDER_DATA || {}).tenders || {}).records) || [];
    const tMap = Object.fromEntries(tenders.map(r => [r.id, r]));
    const orgs = data.orgs.map(id => {
      const it = byId[id];
      if (!it) return '';
      return '<div class="fav-item"><button class="fav-item__open" type="button" data-open-org="' + esc(id) + '">' +
        esc(it.name) + '<small>' + esc([it.region, it.type].filter(Boolean).join(' · ')) + '</small></button>' +
        '<button class="fav-item__del" type="button" data-del-fav="org" data-id="' + esc(id) + '" aria-label="Убрать">✕</button></div>';
    }).join('') || '<p class="muted-value">Пока нет сохранённых организаций.</p>';
    const tnd = data.tenders.map(id => {
      const r = tMap[id];
      if (!r) return '';
      return '<div class="fav-item"><button class="fav-item__open" type="button" data-open-tender="' + esc(id) + '">' +
        esc((r.title || r.id).slice(0, 120)) + '<small>' + esc([r.customer, r.price].filter(Boolean).join(' · ')) + '</small></button>' +
        '<button class="fav-item__del" type="button" data-del-fav="tender" data-id="' + esc(id) + '" aria-label="Убрать">✕</button></div>';
    }).join('') || '<p class="muted-value">Пока нет сохранённых закупок.</p>';
    $('favBody').innerHTML = '<div class="sec"><h3>Организации</h3>' + orgs + '</div>' +
      '<div class="sec"><h3>Закупки</h3>' + tnd + '</div>';
  }
  function openFavorites() {
    renderFavorites();
    $('favModal').hidden = false;
    document.body.style.overflow = 'hidden';
    positionReturnBar();
    observeReturnBarPanel();
  }
  function closeFavorites() {
    $('favModal').hidden = true;
    document.body.style.overflow = '';
    clearReturnContext();
    positionReturnBar();
  }
  function setReturnContext(id, name, type) {
    returnContext = { id, name, type: type || 'org' };
    $('returnBar')?.remove();
    const el = document.createElement('button');
    el.type = 'button';
    el.id = 'returnBar';
    el.className = 'return-bar';
    el.setAttribute('aria-label', 'Вернуться: ' + name);
    const prefix = type === 'tender' ? 'Закупка:' : 'Карточка:';
    el.innerHTML = '<span class="return-bar__back" aria-hidden="true">←</span>' +
      '<span>' + prefix + ' <b>' + esc(name) + '</b></span>';
    el.addEventListener('click', () => {
      const ctx = returnContext;
      clearReturnContext();
      if (ctx && ctx.type === 'tender') {
        document.querySelector('[data-tab="tenders"]')?.click();
        if (window.EnergoTenders && window.EnergoTenders.openDetail) window.EnergoTenders.openDetail(ctx.id);
      } else {
        document.querySelector('[data-tab="all"]')?.click();
        if (ctx) openModal(ctx.id);
      }
    });
    document.body.appendChild(el);
    positionReturnBar();
    observeReturnBarPanel();
  }
  let returnBarRO = null;
  function observeReturnBarPanel() {
    if (!window.ResizeObserver) return;
    if (!returnBarRO) returnBarRO = new ResizeObserver(() => positionReturnBar());
    returnBarRO.disconnect();
    const panel = visibleModalPanel();
    if (panel) {
      returnBarRO.observe(panel);
      const foot = panel.querySelector('.modal__foot');
      if (foot) returnBarRO.observe(foot);
    }
  }
  function clearReturnContext() {
    returnContext = null;
    $('returnBar')?.remove();
    positionReturnBar();
  }
  /* Плашка возврата не должна закрывать кнопки в подвале открытой карточки:
   * динамически поднимаем её над .modal__foot и держим в границах панели. */
  function visibleModalPanel() {
    for (const id of ['tenderModal', 'modal', 'favModal']) {
      const m = $(id);
      if (m && !m.hidden) return m.querySelector('.modal__panel');
    }
    return null;
  }
  function positionReturnBar() {
    const bar = $('returnBar');
    const panel = visibleModalPanel();
    document.querySelectorAll('.modal__body').forEach(mb => { mb.style.paddingBottom = ''; });
    if (!bar) return;
    let left = innerWidth <= 720 ? 10 : 16, bottom = innerWidth <= 720 ? 12 : 16, max = 420;
    if (panel) {
      const pr = panel.getBoundingClientRect();
      const foot = panel.querySelector('.modal__foot');
      const fr = foot ? foot.getBoundingClientRect() : null;
      left = Math.max(8, Math.round(pr.left + 12));
      bottom = Math.max(10, Math.round(innerHeight - (fr ? fr.top : pr.bottom) + 10));
      max = Math.max(180, Math.round(pr.width - 24));
      const body = panel.querySelector('.modal__body');
      if (body) body.style.paddingBottom = ((bar.offsetHeight || 40) + 14) + 'px';
    }
    bar.style.setProperty('--rb-left', left + 'px');
    bar.style.setProperty('--rb-bottom', bottom + 'px');
    bar.style.setProperty('--rb-max', max + 'px');
  }
  function focusOnMap(id) {
    const it = byId[id];
    if (!it || it.lat == null || it.lon == null) {
      createNotice('info', '!').querySelector('.notice__body').textContent = 'У этой записи нет координат';
      return;
    }
    document.querySelector('[data-tab="map"]')?.click();
    let tries = 0;
    const tryFocus = () => {
      const marker = mapState.markers[id];
      if (mapState.map && marker) {
        mapState.pending = null; // не даём общему fitBounds перебить фокус
        mapState.map.setView([it.lat, it.lon], 15, { animate: false });
        setTimeout(() => marker.openPopup(), 250);
        return;
      }
      if (tries++ < 25) setTimeout(tryFocus, 100);
    };
    setTimeout(tryFocus, 120);
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
      kind: KINDS.includes(saved.kind) ? saved.kind : '',
      q: saved.q || '', holding: saved.holding || '', region: saved.region || '',
      type: saved.type || '', method: saved.method || '', etp: saved.etp || '',
      onlyOrg: !!saved.onlyOrg,
      view: saved.view === 'table' ? 'table' : 'cards',
      sort: ['path', 'name', 'region', 'tech'].includes(saved.sort) ? saved.sort : 'path'
    });
    const fields = { q: 'q', fHolding: 'holding', fRegion: 'region', fType: 'type', fMethod: 'method', fEtp: 'etp', sort: 'sort' };
    Object.entries(fields).forEach(([id, key]) => {
      if ($(id)) $(id).value = state[key] || '';
    });
    $('fOnlyOrg').checked = state.onlyOrg;
    document.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === state.view));
  }

  function techBadges(it, limit) {
    if (!TECH || !it.tech) return '';
    const codes = TECH.parse(it.tech).slice(0, limit || 2);
    return codes.map(c => '<span class="tech tech--' + c + '">' + esc(TECH.BY_CODE[c].label) + '</span>').join('');
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
  function inKind(it) {
    if (state.kind === 'holding') return it.kind === 'holding';
    if (state.kind === 'company') return it.kind === 'company';
    if (state.kind === 'plant') return it.kind === 'plant';
    if (state.kind === 'repair') return isRepair(it);
    if (state.kind === 'oem') return isOem(it);
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
    if (!inKind(it)) return false;
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
      if (!words.every(w => {
        const d = digitsOnly(w);
        // Телефон/ИНН/КПП/ОГРН ищем по цифрам, без учёта форматирования.
        if (d.length >= 7) return rec ? rec.digits.includes(d) : digitsOnly(JSON.stringify(it)).includes(d);
        return hay.includes(w);
      })) return false;
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
    { id: 'repair', label: 'Ремонт', color: '#7a4a1c', test: i => isRepair(i) },
    { id: 'oem', label: 'ОЕМ / производство', color: '#5b3d91', test: i => isOem(i) },
    { id: 'plant', label: 'Станции', color: '#e2701f', test: i => i.kind === 'plant' },
    { id: 'gen', label: 'Генерация', color: '#1f6f9c', test: i => i.kind !== 'plant' && isGen(i) }
  ];
  const mapState = { map: null, groups: {}, markers: {}, base: {}, osmChain: [], osmIdx: 0, baseId: 'osm', ready: false, fitKey: '', pending: null, lastListKey: '', raf: 0 };

  function renderMapLegend() {
    const box = $('mapLegend');
    if (!box) return;
    box.innerHTML = LAYERS.map(l =>
      '<span><b style="background:' + l.color + '"></b>' + esc(l.label) + '</span>').join('');
  }

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

  // Русские подписи элементов управления и атрибуции карты.
  function localizeMapUI() {
    if (mapState.map && mapState.map.attributionControl) {
      mapState.map.attributionControl.setPrefix('Реестр предприятий');
    }
    const zin = document.querySelector('.leaflet-control-zoom-in');
    const zout = document.querySelector('.leaflet-control-zoom-out');
    if (zin) zin.title = 'Приблизить';
    if (zout) zout.title = 'Отдалить';
    const attr = document.querySelector('.leaflet-control-attribution');
    if (attr) {
      attr.innerHTML = attr.innerHTML
        .replace(/Tiles (?:&copy;|©) Esri/g, 'Картографические данные © Esri')
        .replace(/Imagery (?:&copy;|©) Esri/g, 'Спутниковые снимки © Esri')
        .replace(/Labels (?:&copy;|©) Esri/g, 'Подписи © Esri')
        .replace(/OpenStreetMap contributors/g, 'Участники OpenStreetMap');
    }
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
    // Основная подложка «Карта» — OSM.org: в России подписи на русском языке.
    // Резерв — OSM.de; Esri World_Street_Map используется только спутником/гибридом
    // и как крайняя мера, но его подписи английские. CARTO не использовать:
    // он отдаёт «API KEY REQUIRED» вместо тайлов.
    const osmSources = [
      { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19,
        attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
      { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', max: 19,
        attr: '&copy; OpenStreetMap contributors' },
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', max: 18,
        attr: 'Tiles &copy; Esri' }
    ];
    mapState.osmChain = osmSources.map(s => L.tileLayer(s.url, { maxZoom: s.max, attribution: s.attr }));
    mapState.osmIdx = 0;
    let switching = false;
    mapState.osmChain.forEach((layer, idx) => {
      let errors = 0;
      layer.on('tileerror', () => {
        if (switching || mapState.baseId !== 'osm' || idx !== mapState.osmIdx) return;
        if (++errors < 3 || idx >= mapState.osmChain.length - 1) return;
        switching = true;
        mapState.map.removeLayer(layer);
        mapState.osmIdx = idx + 1;
        mapState.osmChain[mapState.osmIdx].addTo(mapState.map);
        switching = false;
      });
    });
    mapState.base.osm = mapState.osmChain[0];
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
    localizeMapUI();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { if (!$('mapView').hidden) map.invalidateSize({ pan: false }); })
        .observe($('map'));
    }
    buildBasemap();
  }

  function buildBasemap() {
    const wrap = $('basemap');
    wrap.querySelectorAll('[data-base]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.base;
        if (id === mapState.baseId) return;
        [].concat(...Object.values(mapState.base)).forEach(l => mapState.map.removeLayer(l));
        const target = id === 'osm' ? mapState.osmChain[mapState.osmIdx] : mapState.base[id];
        target.addTo(mapState.map);
        mapState.baseId = id;
        localizeMapUI();
        wrap.querySelectorAll('[data-base]').forEach(x => x.classList.toggle('is-active', x === b));
      });
    });
  }

  function renderMap(list) {
    const map = mapState.map;
    if (!map) return;
    const visible = list.filter(it => it.lat != null && it.lon != null);
    const listKey = visible.length + ':' + visible.map(it => it.id).join(',');
    if (listKey === mapState.lastListKey) return;
    mapState.lastListKey = listKey;

    LAYERS.forEach(l => { if (mapState.groups[l.id]) mapState.groups[l.id].clearLayers(); });
    mapState.markers = {};
    const bounds = [];
    visible.forEach(it => {
      const layer = LAYERS.find(l => l.test(it)) || LAYERS[LAYERS.length - 1];
      const m = L.marker([it.lat, it.lon], { icon: pinIcon(it), title: it.name, riseOnHover: true, keyboard: false });
      m.bindPopup(popupHTML(it), { maxWidth: 280, minWidth: 250, closeButton: true, autoPan: true, autoPanPadding: [24, 24] });
      mapState.groups[layer.id].addLayer(m);
      mapState.markers[it.id] = m;
      bounds.push([it.lat, it.lon]);
    });
    if (bounds.length) mapState.pending = L.latLngBounds(bounds).pad(0.015);
  }

  function applyMapFrame() {
    const map = mapState.map;
    if (!map || $('mapView').hidden) return;
    renderMapLegend();
    localizeMapUI();
    map.invalidateSize({ pan: false });
    if (mapState.pending) {
      map.fitBounds(mapState.pending, { maxZoom: 7, animate: false });
      mapState.pending = null;
    }
  }


  function card(it) {
    const etps = (it.etp || []).slice(0, 3).map(c => '<i title="' + esc(etpMap[c] ? etpMap[c].name : c) + '">' + esc(c) + '</i>').join('');
    const more = (it.etp || []).length > 3 ? '<i>+' + ((it.etp || []).length - 3) + '</i>' : '';
    const phone = it.phone
      ? '<a href="tel:' + esc(it.phone.replace(/[^\d+]/g, '')) + '" title="Позвонить">' + esc(it.phone) + '</a>'
      : '—';
    const email = it.email
      ? '<a href="mailto:' + esc(it.email) + '" title="Написать e-mail">' + esc(it.email) + '</a>'
      : '—';
    const cap = it.capacity ? '<span class="cap">' + esc(it.capacity) + ' МВт</span>' : '';
    const par = it.parent ? byId[it.parent] : null;
    const where = [it.region, par && par.kind !== 'holding' ? par.name : (it.kind === 'plant' ? it.holdingName : '')].filter(Boolean).join(' · ');
    return '' +
      '<article class="card" data-id="' + esc(it.id) + '" tabindex="0" role="button" aria-label="' + esc(it.name) + '">' +
        '<div class="card__top"><div class="card__name">' + esc(it.name) + '</div>' +
          '<button class="fav-star" type="button" data-fav-org="' + esc(it.id) + '" aria-label="В избранное" title="В избранное">' + (F && F.has('org', it.id) ? '★' : '☆') + '</button>' +
          techBadges(it, 2) + typeBadge(it) + '</div>' +
        (it.full && it.full !== it.name ? '<div class="card__full">' + esc(it.full) + '</div>' : '') +
        '<div class="card__row"><span class="card__ico">📍</span><span>' + esc(where || '—') + '</span>' + cap + '</div>' +
        '<div class="card__row"><span class="card__ico">☎</span><span>' + phone + '</span></div>' +
        '<div class="card__row"><span class="card__ico">✉</span><span>' + email + '</span></div>' +
        '<div class="card__foot">' +
          '<div class="etp-mini">' + etps + more + '</div>' +
        '</div>' +
      '</article>';
  }

  function renderCards(list) {
    const wrap = $('cards');
    if (!list.length) { wrap.innerHTML = ''; return; }

    const api = window.EnergoSort;
    const keyOf = it => api && api.groupKey ? api.groupKey(it, state.sort) : (it.holdingName || 'Прочее');
    const labelOf = key => api && api.groupLabel ? api.groupLabel(key, state.sort) : key;

    // Mini-заголовки есть во всех режимах сортировки:
    // холдинг / буква алфавита / регион / тип турбин — счётчик всегда равен числу карточек.
    const groups = new Map();
    list.forEach(it => {
      const key = keyOf(it);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    });

    let remaining = state.limit;
    wrap.innerHTML = [...groups.entries()].map(([key, arr]) => {
      if (remaining <= 0) return '';
      const visible = arr.slice(0, remaining);
      remaining -= visible.length;
      let meta;
      if (state.sort === 'path') {
        const holdings = arr.filter(x => x.kind === 'holding');
        const h = holdings[0] || arr[0];
        meta = [h.region, h.inn ? 'ИНН ' + h.inn : ''].filter(Boolean).join(' · ');
      } else {
        const orgs = arr.filter(x => x.kind !== 'plant').length;
        const stations = arr.length - orgs;
        meta = [orgs ? orgs + ' орг.' : '', stations ? plural(stations, 'станция', 'станции', 'станций') : ''].filter(Boolean).join(' · ');
      }
      return '<section class="group">' +
        '<div class="group__head">' +
          '<div class="group__title">' + esc(labelOf(key)) + '</div>' +
          '<span class="group__count">' + arr.length + '</span>' +
          (meta ? '<div class="group__meta">' + esc(meta) + '</div>' : '') +
        '</div>' +
        '<div class="grid">' + visible.map(card).join('') + '</div>' +
      '</section>';
    }).filter(Boolean).join('');
  }

  function renderTable(list) {
    const api = window.EnergoSort;
    const keyOf = it => api && api.groupKey ? api.groupKey(it, state.sort) : (it.holdingName || 'Прочее');
    const labelOf = key => api && api.groupLabel ? api.groupLabel(key, state.sort) : key;
    const counts = {};
    list.forEach(it => { const k = keyOf(it); counts[k] = (counts[k] || 0) + 1; });
    let last = null;
    let html = '';
    list.slice(0, state.limit).forEach(it => {
      const key = keyOf(it);
      if (key !== last) {
        last = key;
        html += '<tr class="group-row"><td colspan="6">' + esc(labelOf(key)) + '<small>' + counts[key] + '</small></td></tr>';
      }
      const etps = (it.etp || []).slice(0, 2).map(c => etpMap[c] ? etpMap[c].name : c).join(', ');
      const td = (label, cls, content, title) =>
        '<td data-label="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + content + '</td>';
      html += '<tr class="data-row" data-id="' + esc(it.id) + '">' +
        td('Название', '', '<span class="t-name">' + esc(it.name) + '</span><span class="t-sub">' + esc(it.path || '') + '</span>', it.path) +
        td('Тип', 't-mut', esc(it.type || it.kind) + (techBadges(it, 2) ? ' ' + techBadges(it, 2) : '')) +
        td('Регион', 't-mut', esc(it.region)) +
        td('Телефон', 't-mut', esc(it.phone || '—'), it.phone) +
        td('E-mail', 't-mut', esc(it.email || '—'), it.email) +
        td('ЭТП', 't-mut', esc(etps || '—'), etps) +
      '</tr>';
    });
    $('tbody').innerHTML = html;
  }

  function updateFilterButton() {
    const btn = $('filterToggle');
    if (!btn) return;
    let n = 0;
    if (state.q) n++;
    ['kind', 'holding', 'region', 'type', 'method', 'etp'].forEach(key => { if (state[key]) n++; });
    if (state.onlyOrg) n++;
    const open = document.body.classList.contains('filters-open');
    btn.classList.toggle('is-active', open || n > 0);
    btn.setAttribute('aria-pressed', String(n > 0));
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = 'Фильтры' + (n ? ' <span class="btn__badge">' + n + '</span>' : '');
  }

  function closeFilters() {
    document.body.classList.remove('filters-open');
    $('filtersPanel').classList.remove('is-open');
    updateFilterButton();
  }

  function render() {
    updateFilterButton();
    const isTenders = state.tab === 'tenders';
    document.body.classList.toggle('is-tenders', isTenders);
    const layout = document.querySelector('.layout');
    if (layout) layout.hidden = isTenders;
    if ($('tendersView')) $('tendersView').hidden = !isTenders;
    if (isTenders) {
      document.body.classList.remove('is-map');
      if (window.EnergoTenders) window.EnergoTenders.onTab('tenders');
      return [];
    }
    const fk = JSON.stringify([state.q, state.kind, state.holding, state.region, state.type,
      state.method, state.etp, state.onlyOrg, state.sort]);
    if (fk !== state.filterKey) { state.filterKey = fk; state.limit = 80; }
    const list = sortItems(items.filter(matches));
    const isMap = state.tab === 'map';
    $('count').textContent = list.length;
    $('countWord').textContent = plural(list.length, 'запись', 'записи', 'записей');
    $('empty').hidden = isMap || list.length > 0;
    $('mapView').hidden = !isMap;
    $('mapToolbar').hidden = !isMap;
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
    let more = $('moreCards');
    if (list.length > state.limit) {
      if (!more) {
        more = document.createElement('button');
        more.id = 'moreCards';
        more.type = 'button';
        more.className = 'btn btn--ghost more-cards';
        more.addEventListener('click', () => { state.limit += 80; render(); });
      }
      more.hidden = false;
      more.textContent = 'Показать ещё ' + Math.min(state.limit, list.length - state.limit) + ' из ' + list.length;
      (state.view === 'cards' ? $('cards') : $('tableWrap')).after(more);
    } else if (more) {
      more.hidden = true;
    }
    return list;
  }

  /* ---------- modal ---------- */
  let current = null;

  function kvRow(label, value) {
    if (!value) return '';
    return '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>';
  }

  function copyBtn(value, label) {
    if (!value) return '';
    return '<button class="copy-btn" type="button" data-copy="' + esc(value) + '" title="Скопировать ' + esc(label) + '">⧉</button>';
  }

  function link(url, text) {
    if (!url) return '';
    const safe = esc(url);
    let label = text;
    if (!label) {
      try {
        const u = new URL(url);
        let seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
        seg = seg.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        if (/wikipedia/.test(u.hostname)) label = seg ? seg + ' — Википедия' : 'Википедия';
        else label = u.hostname.replace(/^www\./, '') + (seg ? ' · ' + seg.slice(0, 40) : '');
      } catch (e) { label = url; }
    }
    if (label.length > 90) label = label.slice(0, 87) + '…';
    return '<a href="' + safe + '" target="_blank" rel="noopener" title="' + safe + '">' + esc(label) + '</a>';
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

    body.push('<div class="sec sec--activity"><h3>Деятельность</h3><dl class="kv">' +
      kvRow('Полное наименование', esc(it.full)) +
      kvRow('Вид объекта', esc([it.type, it.kind === 'plant' ? 'станция' : ''].filter(Boolean).join(' · '))) +
      kvRow('Тип турбины / технологии', techBadges(it, 99)) +
      kvRow('Деятельность', esc(it.activity)) +
      kvRow('Регион', esc(it.region)) +
      kvRow('Мощность', it.capacity ? esc(it.capacity) + ' МВт' : '') +
      kvRow('Год ввода', esc(it.year)) +
      kvRow('Типы турбин', esc(it.turbines)) +
      kvRow('Состав мощности', esc(it.units)) +
      kvRow('Статус', esc(it.status)) +
    '</dl></div>');

    const notFound = '<span class="muted-value">не найдено в открытых источниках</span>';
    body.push('<div class="sec sec--contacts"><h3>Контакты</h3><dl class="kv">' +
      kvRow('Адрес', it.address ? esc(it.address) + copyBtn(it.address, 'адрес') : notFound) +
      kvRow('Телефон', it.phone
        ? '<a href="tel:' + esc(it.phone.replace(/[^\d+]/g, '')) + '">' + esc(it.phone) + '</a>' + copyBtn(it.phone, 'телефон')
        : notFound) +
      kvRow('E-mail', it.email
        ? '<a href="mailto:' + esc(it.email) + '">' + esc(it.email) + '</a>' + copyBtn(it.email, 'e-mail')
        : notFound) +
      kvRow('Сайт', link(it.site)) +
      kvRow('Раздел закупок', link(it.procUrl)) +
    '</dl>' + (it.kind === 'plant' && it.inherited && (it.inherited.phone || it.inherited.email || it.inherited.address)
      ? '<div class="hint">Указаны контакты головной организации: у станции могут быть собственные телефон и e-mail. Уточняйте по официальному сайту или ЕГРЮЛ.</div>' : '') +
    '</div>');

    body.push('<div class="sec sec--proc"><h3>Закупки и электронные площадки</h3>' +
      '<div class="meth">' + esc(it.method || '—') + '</div>' +
      '<div class="chips" style="margin-top:10px">' + (etps || '<span class="chip">не указаны</span>') + '</div>' +
    '</div>');

    body.push('<div class="sec sec--req"><h3>Реквизиты и руководство</h3><dl class="kv">' +
      kvRow('ИНН', it.inn ? esc(it.inn) + copyBtn(it.inn, 'ИНН') : '') +
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

    if (it.equipment || it.repairs || it.wiki) {
      body.push('<div class="sec sec--equip"><h3>Эксплуатация и оборудование</h3><dl class="kv">' +
        kvRow('Основное оборудование', esc(it.equipment)) +
        kvRow('Ремонты и реконструкция', esc(it.repairs)) +
        (it.wiki ? kvRow('Страница в Википедии', link(it.wiki)) : '') +
      '</dl></div>');
    }

    if (it.notes) {
      body.push('<div class="sec sec--note"><h3>Примечание</h3><div class="note">' + esc(it.notes) + '</div></div>');
    }

    const srcs = (it.sources || []).map(s => {
      const o = srcMap[s];
      if (o && o.url) return '<a class="tag tag--link" href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.title) + '</a>';
      return '<span class="tag">' + esc(o ? o.title : s) + '</span>';
    }).join('');
    body.push('<div class="sec sec--src"><h3>Источники</h3>' +
      '<div class="srcs" style="margin-top:8px">' + srcs + '</div>' +
    '</div>');

    $('mBody').innerHTML = body.join('');
    $('mBody').scrollTop = 0;
    const site = it.site || '';
    const btn = $('mSite');
    btn.href = site || '#';
    btn.style.display = site ? '' : 'none';
    updateFavIcon('org', it.id, $('mFav'));
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('mClose').focus();
    positionReturnBar();
    observeReturnBarPanel();
  }

  function closeModal() {
    $('modal').hidden = true;
    document.body.style.overflow = '';
    current = null;
    clearReturnContext();
    positionReturnBar();
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
    const cols = ['name', 'full', 'type', 'holdingName', 'path', 'region', 'address', 'phone', 'email', 'site', 'procUrl', 'inn', 'kpp', 'ogrn', 'ceo', 'contact', 'method', 'etp', 'capacity', 'year', 'turbines', 'units', 'equipment', 'repairs', 'status', 'sources', 'notes', 'chiefEngineer', 'chiefDesigner', 'procContact', 'procPhone', 'procEmail', 'wiki'];
    const head = ['Название', 'Полное наименование', 'Тип', 'Холдинг', 'Структура', 'Регион', 'Адрес', 'Телефон', 'E-mail', 'Сайт', 'Закупки', 'ИНН', 'КПП', 'ОГРН', 'Руководитель', 'Контакт по закупкам', 'Способ закупки', 'ЭТП', 'Мощность, МВт', 'Год ввода', 'Типы турбин', 'Состав мощности', 'Оборудование', 'Ремонты', 'Статус', 'Источники', 'Примечание', 'Главный инженер', 'Главный конструктор', 'Ответственный по закупкам', 'Телефон закупок', 'E-mail закупок', 'Википедия'];
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
  // Компактные плашки должны быть одинаковой ширины — по самому длинному слову.
  function sizeCompactStats() {
    const chips = [...$('statsCompact').querySelectorAll('.stat')];
    if (!chips.length) return;
    const style = document.documentElement.style;
    style.setProperty('--chip-w', 'auto');
    const max = Math.ceil(Math.max(...chips.map(c => c.getBoundingClientRect().width)));
    style.setProperty('--chip-w', max + 'px');
  }

  function initStats() {
    const s = R.stats || {};
    const data = [
      ['', s.total || items.length, 'всего'],
      ['holding', s.holdings || 0, 'холдингов'],
      ['company', s.companies || 0, 'юрлиц'],
      ['plant', s.plants || 0, 'станций'],
      ['repair', s.repair || 0, 'ремонтных'],
      ['oem', s.oem || 0, 'ОЕМ']
    ];
    const html = data.map(([k, n, l]) => {
      const on = state.kind === k;
      return '<button class="stat' + (on ? ' is-active' : '') + '" type="button" data-kind="' + k + '" aria-pressed="' + on + '">' +
        '<b>' + n + '</b><span>' + l + '</span></button>';
    }).join('');
    $('stats').innerHTML = html;
    $('statsCompact').innerHTML = html;
    sizeCompactStats();
    $('disclaimer').textContent = (R.meta && R.meta.disclaimer) || '';
    $('ver').textContent = 'v' + ((R.meta && R.meta.version) || '1.0') + ' от ' + ((R.meta && R.meta.date) || '');
  }

  function setKind(kind, updateHash) {
    state.kind = KINDS.includes(kind) ? kind : '';
    document.querySelectorAll('.stat').forEach(b => {
      const on = b.dataset.kind === state.kind;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (updateHash !== false) {
      const h = state.tab !== 'all' ? '#tab=' + state.tab : (state.kind ? '#kind=' + state.kind : '');
      history.replaceState(null, '', location.pathname + location.search + h);
    }
    render();
  }

  function bind() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => { x.classList.remove('is-active'); x.setAttribute('aria-selected', 'false'); });
      t.classList.add('is-active'); t.setAttribute('aria-selected', 'true');
      closeFilters();
      state.tab = t.dataset.tab;
      if (window.EnergoTenders) window.EnergoTenders.onTab(state.tab);
      const h = state.tab === 'all' ? (state.kind ? '#kind=' + state.kind : '') : '#tab=' + state.tab;
      history.replaceState(null, '', location.pathname + location.search + h);
      render();
    }));

    [$('stats'), $('statsCompact')].forEach(el => el.addEventListener('click', e => {
      const b = e.target.closest('.stat');
      if (b) setKind(b.dataset.kind);
    }));

    // Плашка плашек: липкая компактная копия появляется, когда заголовок уходит вверх.
    let stickyQueued = false;
    const updateSticky = () => {
      stickyQueued = false;
      const topbar = document.querySelector('.topbar');
      const h = Math.round(topbar ? topbar.getBoundingClientRect().height : 58);
      const root = document.documentElement.style;
      root.setProperty('--topbar-h', h + 'px');
      root.setProperty('--sticky-filters-top', (h + 54) + 'px');
      // Компактная копия плашек появляется только когда крупные плашки
      // действительно ушли из виду, иначе на мобильном видны оба набора сразу.
      const heroStats = document.querySelector('.hero .stats') || document.querySelector('.hero');
      const heroBottom = heroStats ? heroStats.getBoundingClientRect().bottom : 0;
      const compact = heroBottom < h + 8;
      document.body.classList.toggle('is-condensed', compact);
      $('statsBar').setAttribute('aria-hidden', String(!compact));
    };
    window.addEventListener('scroll', () => {
      if (!stickyQueued) { stickyQueued = true; requestAnimationFrame(updateSticky); }
    }, { passive: true });
    window.addEventListener('resize', () => { updateSticky(); sizeCompactStats(); positionReturnBar(); });
    updateSticky();

    const tabsEl = $('tabs'), tabsWrap = $('tabsWrap');
    const updateTabsNav = () => {
      const max = Math.max(0, tabsEl.scrollWidth - tabsEl.clientWidth - 1);
      const hasPrev = tabsEl.scrollLeft > 2;
      const hasNext = max > 2 && tabsEl.scrollLeft < max - 2;
      tabsWrap.classList.toggle('has-prev', hasPrev);
      tabsWrap.classList.toggle('has-next', hasNext);
      $('tabsPrev').tabIndex = hasPrev ? 0 : -1;
      $('tabsNext').tabIndex = hasNext ? 0 : -1;
    };
    $('tabsPrev').addEventListener('click', () => tabsEl.scrollBy({ left: -120, behavior: 'smooth' }));
    $('tabsNext').addEventListener('click', () => tabsEl.scrollBy({ left: 120, behavior: 'smooth' }));
    tabsEl.addEventListener('scroll', updateTabsNav, { passive: true });
    window.addEventListener('resize', updateTabsNav);
    updateTabsNav();

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
      Object.assign(state, { kind: '', q: '', holding: '', region: '', type: '', method: '', etp: '', onlyOrg: false, sort: 'path' });
      ['q', 'fHolding', 'fRegion', 'fType', 'fMethod', 'fEtp', 'sort'].forEach(id => { $(id).value = ''; });
      $('sort').value = 'path';
      $('fOnlyOrg').checked = false;
      document.querySelectorAll('.stat').forEach(b => {
        const on = b.dataset.kind === '';
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
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
      if (e.target.closest('a,button')) return; // телефон/e-mail в карточке работают напрямую
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

    $('mBody').addEventListener('click', e => {
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        const value = copy.dataset.copy || '';
        const done = () => {
          const notice = createNotice('info', '✓');
          notice.querySelector('.notice__body').textContent = 'Скопировано: ' + value;
          setTimeout(() => notice.remove(), 2200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done).catch(() => {});
        else done();
        return;
      }
    });

    $('mFav').addEventListener('click', () => { if (current) favToggle('org', current.id, $('mFav')); });
    $('mTenders').addEventListener('click', (e) => {
      e.preventDefault();
      if (!current) return;
      const it = current;
      closeModal();
      setReturnContext(it.id, it.name);
      document.querySelector('[data-tab="tenders"]')?.click();
      if (window.EnergoTenders && window.EnergoTenders.setQuery) window.EnergoTenders.setQuery(it.name);
    });
    $('mMap').addEventListener('click', (e) => {
      e.preventDefault();
      if (!current) return;
      const it = current;
      closeModal();
      setReturnContext(it.id, it.name);
      focusOnMap(it.id);
    });

    $('favBtn').addEventListener('click', openFavorites);
    $('favModal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeFavorites(); });
    $('favBody').addEventListener('click', e => {
      const del = e.target.closest('[data-del-fav]');
      if (del && F) { F.toggle(del.dataset.delFav, del.dataset.id); updateFavCount(); renderFavorites(); return; }
      const org = e.target.closest('[data-open-org]');
      if (org) { closeFavorites(); openModal(org.dataset.openOrg); return; }
      const tnd = e.target.closest('[data-open-tender]');
      if (tnd && window.EnergoTenders && window.EnergoTenders.openDetail) {
        closeFavorites();
        document.querySelector('[data-tab="tenders"]')?.click();
        window.EnergoTenders.openDetail(tnd.dataset.openTender);
      }
    });
    $('favExportBtn').addEventListener('click', () => {
      if (!F) return;
      const blob = new Blob([F.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'energo-favorites-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('favImportBtn').addEventListener('click', () => $('favFile').click());
    $('favFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file || !F) return;
      try { F.importJSON(await file.text()); updateFavCount(); renderFavorites(); }
      catch (err) { alert('Не удалось импортировать: ' + (err.message || err)); }
      e.target.value = '';
    });

    $('cards').addEventListener('click', e => {
      const star = e.target.closest('[data-fav-org]');
      if (star) favToggle('org', star.dataset.favOrg, star);
    });
    $('exportBtn').addEventListener('click', exportCSV);

    $('filterToggle').addEventListener('click', () => {
      const panel = $('filtersPanel');
      const open = panel.classList.toggle('is-open');
      document.body.classList.toggle('filters-open', open);
      updateFilterButton();
    });

    $('filtersClose').addEventListener('click', closeFilters);

    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open-id]');
      if (b) {
        if (mapState.map) mapState.map.closePopup();
        openModal(b.dataset.openId);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('modal').hidden) closeModal();
      if (!$('favModal').hidden) closeFavorites();
      if (window.EnergoTenders && window.EnergoTenders.closeDetail) window.EnergoTenders.closeDetail();
      clearReturnContext();
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

  updateFavCount();
  window.addEventListener('energo-favorites-changed', updateFavCount);
  initStats();
  initFilters();
  bind();
  restoreState();
  setKind(state.kind, false);
  initAutoUpdate();

  // Якоря: #tab=tenders|map, #kind=... и старые #tab=gen|rep|oem.
  const rawHash = location.hash || '';
  const legacyKind = { gen: 'plant', rep: 'repair', oem: 'oem' };
  let initialTab = '', initialKind = '';
  if (rawHash.startsWith('#kind=')) initialKind = rawHash.slice(6);
  else if (rawHash.startsWith('#tab=')) {
    const v = rawHash.slice(5);
    if (v === 'tenders' || v === 'map') initialTab = v;
    else if (legacyKind[v]) initialKind = legacyKind[v];
  }
  if (initialKind && KINDS.includes(initialKind)) setKind(initialKind, false);
  if (initialTab) {
    const b = document.querySelector('[data-tab="' + initialTab + '"]');
    if (b) b.click();
  } else render();

  window.EnergoUI = { positionReturnBar, clearReturnContext };
  // Переход из закупки в карточку предприятия с возвратом к этой закупке.
  window.EnergoRegistry = {
    openFromTender(orgId, tenderId, tenderTitle) {
      if (tenderId) setReturnContext(tenderId, String(tenderTitle || '').slice(0, 60), 'tender');
      document.querySelector('[data-tab="all"]')?.click();
      openModal(orgId);
    }
  };
})();
