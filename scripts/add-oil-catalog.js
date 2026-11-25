#!/usr/bin/env node
/* Локальное добавление нефтяного research-батча в entities.tsv.
 * Только рабочая копия; не делает push и не трогает собранные JS/JSON. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'entities.tsv');
const HEADER = 'id|parent|kind|name|full|type|activity|region|address|phone|email|site|procUrl|inn|kpp|ogrn|ceo|contact|method|etp|capacity|status|conf|sources|notes|chiefEngineer|chiefDesigner|procContact|procPhone|procEmail|tech';
const FIELDS = HEADER.split('|');
const BATCHES = ['new-oil-dobycha.json', 'new-oil-transport.json', 'new-oil-equipment.json'];
const ETP = 'GPB TEK ROS RAD B2B FAB AST SBER RTS ZAKAZ KIM PORTAL_ROS ETP_IRAO ETP_RUSH BIDZAAR EIS'.split(' ');

const clean = (v) => String(v == null ? '' : v).replace(/\|/g, ',').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
const confirmed = (v) => clean(v) || 'не подтверждены';
function phone(v) {
  const first = String(v || '').split(/[;,]|факс|тел\.?/i)[0].trim();
  return /^\+?[\d\s()\-]{6,}(,\s*(доб|доп)\.?\s*\d+)?$/i.test(first) ? first : 'не подтверждены';
}
function email(v) {
  const m = String(v || '').match(/[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/);
  return m ? m[0] : 'не подтверждены';
}
function url(v) { return /^https?:\/\/\S+$/i.test(clean(v)) ? clean(v) : 'не подтверждены'; }
function ceo(v) {
  let s = clean(v).split('(')[0].replace(/[,"']/g, '').trim();
  if (/\d/.test(s)) return 'не подтверждены';
  if (!/^[А-Яа-яЁёA-Za-z\-]+(?:\s+[А-Яа-яЁёA-Za-z\-]+){1,3}$/.test(s)) return 'не подтверждены';
  return s;
}
function etp(v) {
  const found = [...new Set((String(v || '').toUpperCase().match(/\b(?:GPB|TEK|ROS|RAD|B2B|FAB|AST|SBER|RTS|ZAKAZ|KIM|PORTAL_ROS|ETP_IRAO|ETP_RUSH|BIDZAAR|EIS)\b/g) || []))];
  return found.length ? found.join(';') : 'не подтверждены';
}
function note(v, extra) {
  let s = clean(v).replace(/Google\s*ИИ|Google\s*AI|ИИ[-, ]?режим|AI[- ]?режим|DDG|DuckDuckGo|агрегатор[а-я]*|по ИИ/gi, '');
  s = s.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
  return clean([s, extra].filter(Boolean).join(' ')).slice(0, 700);
}
function normalizeParent(p) {
  const v = clean(p);
  if (!v) return '';
  const ids = new Set(['H-OIL-RN', 'H-OIL-LK', 'H-OIL-GPN', 'H-OIL-SNG', 'H-OIL-TN', 'H-OIL-TAT', 'H-OIL-BN', 'H-OIL-ZN', 'H-OIL-RUS', 'H-OIL-SLV', 'H-OILTRANS', 'C-OILNMTP', 'O-VNIINEFT', 'O-RNGIR', 'O-RNPD', 'O-VNIINP']);
  if (ids.has(v)) return v;
  if (/Транснефть|трубопровод/i.test(v)) return 'H-OILTRANS';
  if (/ЛУКОЙЛ|Лукойл/i.test(v)) return 'H-OIL-LK';
  if (/Башнефть/i.test(v)) return 'H-OIL-BN';
  if (/Газпром нефть/i.test(v)) return 'H-OIL-GPN';
  if (/Роснефть/i.test(v)) return 'H-OIL-RN';
  if (/Зарубежнефть/i.test(v)) return 'H-OIL-ZN';
  if (/НМТП/i.test(v)) return 'C-OILNMTP';
  return '';
}

const rowsIn = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
if (rowsIn.shift() !== HEADER) throw new Error('Неожиданный заголовок entities.tsv');
const existing = rowsIn.map(l => l.split('|'));
const byId = new Map(existing.map(r => [r[0], r]));
const candidates = [];
const seenInn = new Map();

for (const name of BATCHES) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'research-2026', name), 'utf8'));
  for (const o of (data.organizations || [])) {
    const inn = clean(o.inn);
    if (inn && seenInn.has(inn)) continue; // 4 межбатчевых дубля — берём первую запись
    if (inn) seenInn.set(inn, o.id);
    if (o.id === 'O-OIL-NEFTEHIMMASH') continue; // торговое юрлицо, заменяем на завод
    candidates.push(o);
  }
}

const extras = [
  {
    id: 'O-OIL-ZAVODNH', kind: 'company', name: 'Завод Нефтехиммаш', full: 'Общество с ограниченной ответственностью «Завод «Нефтехиммаш»',
    type: 'ОЕМ', region: 'Самарская область', address: 'Самарская обл., г. Сызрань, Саратовское шоссе, зд. 2',
    inn: '6678065969', ogrn: '1156658091688', ceo: 'Дмитриев Вячеслав Владимирович', parent: '',
    activity: 'Производство неэлектрических печей, горелок и устройств для них (ОКВЭД 28.21.1), около 120 сотрудников, выручка за 2025 год — 492,7 млн руб.',
    method: 'Коммерческие закупки по внутреннему регламенту', note: 'Действующее производство печей и подогревателей для нефтяной отрасли; не путать с ООО «НЕФТЕХИММАШ» (6325069422, торговля оборудованием).'
  },
  {
    id: 'O-OIL-TNTECH', kind: 'company', name: 'Транснефть-Технологии', full: 'Общество с ограниченной ответственностью «Транснефть-Технологии»',
    type: 'холдинг', region: 'Москва', inn: '7728815650', parent: 'H-OILTRANS',
    activity: 'Управляющее общество системы «Транснефть»: 100% долей в ООО «УДМ» (7449139434), которое управляет заводами АО «ТНН» (насосы НПС и капремонт) и АО «РЭД» (двигатели НПС).',
    method: '223-ФЗ; закупки группы «Транснефть»', note: 'Пропущенное звено производственной цепочки Транснефть → Транснефть-Технологии → УДМ → ТНН/РЭД.'
  }
];
candidates.push(...extras);

function toRow(o) {
  let parent = normalizeParent(o.parent);
  if (o.id === 'C-OIL-BNPOL') parent = 'H-OIL-BN';
  let full = clean(o.full || o.name);
  if (o.id === 'H-OIL-SLV') full = 'Публичное акционерное общество «Нефтегазовая компания «Славнефть»';
  let ceoVal = ceo(o.ceo);
  if (o.id === 'R-OIL-AKENG') ceoVal = 'Зарецкий Сергей Петрович';
  const notes = note(o.note, o.id === 'C-OIL-BNPOL' ? 'Совместное предприятие ПАО АНК «Башнефть» и ПАО «ЛУКОЙЛ» (миноритарная доля).' : '');
  const r = {
    id: clean(o.id), parent, kind: o.kind === 'holding' ? 'holding' : 'company',
    name: clean(o.name), full, type: clean(o.type || 'компания'),
    activity: clean(o.activity || o.projects || ''), region: clean(o.region || ''),
    address: confirmed(o.address), phone: phone(o.phone), email: email(o.email),
    site: url(o.site), procUrl: url(o.procUrl),
    inn: /^\d{10}(\d{2})?$/.test(clean(o.inn)) ? clean(o.inn) : '',
    kpp: /^\d{9}$/.test(clean(o.kpp)) ? clean(o.kpp) : '',
    ogrn: /^\d{13}(\d{2})?$/.test(clean(o.ogrn)) ? clean(o.ogrn) : '',
    ceo: ceoVal, contact: 'не подтверждены',
    method: clean(o.method || 'не подтверждены') || 'не подтверждены',
    etp: etp(o.etp), capacity: '', status: 'действует', conf: 'high',
    sources: 'S1;S4;S5', notes,
    chiefEngineer: 'не подтверждены', chiefDesigner: 'не подтверждены',
    procContact: 'не подтверждены', procPhone: 'не подтверждены', procEmail: 'не подтверждены',
    tech: ''
  };
  return FIELDS.map(f => r[f]).join('|');
}

// Связи с уже существующими карточками
const links = {
  'O-VNIINEFT': 'H-OIL-ZN',
  'O-RNGIR': 'H-OIL-RN', 'O-RNPD': 'H-OIL-RN', 'O-VNIINP': 'H-OIL-RN',
  'H-EL5': 'H-OIL-LK'
};
for (const [id, parent] of Object.entries(links)) {
  if (byId.has(id)) byId.get(id)[1] = parent;
}

const newRows = candidates.map(toRow);
const ids = new Set([...existing.map(r => r[0]), ...candidates.map(o => o.id)]);
for (const row of newRows) {
  const parts = row.split('|');
  if (parts[1] && !ids.has(parts[1])) throw new Error('Неизвестный parent: ' + parts[1] + ' у ' + parts[0]);
}

fs.writeFileSync(FILE, [HEADER, ...existing.map(r => r.join('|')), ...newRows].join('\n') + '\n', 'utf8');
console.log('Было: ' + existing.length + ', добавлено: ' + newRows.length + ', стало: ' + (existing.length + newRows.length));
