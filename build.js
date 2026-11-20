#!/usr/bin/env node
/* Сборка реестра: entities.tsv + plants.tsv -> js/data.js, registry.csv, print.html */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const META = {
  title: 'Энергогенерирующие и энергоремонтные предприятия РФ',
  subtitle: 'Проверенный реестр для работы с закупками и подрядчиками',
  version: '1.2',
  date: '2026-11-20',
  disclaimer: 'Данные собраны из открытых источников и проверены по состоянию на 20.11.2026. Поля с флагом «средняя» достоверность требуют подтверждения перед заключением договора. Контакты и кадровые назначения могут меняться.'
};

const ETPS = [
  { code: 'GPB', name: 'ЭТП ГПБ', url: 'https://etpgpb.ru', operator: 'Газпромбанк', note: 'Основная площадка Газпром энергохолдинга и ряда частных компаний' },
  { code: 'TEK', name: 'ТЭК-Торг', url: 'https://www.tektorg.ru', operator: 'ТЭК-Торг', note: 'Секция Группы «Интер РАО», ЭЛ5-Энерго, Юнипро' },
  { code: 'ROS', name: 'Росэлторг (ЕЭТП)', url: 'https://www.roseltorg.ru', operator: 'Росэлторг', note: 'Секции РусГидро, Росатома, СГК, Т Плюс' },
  { code: 'RAD', name: 'РАД / Lot-online', url: 'https://www.lot-online.ru', operator: 'Российский аукционный дом', note: 'Вторая официальная площадка РусГидро, ТЭК СПб' },
  { code: 'B2B', name: 'B2B-Center', url: 'https://www.b2b-center.ru', operator: 'B2B-Center', note: 'Т Плюс, СГК, Юнипро, Форвард, ремонтные компании' },
  { code: 'FAB', name: 'Фабрикант', url: 'https://www.fabrikant.ru', operator: 'Фабрикант', note: 'Росатом, СГК, Юнипро, Форвард' },
  { code: 'AST', name: 'АСТ ГОЗ', url: 'https://www.astgoz.ru', operator: 'АСТ ГОЗ', note: 'Закрытые процедуры по КИИ, безопасности, гособоронзаказу' },
  { code: 'SBER', name: 'Сбербанк-АСТ', url: 'https://www.sberbank-ast.ru', operator: 'Сбербанк-АСТ', note: 'Татэнерго, ТГК-2, ТГК-14, ТЭК СПб' },
  { code: 'RTS', name: 'РТС-тендер', url: 'https://www.rts-tender.ru', operator: 'РТС-тендер', note: 'ТГК-2, ТГК-14, Татэнерго' },
  { code: 'ZAKAZ', name: 'ЗаказРФ', url: 'https://etp.zakazrf.ru', operator: 'Агентство по госзаказу РТ', note: 'Специализированная площадка Татарстана' },
  { code: 'KIM', name: 'КИМ Росатома', url: 'https://kim.rosatom.ru', operator: 'Росатом', note: 'Корпоративный интернет-магазин малых закупок' },
  { code: 'PORTAL_ROS', name: 'Портал закупок Росатома', url: 'https://zakupki.rosatom.ru', operator: 'Росатом', note: 'Отраслевой портал, интегрирован с ЕИС и ЭТП' },
  { code: 'ETP_IRAO', name: 'ЭТП Интер РАО', url: 'https://etp.interrao.ru', operator: 'Интер РАО', note: 'Корпоративная площадка группы' },
  { code: 'ETP_RUSH', name: 'Портал закупок РусГидро', url: 'https://zakupki.rushydro.ru', operator: 'РусГидро', note: 'Публикация закупок и работа с поставщиками' },
  { code: 'BIDZAAR', name: 'Bidzaar', url: 'https://bidzaar.com', operator: 'Bidzaar', note: 'Коммерческие закупки Эн+ и других групп' },
  { code: 'EIS', name: 'ЕИС Закупки', url: 'https://zakupki.gov.ru/epz/main/public/home.html', operator: 'Казначейство России', note: 'Официальный реестр 44-ФЗ/223-ФЗ, обязательная публикация' }
];

const SOURCES = [
  { id: 'S1', title: 'Официальные сайты компаний (контакты, реквизиты, закупки)', url: '', date: '2026-11-20', type: 'official' },
  { id: 'S2', title: 'Google AI-режим: сводные ответы по структуре и контактам', url: 'https://www.google.com/search?udm=50', date: '2026-11-20', type: 'ai' },
  { id: 'S3', title: 'Исходные документы заказчика: концепции списков 2025–2026', url: '', date: '2026-11-20', type: 'internal' },
  { id: 'S4', title: 'Wikipedia / отраслевые справочники (EnergyBase, e-disclosure)', url: '', date: '2026-11-20', type: 'reference' },
  { id: 'S5', title: 'ЕГРЮЛ, Руспрофиль, Контур.Фокус (реквизиты)', url: 'https://www.rusprofile.ru', date: '2026-11-20', type: 'registry' },
  { id: 'S6', title: 'Сайты ЭТП: реестры организаторов и секции закупок', url: '', date: '2026-11-20', type: 'etp' }
];

