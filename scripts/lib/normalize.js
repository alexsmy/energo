#!/usr/bin/env node
/* Единая схема записи, дедупликация источников и определение фазы закупки. */
'use strict';
const { platformName, lawLabel, sourceRank } = require('./platforms');
const { customerDisplay } = require('./match-org');
const tm = require('../../js/text-match');

const norm = tm.norm;
const day = (s) => (s ? String(s).slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

function priceNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function fmtPrice(v) {
  const n = priceNum(v);
  if (!n) return '';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function normTitle(s) {
  return norm(String(s || '').replace(/[«»"']/g, ' '));
}
const digitsOnly = (s) => String(s == null ? '' : s).replace(/\D/g, '');

/* Номер ЕИС бывает короче 15 цифр (например, 11-значные 223-ФЗ).
 * Опора на закон/источник надёжнее, чем жёсткая длина. */
function isEisReg(value, r) {
  const d = digitsOnly(value);
  if (d.length < 10 || d.length > 30) return false;
  if (r && (r.law === '44' || r.law === '223' || r.law === '615')) return true;
  if (r && r.platformCode === 'EIS') return true;
  return d.length >= 15; // старое поведение для неизвестного закона
}

/* Организационно-правовая форма не должна различать одну и ту же запись. */
const OPF = [
  [/публичное акционерное общество/g, 'пао'],
  [/акционерное общество/g, 'ао'],
  [/общество с ограниченной ответственностью/g, 'ооо'],
  [/федеральное государственное унитарное предприятие/g, 'фгуп'],
  [/государственное унитарное предприятие/g, 'гуп'],
  [/муниципальное унитарное предприятие/g, 'муп'],
  [/открытое акционерное общество/g, 'оао'],
  [/закрытое акционерное общество/g, 'зао']
];
function normCustomer(s) {
  let v = norm(String(s || '').replace(/[«»"'`.,]/g, ' '));
  OPF.forEach(([re, to]) => { v = v.replace(re, to); });
  return v.replace(/\s+/g, ' ').trim();
}

function eisUrl(reg, law) {
  const d = digitsOnly(reg);
  if (!d) return '';
  if (law === '223') return 'https://zakupki.gov.ru/223/purchase/public/purchase/info/common-info.html?regNumber=' + encodeURIComponent(d);
  if (law === '44') return 'https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=' + encodeURIComponent(d);
  return 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + encodeURIComponent(d);
}

/* Действующая закупка: дедлайн не прошёл, статус не завершён/отменён. */
function isActive(r, date) {
  const s = norm(r.status || r.stage || '');
  if (/заверш|отмен|несостоявш|прекращ|архив|работ.*комисс|closed|cancel/.test(s)) return false;
  if (!r.deadline) return true;
  return String(r.deadline).slice(0, 10) >= (date || today());
}
function phaseOf(r, explicit) {
  if (explicit === 'active' || explicit === 'archive') return explicit;
  return isActive(r) ? 'active' : 'archive';
}

/* ЕИС подсвечивает совпадения в выдаче тегами прямо внутри слов:
 * «Гидро<span>уплотнен</span>ия», «газо<span>турбинной</span>».
 * Старый парсер менял любой тег на пробел. Восстанавливаем только по
 * закрытому списку приставок и окончаний — случайные словосочетания не трогаем. */
const TITLE_ENDINGS = new Set([
  'ия', 'ие', 'ого', 'его', 'ому', 'ему', 'ный', 'ных', 'ному', 'нему',
  'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ым', 'им', 'ых', 'их', 'ой',
  'ей', 'ую', 'юю', 'ной', 'ное', 'ного'
]);
/* \b в JS не работает с кириллицей (\w — только латиница), поэтому границу
 * задаём через предшествующий не-буквенный символ. Регистр перечисляем явно:
 * lookahead должен ловить только строчную букву, иначе «Тепло Территории»
 * склеилось бы в «ТеплоТерритории». */
const PREFIX_WORDS = [
  'газо', 'гидро', 'турбо', 'котло', 'тепло', 'электро', 'паро', 'водо',
  'нефте', 'угле', 'авто', 'моно', 'мульти', 'сверх', 'меж', 'поли'
];
const PREFIX_ALT = PREFIX_WORDS.map((p) => p[0].toUpperCase() + p.slice(1) + '|' + p).join('|');
const PREFIX_RE = new RegExp('(^|[^а-яёА-ЯЁ])(' + PREFIX_ALT + ')\\s+(?=[а-яё])', 'g');
const ENDING_RE = /([а-яё]{4,}) (ия|ие|ого|его|ому|ему|ный|ных|ному|нему|ый|ий|ая|яя|ое|ее|ые|ым|им|ых|их|ой|ей|ую|юю|ной|ное|ного)(?=[\s.,;:)"']|$)/gi;

/* Признак разбитого слова: используется и для починки, и для выбора
 * более чистого заголовка при слиянии одного тендера из разных источников. */
function splitWordScore(value) {
  const s = String(value || '');
  let n = (s.match(PREFIX_RE) || []).length;
  PREFIX_RE.lastIndex = 0;
  n += (s.match(ENDING_RE) || []).length;
  ENDING_RE.lastIndex = 0;
  return n;
}

function repairTitle(value) {
  let s = String(value || '').replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    PREFIX_RE.lastIndex = 0;
    s = s.replace(PREFIX_RE, '$1$2');
    ENDING_RE.lastIndex = 0;
    s = s.replace(ENDING_RE, (m, left, right) =>
      (TITLE_ENDINGS.has(right.toLowerCase()) ? left + right : m));
    if (s === before) break;
  }
  return s;
}

function sourceEntry(r) {
  return {
    source: r.source || '',
    sourceName: r.sourceName || '',
    platformCode: r.platformCode || r.etp || '',
    platformName: r.platformName || platformName(r.platformCode || r.etp),
    url: r.url || '',
    foundAt: r.foundAt || ''
  };
}

/* Единая запись. Все адаптеры приводят данные сюда. */
function makeRecord(f) {
  const platformCode = f.platformCode || f.etp || 'OTHER';
  const rec = {
    id: f.id || '',
    regNumber: f.regNumber || '',
    externalId: f.externalId || '',
    title: repairTitle(f.title),
    customer: f.customer || '',
    customerInn: f.customerInn || '',
    customerCode: f.customerCode || '',
    matchedOrgId: f.matchedOrgId || '',
    matchedOrgName: f.matchedOrgName || '',
    platformCode,
    platformName: f.platformName || platformName(platformCode),
    platformUrl: f.platformUrl || '',
    source: f.source || '',
    sourceName: f.sourceName || '',
    law: f.law || '',
    price: f.price || fmtPrice(f.priceNum),
    priceNum: priceNum(f.priceNum != null ? f.priceNum : f.price),
    published: day(f.published),
    deadline: day(f.deadline),
    updated: day(f.updated),
    status: f.status || '',
    stage: f.stage != null ? f.stage : '',
    phase: phaseOf({ status: f.status, stage: f.stage, deadline: f.deadline }, f.phase),
    url: f.url || f.platformUrl || '',
    keywords: [...new Set(f.keywords || [])],
    matchedKeywords: [...new Set(f.matchedKeywords || [])],
    enterpriseIds: [...new Set(f.enterpriseIds || [])],
    foundAt: f.foundAt || new Date().toISOString(),
    lastSeen: f.lastSeen || f.foundAt || new Date().toISOString()
  };
  if (f.org) applyOrg(rec, f.org);
  if (!rec.id) rec.id = rec.regNumber || (platformCode + ':' + (rec.externalId || hash(normTitle(rec.title) + rec.customer)));
  rec.sources = f.sources && f.sources.length ? f.sources : [sourceEntry(rec)];
  return rec;
}

function applyOrg(r, org) {
  if (!org) return r;
  r.matchedOrgId = org.id;
  r.matchedOrgName = org.name;
  if (!r.customer || /^\d+$/.test(String(r.customer)) || String(r.customer).length < 6) {
    r.customer = customerDisplay(r.customer, org);
  }
  if (!r.customerInn && org.inn) r.customerInn = org.inn;
  r.enterpriseIds = [...new Set([...(r.enterpriseIds || []), org.id])];
  return r;
}

function mapGosplan(p, org, foundAt, query, law) {
  const reg = String(p.purchase_number || '');
  const platformCode = 'EIS';
  return makeRecord({
    id: reg,
    regNumber: reg,
    externalId: reg,
    title: p.object_info || '',
    customer: p.customer || '',
    customerInn: (org && org.inn) || (/^\d{10,}$/.test(String(p.customer || '')) ? p.customer : ''),
    customerCode: /^\d{10,}$/.test(String(p.customer || '')) ? p.customer : '',
    org,
    platformCode,
    platformName: platformName(platformCode),
    platformUrl: 'https://zakupki.gov.ru',
    source: 'gosplan',
    sourceName: 'ГосПлан API',
    law: law || '',
    priceNum: p.max_price,
    published: p.published_at,
    deadline: p.submission_close_at,
    updated: p.updated_at,
    status: p.stage === 1 || p.stage === 2 ? 'Подача заявок' : 'Завершена',
    stage: p.stage,
    phase: (p.stage === 1 || p.stage === 2) ? 'active' : 'archive',
    url: eisUrl(reg, law),
    foundQuery: query || '',
    foundAt,
    lastSeen: foundAt
  });
}

function mapGentender(row, org, foundAt, query, phase) {
  const rawLaw = String(row.law || '');
  const law = rawLaw === '44' || rawLaw === '223' || rawLaw === '615' ? rawLaw : (rawLaw === 'zmo' ? 'commercial' : (rawLaw || ''));
  const platform = require('./platforms').canonicalPlatform(row.etp_name, row.etp_url || row.detail_url);
  const reg = String(row.reg_number || '');
  const isEisNumber = isEisReg(reg, { law, platformCode: platform.code });
  const rec = makeRecord({
    id: isEisNumber ? digitsOnly(reg) : (platform.code + ':' + (reg || row.detail_url || hash(normTitle(row.title || '')))),
    regNumber: isEisNumber ? digitsOnly(reg) : '',
    externalId: reg,
    title: row.title || '',
    customer: row.customer_name || '',
    customerInn: row.customer_code || (/^\d{10,}$/.test(String(row.customer_key || '')) ? row.customer_key : ''),
    customerCode: row.customer_code || (/^\d{10,}$/.test(String(row.customer_key || '')) ? row.customer_key : ''),
    org,
    platformCode: platform.code,
    platformName: platform.name,
    platformUrl: row.etp_url || '',
    source: 'gentender',
    sourceName: 'GenTender',
    law,
    priceNum: row.price,
    published: row.publish_date,
    deadline: row.deadline_date,
    updated: row.publish_date,
    status: row.status_label || '',
    stage: row.status || '',
    phase,
    url: row.detail_url || row.etp_url || '',
    foundQuery: query || '',
    foundAt,
    lastSeen: foundAt
  });
  return rec;
}

/* ---------- дедупликация ---------- */
function textKeys(r) {
  const keys = [];
  const t = normTitle(r.title);
  const c = normCustomer(r.customer || r.matchedOrgName || '');
  // ИНН сильнее текста, но сам по себе не склеивает разные процедуры одного
  // заказчика; поэтому он входит только в составной ключ вместе с датой/ценой.
  const anchor = digitsOnly(r.customerInn || r.matchedOrgId || '') || c;
  const price = r.priceNum ? String(Math.round(r.priceNum)) : '';
  const when = r.deadline || r.published || '';
  if (t && c && t.length >= 8) {
    // Дата обязательна: без неё легко склеить разные закупки одного заказчика
    // с одинаковым названием и ценой (например, повторяющиеся лоты).
    keys.push('txt:' + hash(t + '|' + anchor + '|' + c + '|' + price + '|' + when));
  }
  return keys;
}

function identityKeys(r) {
  const keys = [];
  const reg = digitsOnly(r.regNumber || (isEisReg(r.id, r) ? r.id : ''));
  if (reg.length >= 10) keys.push('reg:' + reg);
  const ext = digitsOnly(r.externalId);
  if (r.platformCode === 'EIS' && ext.length >= 10) keys.push('reg:' + ext);
  if (r.platformCode && r.externalId) keys.push('pid:' + r.platformCode + ':' + norm(String(r.externalId)));
  keys.push(...textKeys(r));
  return keys;
}

function mergeSources(a, b) {
  const out = [];
  const seen = new Set();
  [...(a || []), ...(b || [])].forEach((s) => {
    if (!s) return;
    const key = [s.source, s.sourceName, s.platformCode, s.url].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out;
}

function mergeTwo(a, b) {
  const ra = sourceRank(a), rb = sourceRank(b);
  // При равном приоритете источника берём заголовок без признаков разбиения
  // слов — иначе старый кривой вариант ЕИС перекрывает новый исправленный.
  const first = ra < rb || (ra === rb && splitWordScore(a.title) <= splitWordScore(b.title)) ? a : b;
  const second = first === a ? b : a;
  const out = { ...first };
  // Заполняем пустые поля из второго источника.
  for (const k of Object.keys(second)) {
    if (k === 'sources' || k === 'keywords' || k === 'matchedKeywords' || k === 'enterpriseIds') continue;
    if (out[k] == null || out[k] === '' || out[k] === 0) out[k] = second[k];
  }
  // Человеческое название заказчика важнее ИНН.
  if (!out.customer || /^\d+$/.test(String(out.customer))) {
    if (second.customer && !/^\d+$/.test(String(second.customer))) out.customer = second.customer;
  }
  if ((!out.customerInn || out.customerInn.length < 10) && second.customerInn && second.customerInn.length >= 10) out.customerInn = second.customerInn;
  // Общий поисковый URL ЕИС заменяем прямой ссылкой на процедуру, если она есть.
  const ua = String(out.url || ''), ub = String(second.url || '');
  if (/extendedsearch\/results\.html|searchString=/.test(ua) && ub && !/extendedsearch\/results\.html|searchString=/.test(ub)) out.url = ub;
  if (!out.regNumber && isEisReg(out.id, out)) out.regNumber = digitsOnly(out.id);
  out.keywords = [...new Set([...(a.keywords || []), ...(b.keywords || [])])];
  out.matchedKeywords = [...new Set([...(a.matchedKeywords || []), ...(b.matchedKeywords || [])])];
  out.enterpriseIds = [...new Set([...(a.enterpriseIds || []), ...(b.enterpriseIds || [])])];
  out.sources = mergeSources(a.sources || [sourceEntry(a)], b.sources || [sourceEntry(b)]);
  out.foundAt = [a.foundAt, b.foundAt].filter(Boolean).sort()[0] || out.foundAt;
  out.lastSeen = [a.lastSeen, b.lastSeen].filter(Boolean).sort().pop() || out.lastSeen;
  // Фаза: если хотя бы один источник считает закупку действующей — active.
  if (a.phase === 'active' || b.phase === 'active') out.phase = 'active';
  return out;
}

function dedup(prev, next, limit) {
  const all = [...(prev || []), ...(next || [])].filter((r) => r && r.id);
  const parent = all.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const keyMap = new Map();
  all.forEach((r, i) => {
    identityKeys(r).forEach((k) => {
      if (keyMap.has(k)) union(i, keyMap.get(k));
      else keyMap.set(k, i);
    });
  });
  const groups = new Map();
  all.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });
  const merged = [...groups.values()].map((group) => group.reduce((acc, r) => mergeTwo(acc, r)));
  return merged
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase === 'active' ? -1 : 1;
      const d = String(b.published || '').localeCompare(String(a.published || ''));
      if (d) return d;
      const sr = (a.platformCode === 'EIS' ? 0 : sourceRank(a)) - (b.platformCode === 'EIS' ? 0 : sourceRank(b));
      if (sr) return sr;
      return String(a.platformName || '').localeCompare(String(b.platformName || ''), 'ru');
    })
    .slice(0, limit);
}

module.exports = {
  day, norm, priceNum, fmtPrice, normTitle, hash, isActive, phaseOf, repairTitle, splitWordScore,
  makeRecord, applyOrg, mapGosplan, mapGentender, dedup, identityKeys,
  mergeTwo, sourceEntry, lawLabel, digitsOnly, isEisReg, normCustomer, eisUrl
};
