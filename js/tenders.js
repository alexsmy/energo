/* Реестр предприятий РФ — вкладка «Закупки»: единый поиск, площадки, подсветка совпадений. */
(function () {
  'use strict';

  const D = window.TENDER_DATA || {};
  let records = (D.tenders && D.tenders.records) || [];
  const rawKeywords = (D.keywords && D.keywords.keywords) || [];
  const enterprises = (D.enterprises && D.enterprises.items) || [];
  const platformItems = D.platforms || (D.etps && D.etps.platforms) || [];
  const auditPlatforms = (D.etps && D.etps.platforms) || [];
  const allEntities = D.allEntities || [];
  const regItems = ((window.REGISTRY || {}).items) || [];
  const regById = Object.fromEntries(regItems.map(x => [x.id, x]));
  const regByInn = {};
  regItems.forEach(x => {
    const inn = String(x.inn || '').slice(0, 10);
    if (inn && x.kind !== 'plant' && !regByInn[inn]) regByInn[inn] = x;
  });
  function registryOrg(r) {
    if (r.matchedOrgId && regById[r.matchedOrgId]) return regById[r.matchedOrgId];
    for (const id of (r.enterpriseIds || [])) if (regById[id]) return regById[id];
    const inn = String(r.customerInn || '').slice(0, 10);
    return (inn && regByInn[inn]) || null;
  }
  function orgLink(r, text) {
    const org = registryOrg(r);
    if (!org || !window.EnergoRegistry) return esc(text || '—');
    return '<button class="t-org-link" type="button" data-org-from-tender="' + esc(r.id) + '" title="Открыть карточку предприятия">' + esc(text || org.name) + '</button>';
  }
  const settings = D.settings || {};
  const TF = window.EnergoFavorites || null;
  let status = D.status || {};
  const $ = (id) => document.getElementById(id);

  const tm = window.EnergoTextMatch || {
    norm: (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(),
    matchesKeyword: (t, k) => String(t || '').toLowerCase().includes(String(k || '').toLowerCase()),
    matchKeywords: (t, ks) => (ks || []).filter((k) => String(t || '').toLowerCase().includes(String(k || '').toLowerCase())),
    tokenizeQuery: (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean),
    queryMatches: () => true,
    entryOf: (k) => (typeof k === 'string' ? { label: k, search: k, must: [[k]] } : k),
    matchesEntry: () => false,
    matchEntries: () => [],
    highlightEntryHtml: (r) => String(r || ''),
    highlightHtml: (r) => String(r || '')
  };

  /* Ключевые слова: строка или объект { label, search, must }. В интерфейсе
   * показываем label, в сеть уходит search, проверяем группы must. */
  const keywordEntries = rawKeywords.map(k => tm.entryOf(k)).filter(e => e.label);
  const keywords = keywordEntries.map(e => e.label);
  const entryByLabel = {};
  keywordEntries.forEach(e => { entryByLabel[tm.norm(e.label)] = e; });
  function entryOfLabel(label) {
    return entryByLabel[norm(label)] || tm.entryOf(label);
  }
  /* Для подсветки берём только те записи слов, которые реально совпали. */
  function entriesFor(r, labels) {
    return (labels && labels.length ? labels : (r.matchedKeywords || r.keywords || [])).map(entryOfLabel);
  }

  const state = {
    q: '', enterprise: '', from: '', to: '', source: '', keyword: '',
    view: 'cards', sort: 'date', pane: 'tenders',
    mode: settings.defaultMode === 'archive' ? 'archive' : 'active'
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const norm = tm.norm;
  const plural = (n) => (n % 10 === 1 && n % 100 !== 11) ? 'запись' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'записи' : 'записей';

  const platformMap = Object.fromEntries(platformItems.map(p => [p.code, p]));
  const auditMap = Object.fromEntries(auditPlatforms.map(p => [p.code, p]));
  const entMap = Object.fromEntries(enterprises.map(e => [e.id, e]));
  const allEntMap = Object.fromEntries(allEntities.map(e => [e.id, e]));
  const aliasesByOrg = {};
  enterprises.forEach(e => {
    if (!e || !e.id) return;
    aliasesByOrg[e.id] = [e.query, ...(e.aliases || [])].filter(Boolean);
  });

  // Фаза вычисляется из статуса и дедлайна, а не берётся из сохранённого поля:
  // запись с прошедшим сроком или статусом «Работа комиссии» — завершённая.
  function effectivePhase(r) {
    const s = norm(r.status || r.stage || '');
    if (/заверш|отмен|несостоявш|прекращ|архив|работ.*комисс|closed|cancel/.test(s)) return 'archive';
    if (!r.deadline) return 'active';
    return String(r.deadline).slice(0, 10) >= new Date().toISOString().slice(0, 10) ? 'active' : 'archive';
  }

  function fmtDate(s) {
    if (!s) return '—';
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : esc(s);
  }
  function moneyValue(s) {
    // Цена приходит в разных форматах: «25182027.08 ₽», «3 295 421,86 ₽», «965464 ₽».
    const raw = String(s == null ? '' : s)
      .replace(/[\u00a0\u202f\s]/g, '')
      .replace(/,/g, '.')
      .replace(/[^\d.]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  function priceNum(s) { return moneyValue(s); }
  function dateChip(s, kind, published) {
    const text = fmtDate(s);
    if (text === '—') return '<span class="muted-value">—</span>';
    let cls = 't-date';
    if (kind === 'deadline') {
      const end = Date.parse(String(s).slice(0, 10) + 'T23:59:59');
      if (!isNaN(end)) {
        const days = Math.ceil((end - Date.now()) / 86400000);
        const pub = Date.parse(String(published || '').slice(0, 10) + 'T00:00:00');
        const span = !isNaN(pub) && end > pub ? (end - pub) / 86400000 : 0;
        const part = span > 0 ? days / span : null;
        if (days < 0) cls += ' t-date--expired';
        else if (days <= 3 || (part != null && part <= 0.25)) cls += ' t-date--soon';
        else if (days <= 10 || (part != null && part <= 0.6)) cls += ' t-date--mid';
        else cls += ' t-date--plan';
      }
    } else cls += ' t-date--pub';
    return '<span class="' + cls + '">' + esc(text) + '</span>';
  }
  function fmtMoney(v) {
    if (v == null || v === '') return '—';
    const n = moneyValue(v);
    if (!n) return esc(String(v));
    const hasFraction = /[.,]\d/.test(String(v));
    return n.toLocaleString('ru-RU', { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 }) + ' ₽';
  }
  function badge(text, cls) { return '<span class="t-badge t-badge--' + esc(cls) + '">' + esc(text) + '</span>'; }
  function lawLabel(law) {
    const v = String(law || '');
    if (v === '44') return '44-ФЗ';
    if (v === '223') return '223-ФЗ';
    if (v === '615') return '615-ПП';
    if (v === 'commercial' || v === 'comm' || v === 'zmo') return 'коммерческая';
    return '';
  }

  function platformOf(r) {
    const code = r.platformCode || r.etp || 'OTHER';
    const meta = platformMap[code] || auditMap[code];
    return {
      code,
      name: r.platformName || (meta && meta.name) || (code === 'EIS' ? 'ЕИС' : code)
    };
  }
  function sourceRank(r) {
    const s = norm((r.source || '') + ' ' + (r.sourceName || ''));
    if (/gosplan|госplan|гос ?план|eis-html|еис/.test(s)) return 0;
    if (/gentender/.test(s)) return 3;
    return 1;
  }
  function viaNames(r) {
    const list = (r.sources || []).map(s => s.sourceName || s.source).filter(Boolean);
    return [...new Set(list.length ? list : (r.sourceName ? [r.sourceName] : []))];
  }
  function sourceHtml(r) {
    const p = platformOf(r);
    const law = lawLabel(r.law);
    const primary = p.name + (law ? ' · ' + law : '');
    const names = viaNames(r).filter(n => norm(n) !== norm(p.name));
    const via = names.length > 1 ? names[0] + ' +' + (names.length - 1) : (names[0] || '');
    return badge(primary, 'src') + (via
      ? '<span class="t-badge t-badge--via" title="Получено через: ' + esc(viaNames(r).join(', ')) + '">через: ' + esc(via) + '</span>'
      : '');
  }
  function entName(id) {
    return (entMap[id] && entMap[id].name) || (allEntMap[id] && allEntMap[id].name) || id;
  }
  function entNames(r) {
    const ids = [...new Set([...(r.enterpriseIds || []), r.matchedOrgId].filter(Boolean))];
    return ids.map(entName).join(', ');
  }
  function orgNamesFor(r) {
    const names = [r.matchedOrgName, r.customer].filter(Boolean);
    const ids = [...new Set([...(r.enterpriseIds || []), r.matchedOrgId].filter(Boolean))];
    ids.forEach(id => {
      const e = entMap[id] || allEntMap[id];
      if (e) names.push(e.name, e.full);
      (aliasesByOrg[id] || []).forEach(a => names.push(a));
    });
    return names.filter(Boolean);
  }

  /* ---------- фильтрация ---------- */
  function entMatches(r, e) {
    if (!e) return true;
    if ((r.enterpriseIds || []).includes(e.id) || r.matchedOrgId === e.id) return true;
    const names = [e.name, e.full, ...(aliasesByOrg[e.id] || [])].filter(Boolean);
    return names.some(n => tm.queryMatches(n, '', [], r.customer, orgNamesFor(r)));
  }

  function keywordHit(r, label) {
    if (!label) return true;
    if ((r.matchedKeywords || r.keywords || []).some(x => norm(x) === norm(label))) return true;
    return tm.matchesEntry(r.title || '', entryOfLabel(label));
  }

  function filtered() {
    const q = state.q;
    // Старые объявления (старше 30 дней по публикации/дедлайну) не показываем ни в одном режиме.
    const maxAgeDays = Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30);
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString().slice(0, 10);
    let list = records.filter(r => {
      const when = String(r.published || r.deadline || '').slice(0, 10);
      if (when && when < cutoff) return false;
      const phase = effectivePhase(r);
      if (state.mode === 'archive' && phase !== 'archive') return false;
      if (state.mode === 'active' && phase !== 'active') return false;
      if (q && !state.keyword && !tm.queryMatches(q, r.title, r.matchedKeywords || r.keywords, r.customer, orgNamesFor(r))) return false;
      if (state.enterprise) {
        const ent = allEntMap[state.enterprise] || entMap[state.enterprise];
        if (!entMatches(r, ent)) return false;
      }
      if (state.from && String(r.published || '') < state.from) return false;
      if (state.to && String(r.published || '') > state.to) return false;
      if (state.source && platformOf(r).code !== state.source) return false;
      if (!keywordHit(r, state.keyword)) return false;
      return true;
    });
    const cmp = {
      date: (a, b) => {
        // Сначала действующие, внутри них — ЕИС, затем остальные площадки;
        // в пределах группы — по дате публикации.
        const pa = effectivePhase(a) === 'active' ? 0 : 1;
        const pb = effectivePhase(b) === 'active' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const ra = platformOf(a).code === 'EIS' ? 0 : sourceRank(a);
        const rb = platformOf(b).code === 'EIS' ? 0 : sourceRank(b);
        if (ra !== rb) return ra - rb;
        const d = String(b.published || b.deadline || '').localeCompare(String(a.published || a.deadline || ''));
        if (d) return d;
        return String(platformOf(a).name).localeCompare(String(platformOf(b).name), 'ru');
      },
      deadline: (a, b) => {
        const pa = effectivePhase(a) === 'active' ? 0 : 1;
        const pb = effectivePhase(b) === 'active' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const da = a.deadline || '9999-12-31';
        const db = b.deadline || '9999-12-31';
        const d = String(da).localeCompare(String(db));
        return d || String(b.published || '').localeCompare(String(a.published || ''));
      },
      new: (a, b) => {
        const pa = effectivePhase(a) === 'active' ? 0 : 1;
        const pb = effectivePhase(b) === 'active' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const d = String(b.published || b.deadline || '').localeCompare(String(a.published || a.deadline || ''));
        return d || String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      },
      name: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'),
      company: (a, b) => String(a.customer || '').localeCompare(String(b.customer || ''), 'ru'),
      price: (a, b) => priceNum(b.price) - priceNum(a.price)
    }[state.sort] || (() => 0);
    return list.sort(cmp);
  }

  function matchReasons(r) {
    const out = [];
    const kws = r.matchedKeywords || r.keywords || [];
    kws.forEach(k => out.push({ type: 'keyword', text: k }));
    if (state.enterprise) {
      const e = allEntMap[state.enterprise] || entMap[state.enterprise];
      if (e) out.push({ type: 'customer', text: e.name });
    } else if (state.q) {
      tm.tokenizeQuery(state.q).forEach(tok => {
        if (kws.some(k => tm.matchesKeyword(k, tok)) || tm.matchesKeyword(r.title, tok)) {
          if (!out.some(x => x.type === 'keyword' && norm(x.text) === norm(tok))) out.push({ type: 'keyword', text: tok });
        } else if (tm.queryMatches(tok, '', [], r.customer, orgNamesFor(r))) {
          if (!out.some(x => x.type === 'customer' && norm(x.text) === norm(tok))) out.push({ type: 'customer', text: tok });
        }
      });
    }
    if (!out.length) {
      // Закупка попала в выдачу, потому что её заказчик есть в реестре.
      const org = r.matchedOrgName || entNames(r);
      if (org) out.push({ type: 'org', text: r.matchedOrgName || org });
    }
    return out;
  }
  function matchHtml(r) {
    const reasons = matchReasons(r);
    if (!reasons.length) return '';
    const onlyOrg = reasons.every(x => x.type === 'org');
    const label = onlyOrg ? 'Заказчик из реестра' : 'Совпадение';
    const plat = platformOf(r);
    return '<div class="t-match"><span class="t-match__label">' + label + ':</span> ' +
      reasons.slice(0, 4).map(x => '<span class="t-match__item t-match__item--' + x.type + '">' + esc(x.text) + '</span>').join(' ') +
      '<span class="t-match__item t-match__item--platform" title="Площадка публикации">' + esc(plat.name) + '</span>' +
      '</div>';
  }

  /* Подробная карточка закупки — тот же компонент .modal, что и в реестре. */
  let currentTender = null;
  function focusTerm(r) {
    const list = [];
    if (state.keyword) list.push(state.keyword);
    if (state.q && tm.tokenizeQuery) list.push(...tm.tokenizeQuery(state.q));
    list.push(...(r.matchedKeywords || r.keywords || []));
    const title = String(r.title || '').toLowerCase();
    return list.map(x => String(x || '')).find(x => x && title.includes(x.toLowerCase())) || '';
  }
  function placeKeywordHint(r) {
    const box = $('tDetailKeyword');
    const title = $('tDetailTitle');
    if (!box || !title) return;
    const marks = [...title.querySelectorAll('mark')];
    const term = focusTerm(r) || (marks[0] ? marks[0].innerText.trim() : '');
    if (!term) { box.hidden = true; return; }
    let hiddenByClamp;
    if (marks.length) {
      const line = parseFloat(getComputedStyle(title).lineHeight) || 26;
      const top = title.getBoundingClientRect().top;
      hiddenByClamp = !marks.some(m => m.getBoundingClientRect().top - top < line * 4 - 2);
    } else {
      hiddenByClamp = String(r.title || '').toLowerCase().indexOf(term.toLowerCase()) > 220;
    }
    if (hiddenByClamp) {
      box.innerHTML = '… <b>' + esc(term) + '</b> …';
      box.hidden = false;
    } else box.hidden = true;
  }
  function openTenderDetail(id) {
    const r = records.find(x => x.id === id);
    if (!r) return;
    currentTender = r;
    const kv = (label, value) => value ? '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>' : '';
    const via = viaNames(r).join(', ');
    $('tDetailKicker').textContent = (lawLabel(r.law) || 'Закупка') + ' · ' + platformOf(r).name;
    $('tDetailTitle').innerHTML = tm.highlightEntryHtml(r.title || r.id, entriesFor(r), esc);
    $('tDetailTitle').setAttribute('title', r.title || r.id);
    $('tDetailBadges').innerHTML = newBadge(r) + deadlineBadge(r) + sourceHtml(r);

    const body = [];
    body.push('<div class="sec"><h3>Основное</h3><dl class="kv">' +
      kv('Номер закупки', esc(r.regNumber || r.externalId || r.id)) +
      kv('Статус', esc(r.status || '—')) +
      kv('Закон / тип', esc(lawLabel(r.law) || '—')) +
      kv('Цена', '<b class="t-price">' + fmtMoney(r.price) + '</b>') +
    '</dl></div>');
    body.push('<div class="sec"><h3>Заказчик</h3><dl class="kv">' +
      kv('Наименование', orgLink(r, r.customer)) +
      kv('ИНН', r.customerInn ? orgLink(r, r.customerInn) : '') +
      kv('Предприятие реестра', esc(entNames(r) || (registryOrg(r) ? registryOrg(r).name : '—'))) +
    '</dl></div>');
    body.push('<div class="sec"><h3>Сроки</h3><dl class="kv">' +
      kv('Опубликовано', dateChip(r.published, 'published')) +
      kv('Подача заявок до', dateChip(r.deadline, 'deadline', r.published)) +
      kv('Обновлено', esc(fmtDate(r.updated) || '—')) +
    '</dl></div>');
    const sources = (r.sources || []).map(s => {
      const name = s.sourceName || s.source || s.platformCode || 'Источник';
      return s.url
        ? '<a class="tag tag--link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(name) + '</a>'
        : '<span class="tag">' + esc(name) + '</span>';
    }).join('');
    body.push('<div class="sec"><h3>Площадка и источники</h3>' +
      '<div class="meth">Опубликовано на: ' + esc(platformOf(r).name) + '</div>' +
      '<div class="meth">Получено через: ' + esc(via || '—') + '</div>' +
      (sources ? '<div class="srcs" style="margin-top:8px">' + sources + '</div>' : '') +
    '</div>');
    body.push('<div class="sec"><h3>Почему в выборке</h3>' +
      (matchHtml(r) || '<span class="muted-value">Закупка найдена по ключевым словам или заказчику из реестра.</span>') + '</div>');

    $('tDetailBody').innerHTML = body.join('');
    $('tDetailBody').scrollTop = 0;
    $('tDetailOpen').href = r.url || '#';
    $('tDetailCopy').dataset.copy = r.regNumber || r.externalId || r.id;
    const fav = $('tDetailFav');
    if (TF && fav) {
      const on = TF.has('tender', r.id);
      fav.textContent = on ? '★' : '☆';
      fav.classList.toggle('is-fav', on);
    }
    $('tenderModal').hidden = false;
    document.body.style.overflow = 'hidden';
    if (window.EnergoUI && window.EnergoUI.positionReturnBar) window.EnergoUI.positionReturnBar();
    setTimeout(() => placeKeywordHint(r), 60); // фоновые вкладки не всегда выполняют rAF
  }
  function closeTenderDetail() {
    $('tenderModal').hidden = true;
    document.body.style.overflow = '';
    currentTender = null;
    if (window.EnergoUI && window.EnergoUI.positionReturnBar) window.EnergoUI.positionReturnBar();
  }

  /* ---------- вывод ---------- */
  /* Понятная свежесть данных: если ни одно окно сбора не сработало,
   * пользователь сразу видит, что данные не сегодняшние. */
  function updatedText(status) {
    if (!status || !status.lastRun) return 'Обновлено: нет данных';
    const d = new Date(status.lastRun);
    if (isNaN(d.getTime())) return 'Обновлено: ' + status.lastRun;
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const age = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : days + ' дн. назад';
    const warn = days >= 2 ? ' · данных несколько дней нет — ближайшее окно сбора обновит выдачу' : '';
    return 'Обновлено: ' + d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (' + age + ')' + warn +
      (status.total != null ? ' · закупок: ' + status.total : '') +
      (status.bySource ? ' · площадок: ' + Object.keys(status.bySource).length : '');
  }

  function newBadge(r) {
    return r.isNew
      ? '<span class="t-badge t-badge--new" title="Появилось по сравнению со вчерашним днём">Новое</span>'
      : '';
  }
  // Логика фаз не меняем: это только подсказка по сроку в карточке.
  function deadlineBadge(r) {
    if (effectivePhase(r) === 'archive') return '';
    if (!r.deadline) return badge('Срок не указан', 'warn');
    const end = Date.parse(String(r.deadline).slice(0, 10) + 'T23:59:59');
    if (isNaN(end)) return badge('Срок не указан', 'warn');
    const days = Math.ceil((end - Date.now()) / 86400000);
    if (days < 0) return badge('Срок истёк — уточнить', 'warn');
    if (days === 0) return badge('Заканчивается сегодня', 'warn');
    if (days <= 2) return badge('Осталось ' + days + ' дн.', 'warn');
    return '';
  }

  function cardHtml(r) {
    const kws = (r.matchedKeywords || r.keywords || []).slice(0, 6)
      .map(k => '<span class="t-chip t-chip--mini t-chip--hit">' + esc(k) + '</span>').join('');
    const ent = entNames(r);
    return '<article class="t-card' + (r.isNew ? ' t-card--new' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="t-card__head"><button class="fav-star" type="button" data-fav-tender="' + esc(r.id) + '" aria-label="В избранное" title="В избранное">' + (TF && TF.has('tender', r.id) ? '★' : '☆') + '</button><span class="t-card__title" title="' + esc(r.title || r.id) + '">' +
        tm.highlightEntryHtml(r.title || r.id, entriesFor(r), esc) + '</span>' +
        newBadge(r) + deadlineBadge(r) + sourceHtml(r) +
      '</div>' +
      '<div class="t-card__body">' +
        matchHtml(r) +
        '<div><span class="t-label">Заказчик:</span> ' + orgLink(r, r.customer) +
          (r.customerInn ? ' <span class="t-mut">ИНН ' + orgLink(r, r.customerInn) + '</span>' : '') + '</div>' +
        (ent ? '<div><span class="t-label">Предприятие:</span> ' + esc(ent) + '</div>' : '') +
        (r.status ? '<div><span class="t-label">Статус:</span> ' + esc(r.status) + '</div>' : '') +
        '<div class="t-card__grid">' +
          '<div><span class="t-label">Опубликовано:</span> ' + dateChip(r.published, 'published') + '</div>' +
          '<div><span class="t-label">Заявки до:</span> ' + dateChip(r.deadline, 'deadline', r.published) + '</div>' +
          '<div><span class="t-label">Цена:</span> <b class="t-price">' + fmtMoney(r.price) + '</b></div>' +
          '<div><span class="t-label">Номер:</span> ' + esc(r.regNumber || r.externalId || r.id) + '</div>' +
        '</div>' +
        (kws ? '<div class="t-chips t-chips--mini">' + kws + '</div>' : '') +
      '</div></article>';
  }

  function rowHtml(r) {
    const td = (label, content, cls) =>
      '<td data-label="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + '><span class="t-cell">' + content + '</span></td>';
    return '<tr class="data-row' + (r.isNew ? ' t-row--new' : '') + '" data-id="' + esc(r.id) + '">' +
      td('Дата', fmtDate(r.published), 't-mut') +
      td('Название', '<button class="t-row__title" type="button">' +
        tm.highlightEntryHtml(r.title || r.id, entriesFor(r), esc) + '</button>' + newBadge(r)) +
      td('Заказчик', esc(r.customer || '—')) +
      td('Предприятие', esc(entNames(r) || '—')) +
      td('Цена', '<b class="t-price">' + fmtMoney(r.price) + '</b>') +
      td('Источник', sourceHtml(r)) +
      '</tr>';
  }

  function renderEtps() {
    const rows = auditPlatforms.map(p => {
      const b = p.browser || {};
      const status = b.status || (p.ok === true ? 'open' : (p.http === 403 || p.http === 503 ? 'blocked' : 'unreachable'));
      const view = {
        open:        ['доступна',   'ok'],
        partial:     ['частично',   'warn'],
        blocked:     ['ограничен',  'warn'],
        unreachable: ['недоступна', 'bad']
      }[status] || ['недоступна', 'bad'];
      const link = p.urlTemplate && p.urlTemplate.includes('{')
        ? p.urlTemplate.replace('{q}', encodeURIComponent(state.kwOrQuery())).replace('{company}', encodeURIComponent(state.kwOrQuery()))
        : p.url;
      const check = b.status
        ? 'проверка в браузере: <b>' + (b.http ? 'HTTP ' + b.http + ' · ' : '') + esc(String(b.checked || '').slice(0, 10)) +
          (b.source && b.source !== 'browser' ? ' · ' + esc(b.source) : '') + '</b>'
        : 'проверка: <b>' + esc(p.ms != null ? p.ms + ' мс / HTTP ' + p.http : 'нет данных') + '</b>';
      return '<article class="t-etp">' +
        '<div class="t-etp__head"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' + badge(view[0], view[1]) + '</div>' +
        '<div class="t-etp__meta">' +
          '<span>поиск без входа: <b>' + (p.publicSearch === true ? 'да' : (p.publicSearch === 'partial' ? 'частично' : 'нет/неизвестно')) + '</b></span>' +
          '<span>ключевое слово: <b>' + esc(p.keywordParam || (p.publicSearch === true ? 'да' : '—')) + '</b></span>' +
          '<span>надёжность: <b>' + esc(p.reliability || '—') + '</b></span>' +
          '<span>' + check + '</span>' +
        '</div>' +
        '<p>' + esc(p.notes || '') + '</p>' +
        (b.note ? '<p class="t-etp__note">' + esc(b.note) + '</p>' : '') +
        '<a class="btn btn--ghost btn--sm" href="' + esc(link) + '" target="_blank" rel="noopener">Открыть поиск</a>' +
      '</article>';
    }).join('');
    $('tEtps').innerHTML = rows;
  }

  state.kwOrQuery = () => state.keyword || state.q || 'турбина';

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
    document.querySelectorAll('[data-tmode]').forEach(b => {
      const on = b.dataset.tmode === state.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-tcards]').forEach(b => {
      const on = b.dataset.tcards === state.view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
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

  function sourceOptions() {
    const counts = {};
    records.forEach(r => {
      const p = platformOf(r);
      counts[p.code] = (counts[p.code] || 0) + 1;
    });
    return Object.keys(counts)
      .map(code => [code, (platformMap[code] || auditMap[code] || {}).name || code, counts[code]])
      .sort((a, b) => (a[0] === 'EIS' ? -1 : b[0] === 'EIS' ? 1 : a[1].localeCompare(b[1], 'ru')))
      .map(([code, name, n]) => [code, name + ' (' + n + ')']);
  }
  function rebuildSources() {
    fillSelect($('tSource'), sourceOptions(), 'Все площадки');
    if (state.source && !sourceOptions().some(([code]) => code === state.source)) state.source = '';
    $('tSource').value = state.source;
  }

  function renderKeywords() {
    $('tKeywords').innerHTML = '<button class="t-chip is-active" data-kw="" type="button">Все</button>' +
      keywords.map(k => '<button class="t-chip" data-kw="' + esc(k) + '" type="button">' + esc(k) + '</button>').join('');
    document.querySelectorAll('#tKeywords .t-chip').forEach(b => {
      b.classList.toggle('is-active', norm(b.dataset.kw) === norm(state.keyword));
      b.addEventListener('click', () => {
        const was = state.keyword;
        state.keyword = b.dataset.kw === was ? '' : b.dataset.kw;
        if (state.keyword) {
          state.q = state.keyword;
          state.enterprise = '';
          $('tQ').value = state.keyword;
          renderSelected();
        } else if (norm(state.q) === norm(was)) {
          // Сняли чип — убираем и подставленную фразу из поля поиска.
          state.q = '';
          $('tQ').value = '';
        }
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

  function renderSelected() {
    const box = $('tSelected');
    if (!box) return;
    const e = allEntMap[state.enterprise] || entMap[state.enterprise];
    if (!e) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<span class="t-selected__label">Заказчик:</span> <b>' + esc(e.name) + '</b>' +
      ' <button type="button" class="t-selected__x" aria-label="Убрать заказчика">×</button>';
    const x = box.querySelector('button');
    if (x) x.addEventListener('click', () => {
      state.enterprise = '';
      state.q = '';
      $('tQ').value = '';
      renderSelected();
      render();
    });
  }

  function selectEntity(id) {
    const e = allEntMap[id] || entMap[id];
    if (!e) return;
    state.enterprise = id;
    state.q = '';
    state.keyword = '';
    $('tQ').value = e.name;
    $('tSuggest').hidden = true;
    $('tLinkQuery').value = e.name;
    renderSelected();
    renderKeywords();
    render();
  }

  function renderSuggest() {
    const box = $('tSuggest');
    const raw = $('tQ').value.trim();
    const q = norm(raw);
    if (q.length < 2 || state.enterprise) { box.hidden = true; box.innerHTML = ''; return; }
    const kws = keywordEntries.filter(e => {
      const hay = norm([e.label, e.search, ...e.must.flat()].join(' '));
      return hay.includes(q) || e.must.some(g => g.some(s => tm.matchesKeyword(q, s) || tm.matchesKeyword(raw, s)));
    }).slice(0, 6);
    const ents = allEntities.filter(e =>
      norm(e.name + ' ' + e.full + ' ' + e.holding + ' ' + e.region + ' ' + e.inn).includes(q)
    ).slice(0, 8);
    if (!kws.length && !ents.length) { box.hidden = true; box.innerHTML = ''; return; }
    let html = '';
    if (kws.length) {
      html += '<div class="t-suggest__head">Ключевые слова и фразы</div>' +
        kws.map(e => '<button type="button" data-skw="' + esc(e.label) + '"><b>' + esc(e.label) + '</b><small>' +
          (e.must.length > 1 ? esc('все слова: ' + e.must.map(g => g.join(' / ')).join(' + ')) : 'искать в названиях закупок') +
          '</small></button>').join('');
    }
    if (ents.length) {
      html += '<div class="t-suggest__head">Заказчики и предприятия</div>' +
        ents.map(e => '<button type="button" data-ent="' + esc(e.id) + '"><b>' + esc(e.name) + '</b><small>' +
          esc([e.holding, e.region, e.type].filter(Boolean).join(' · ')) + '</small></button>').join('');
    }
    box.innerHTML = html;
    box.hidden = false;
    box.querySelectorAll('[data-ent]').forEach(b => b.addEventListener('click', () => selectEntity(b.dataset.ent)));
    box.querySelectorAll('[data-skw]').forEach(b => b.addEventListener('click', () => {
      state.keyword = b.dataset.skw;
      state.q = b.dataset.skw;
      state.enterprise = '';
      $('tQ').value = b.dataset.skw;
      $('tSuggest').hidden = true;
      renderSelected();
      renderKeywords();
      render();
    }));
  }

  function bind() {
    const input = (id, key, evt) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener(evt || 'change', () => { state[key] = el.value; render(); });
    };
    $('tQ').addEventListener('input', () => {
      state.q = $('tQ').value;
      state.enterprise = '';
      state.keyword = '';
      renderSelected();
      renderSuggest();
      render();
    });
    $('tQ').addEventListener('blur', () => {
      setTimeout(() => { if ($('tSuggest')) $('tSuggest').hidden = true; }, 180);
    });
    $('tQ').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { $('tSuggest').hidden = true; }
    });
    input('tDateFrom', 'from');
    input('tDateTo', 'to');
    input('tSource', 'source');
    input('tSort', 'sort');

    $('tReset').addEventListener('click', () => {
      Object.assign(state, { q: '', enterprise: '', from: '', to: '', source: '', keyword: '', view: 'cards', sort: 'date' });
      ['tQ', 'tDateFrom', 'tDateTo', 'tSource', 'tSort'].forEach(id => { if ($(id)) $(id).value = ''; });
      $('tSuggest').hidden = true;
      renderSelected();
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

    $('tOpenSearch').addEventListener('click', () => {
      const code = $('tLinkEtp').value;
      const p = auditMap[code] || platformMap[code];
      const q = $('tLinkQuery').value.trim() || state.keyword || state.q;
      if (!p) return;
      const tpl = p.urlTemplate && p.urlTemplate.includes('{') ? p.urlTemplate : p.url;
      const url = tpl.replace('{q}', encodeURIComponent(q)).replace('{company}', encodeURIComponent(q));
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    $('tCards').addEventListener('click', e => {
      const orgLinkEl = e.target.closest('[data-org-from-tender]');
      if (orgLinkEl) {
        const rec = records.find(x => x.id === orgLinkEl.dataset.orgFromTender);
        const org = rec && registryOrg(rec);
        if (org && window.EnergoRegistry) window.EnergoRegistry.openFromTender(org.id, rec.id, rec.title);
        return;
      }
      const star = e.target.closest('[data-fav-tender]');
      if (star) {
        if (TF) {
          TF.toggle('tender', star.dataset.favTender);
          star.textContent = TF.has('tender', star.dataset.favTender) ? '★' : '☆';
          window.dispatchEvent(new Event('energo-favorites-changed'));
        }
        return;
      }
      if (e.target.closest('a')) return;
      const card = e.target.closest('.t-card[data-id]');
      if (card) openTenderDetail(card.dataset.id);
    });
    $('tTbody').addEventListener('click', e => {
      const row = e.target.closest('tr[data-id]');
      if (row && !e.target.closest('a')) openTenderDetail(row.dataset.id);
    });
    $('tenderModal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeTenderDetail(); });
    $('tDetailBody').addEventListener('click', e => {
      const link = e.target.closest('[data-org-from-tender]');
      if (!link || !currentTender || !window.EnergoRegistry) return;
      const org = registryOrg(currentTender);
      if (!org) return;
      const r = currentTender;
      closeTenderDetail();
      window.EnergoRegistry.openFromTender(org.id, r.id, r.title);
    });
    $('tDetailFav').addEventListener('click', () => {
      if (!currentTender || !TF) return;
      TF.toggle('tender', currentTender.id);
      const on = TF.has('tender', currentTender.id);
      $('tDetailFav').textContent = on ? '★' : '☆';
      $('tDetailFav').classList.toggle('is-fav', on);
      document.querySelectorAll('[data-fav-tender]').forEach((el) => {
        if (el.dataset.favTender === currentTender.id) { el.textContent = on ? '★' : '☆'; el.classList.toggle('is-fav', on); }
      });
      window.dispatchEvent(new Event('energo-favorites-changed'));
    });
    $('tDetailCopy').addEventListener('click', () => {
      const value = $('tDetailCopy').dataset.copy || '';
      const done = () => { $('tDetailCopy').querySelector('span').textContent = 'Скопировано'; setTimeout(() => { $('tDetailCopy').querySelector('span').textContent = 'Копировать номер'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done).catch(() => {});
      else done();
    });

    $('tLinkQuery').addEventListener('input', () => { /* значение берётся при открытии */ });
  }

  function init() {
    if (!$('tendersView')) return;
    rebuildSources();
    fillSelect($('tLinkEtp'), auditPlatforms.filter(p => p.urlTemplate && p.urlTemplate.includes('{')).map(p => [p.code, p.name]), 'Выберите площадку');
    $('tLinkEtp').value = (auditPlatforms.find(p => p.code === 'EIS') || {}).code || '';
    $('tUpdated').textContent = updatedText(status);
    $('tVer').textContent = '2.1';
    document.querySelectorAll('[data-tmode]').forEach(b => b.classList.toggle('is-active', b.dataset.tmode === state.mode));
    renderSelected();
    renderKeywords(); bind(); render();
  }

  window.EnergoTenders = {
    onTab(tab) {
      if (tab === 'tenders') {
        if ($('tendersView')) $('tendersView').hidden = false;
        render();
      }
    },
    setQuery(text) {
      state.q = String(text || '');
      state.keyword = '';
      state.enterprise = '';
      if ($('tQ')) $('tQ').value = state.q;
      renderSelected();
      render();
    },
    openDetail(id) { openTenderDetail(id); },
    closeDetail() { if (!$('tenderModal').hidden) closeTenderDetail(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