function parseTSV(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  const head = lines.shift().split('|').map(s => s.trim());
  return lines.map((line, i) => {
    const cells = line.split('|');
    const o = {};
    head.forEach((h, j) => { o[h] = (cells[j] || '').trim(); });
    o.__line = i + 2;
    return o;
  });
}

const entities = parseTSV(path.join(DATA, 'entities.tsv'));
const plants = parseTSV(path.join(DATA, 'plants.tsv'));

const items = [];
const ids = new Set();
const errors = [];
const warnings = [];

function add(item) {
  if (!item.id) errors.push(`Пустой id: ${JSON.stringify(item).slice(0, 120)}`);
  if (ids.has(item.id)) errors.push(`Дублирующийся id: ${item.id}`);
  ids.add(item.id);
  items.push(item);
}

for (const e of entities) {
  add({
    id: e.id, parent: e.parent || '', kind: e.kind || 'company', name: e.name, full: e.full || '',
    type: e.type || '', activity: e.activity || '', region: e.region || '', address: e.address || '',
    phone: e.phone || '', email: e.email || '', site: e.site || '', procUrl: e.procUrl || '',
    inn: e.inn || '', kpp: e.kpp || '', ogrn: e.ogrn || '', ceo: e.ceo || '', contact: e.contact || '',
    method: e.method || '', etp: e.etp ? e.etp.split(';').map(s => s.trim()).filter(Boolean) : [],
    capacity: e.capacity || '', status: e.status || 'действует',
    conf: e.conf || 'medium', sources: e.sources ? e.sources.split(';').map(s => s.trim()).filter(Boolean) : ['S2'],
    notes: e.notes || '', __line: e.__line
  });
}

for (const p of plants) {
  add({
    id: p.id, parent: p.parent || '', kind: 'plant', name: p.name, full: '', type: p.type || '',
    activity: p.activity || 'Производство электроэнергии и тепла', region: p.region || '',
    address: p.address || '', phone: p.phone || '', email: p.email || '', site: p.site || '',
    procUrl: '', inn: '', kpp: '', ogrn: '', ceo: '', contact: '', method: '', etp: [],
    capacity: p.capacity || '', status: p.status || 'действует',
    conf: p.conf || 'medium', sources: p.sources ? p.sources.split(';').map(s => s.trim()).filter(Boolean) : ['S2'],
    notes: p.notes || '', __line: p.__line
  });
}

const byId = new Map(items.map(i => [i.id, i]));
for (const it of items) {
  if (it.parent && !byId.has(it.parent)) errors.push(`Неизвестный parent ${it.parent} у ${it.id}`);
}

const INHERIT = ['address', 'phone', 'email', 'site', 'procUrl', 'inn', 'kpp', 'ogrn', 'ceo', 'contact', 'method'];
function resolve(it) {
  const chain = [];
  let cur = it;
  let guard = 0;
  while (cur && guard++ < 20) { chain.unshift(cur); cur = cur.parent ? byId.get(cur.parent) : null; }
  it.path = chain.map(x => x.name).join(' → ');
  it.holdingId = chain[0] ? chain[0].id : it.id;
  it.holdingName = chain[0] ? chain[0].name : it.name;
  it.depth = chain.length - 1;
  it.inherited = {};
  for (const f of INHERIT) {
    if (it[f]) continue;
    for (let i = chain.length - 2; i >= 0; i--) {
      if (chain[i][f]) { it[f] = chain[i][f]; it.inherited[f] = chain[i].id; break; }
    }
  }
  if (!it.etp.length) {
    for (let i = chain.length - 2; i >= 0; i--) {
      if (chain[i].etp && chain[i].etp.length) { it.etp = chain[i].etp.slice(); it.inherited.etp = chain[i].id; break; }
    }
  }
  if (!it.sources || !it.sources.length) it.sources = ['S2'];
  delete it.__line;
}
items.forEach(resolve);

// Геопривязка: город → координаты, точные координаты для крупных станций
const GEO = require('./data/geo.js');
(function assignGeo() {
  const order = items.slice().sort((a, b) => a.depth - b.depth);
  const used = new Map();
  for (const it of order) {
    let lat = null, lon = null, city = '';
    const ex = GEO.EXACT[it.id];
    if (ex) { lat = ex[0]; lon = ex[1]; city = GEO.STATION_CITY[it.name] || ''; }
    if (lat == null && it.kind === 'plant') {
      const c = GEO.STATION_CITY[it.name];
      if (c && GEO.CITY[c]) { city = c; lat = GEO.CITY[c][0]; lon = GEO.CITY[c][1]; }
    }
    if (lat == null) {
      const par = it.parent ? byId.get(it.parent) : null;
      if (it.kind === 'plant' && par && par.lat != null) { lat = par.lat; lon = par.lon; city = par.city; }
    }
    if (lat == null) {
      city = city || GEO.STATION_CITY[it.name] || GEO.REGION_CITY[it.region] || '';
      const c = GEO.CITY[city] || GEO.CITY[GEO.REGION_CITY[it.region]];
      if (c) { lat = c[0]; lon = c[1]; }
    }
    if (lat != null) {
      const key = city || it.region || '';
      const n = used.get(key) || 0; used.set(key, n + 1);
      if (n > 0 && !ex) {
        const a = n * 2.399963;
        lat += Math.sin(a) * 0.03;
        lon += Math.cos(a) * 0.045;
      }
      it.lat = +lat.toFixed(4);
      it.lon = +lon.toFixed(4);
      it.city = city;
    } else {
      it.lat = null; it.lon = null; it.city = city || '';
    }
  }
})();

// Валидация обязательных полей для юрлиц
for (const it of items) {
  if (it.kind === 'plant') continue;
  for (const f of ['name', 'activity', 'phone', 'email', 'site', 'method', 'etp']) {
    if (!it[f] || (Array.isArray(it[f]) && !it[f].length)) errors.push(`У ${it.id} не заполнено поле ${f}`);
  }
  if (it.kind === 'holding' && !it.inn) errors.push(`У ${it.id} нет ИНН`);
  if (it.kind === 'company' && !it.inn) warnings.push(`У ${it.id} не подтверждён ИНН`);
}

const etpCodes = new Set(ETPS.map(e => e.code));
for (const it of items) for (const c of it.etp) if (!etpCodes.has(c)) errors.push(`Неизвестный код ЭТП ${c} у ${it.id}`);
for (const it of items) if (it.lat == null) warnings.push(`Нет координат у ${it.id} (${it.name})`);

const stats = {
  total: items.length,
  holdings: items.filter(i => i.kind === 'holding').length,
  companies: items.filter(i => i.kind === 'company').length,
  plants: items.filter(i => i.kind === 'plant').length,
  repair: items.filter(i => i.type === 'ремонт').length,
  oem: items.filter(i => ['ОЕМ', 'инжиниринг'].includes(i.type)).length,
  high: items.filter(i => i.conf === 'high').length,
  medium: items.filter(i => i.conf === 'medium').length,
  low: items.filter(i => i.conf === 'low').length,
  regions: [...new Set(items.map(i => i.region).filter(Boolean))].length,
  geo: items.filter(i => i.lat != null).length
};

const out = { meta: META, stats, etps: ETPS, sources: SOURCES, items };
fs.mkdirSync(path.join(ROOT, 'js'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'js', 'data.js'),
  '/* AUTO-GENERATED by build.js. Не редактировать вручную. */\nwindow.REGISTRY = ' + JSON.stringify(out, null, 1) + ';\n', 'utf8');

// CSV для Excel (;, BOM)
const cols = ['id', 'kind', 'holdingName', 'path', 'name', 'full', 'type', 'activity', 'region', 'city', 'address', 'phone', 'email', 'site', 'procUrl', 'inn', 'kpp', 'ogrn', 'ceo', 'contact', 'method', 'etp', 'capacity', 'lat', 'lon', 'status', 'conf', 'sources', 'notes'];
const esc = v => {
  const s = Array.isArray(v) ? v.join('; ') : String(v == null ? '' : v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = '\uFEFF' + [cols.join(';'), ...items.map(i => cols.map(c => esc(i[c])).join(';'))].join('\r\n');
fs.writeFileSync(path.join(ROOT, 'registry.csv'), csv, 'utf8');

// JSON для внешних интеграций
fs.writeFileSync(path.join(ROOT, 'registry.json'), JSON.stringify(out, null, 2), 'utf8');

// Манифест версии для автообновления страницы (один маленький запрос раз в 15 минут)
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({
  version: META.version,
  date: META.date,
  title: 'Энергореестр РФ — обновление данных',
  message: 'Данные реестра обновлены. Страница перезагрузится автоматически.'
}, null, 2) + '\n', 'utf8');

if (warnings.length) {
  console.warn('ПРЕДУПРЕЖДЕНИЯ (' + warnings.length + '):');
  warnings.forEach(w => console.warn(' - ' + w));
}
if (errors.length) {
  console.error('ОШИБКИ (' + errors.length + '):');
  errors.forEach(e => console.error(' - ' + e));
  process.exitCode = 1;
} else {
  console.log(`OK: ${stats.total} записей (${stats.holdings} холдингов, ${stats.companies} юрлиц, ${stats.plants} станций/филиалов); высокий: ${stats.high}, средний: ${stats.medium}, низкий: ${stats.low}`);
}
