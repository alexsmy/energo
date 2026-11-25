#!/usr/bin/env node
/* Сводка research-батчей по нефтяной теме для согласования каталога.
 * Ничего не меняет в каталоге: только читает JSON субагентов и печает MD-отчёт
 * с проверками на дубли ИНН и обязательные поля. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'research-2026');
const BATCHES = [
  ['new-oil-dobycha.json', 'Нефтедобыча и холдинги', 'OIL_DO_BYCHA.md'],
  ['new-oil-transport.json', 'Нефтетранспорт и терминалы', 'OIL_TRANSPORT.md'],
  ['new-oil-equipment.json', 'Оборудование НПС, ремонт, НИИ', 'OIL_EQUIPMENT.md']
];

const existing = fs.readFileSync(path.join(ROOT, 'data', 'entities.tsv'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => l.split('|'));
const existingInn = new Map();
const existingNames = new Map();
const existingById = new Map();
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"()]/g, '').replace(/\s+/g, ' ').trim();
existing.forEach(r => {
  if (!r[0] || r[0] === 'id') return;
  const inn = String(r[13] || '').trim();
  if (inn) existingInn.set(inn, r[0] + ' — ' + r[3]);
  const name = norm(r[3]);
  if (name) existingNames.set(name, r[0]);
  existingById.set(r[0], r[3]);
});

const out = [];
out.push('# Нефтяная промышленность — кандидаты в каталог');
out.push('');
out.push('Сводка подготовлена из отчётов субагентов. Каталог НЕ изменён — требуется согласование.');
out.push('');
out.push('Производственные связи и поправки: `data/research-2026/OIL_LINKS.md`.');
out.push('Личная выверка в Google AI Mode: `data/research-2026/oil-verification.json`.');
out.push('');
const allInn = new Map();
const allNames = new Map();
const allIds = new Map();
const allOrgs = [];
const problems = [];

for (const [file, title, md] of BATCHES) {
  const full = path.join(DIR, file);
  out.push('## ' + title);
  if (!fs.existsSync(full)) {
    out.push('');
    out.push('> Отчёт ещё не создан: `data/research-2026/' + file + '`.');
    out.push('');
    continue;
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { out.push('> Ошибка чтения JSON: ' + e.message); out.push(''); continue; }
  const orgs = Array.isArray(data.organizations) ? data.organizations : [];
  out.push('');
  out.push('Источник: `data/research-2026/' + file + '` (детально — `' + md + '`).');
  if (data.method) out.push('');
  if (data.method) out.push('Метод: ' + data.method);
  if (data.dedup && data.dedup.collisions && data.dedup.collisions.length) {
    out.push(' Коллизии при дедупе: ' + JSON.stringify(data.dedup.collisions) + '.');
  }
  out.push('');
  out.push('| ID | Название | ИНН | Форма/тип | Родитель | Профиль | Статус | Уверенность | Источники |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const o of orgs) {
    const inn = String(o.inn || '').trim();
    const flags = [];
    if (!inn) flags.push('нет ИНН');
    else {
      if (existingInn.has(inn)) flags.push('дубль каталога: ' + existingInn.get(inn));
      if (allInn.has(inn)) flags.push('дубль между батчами: ' + allInn.get(inn));
      else allInn.set(inn, o.id || o.name || '?');
    }
    const nm = norm(o.name || o.full);
    if (nm) {
      if (existingNames.has(nm)) flags.push('дубль названия в каталоге: ' + existingNames.get(nm));
      if (allNames.has(nm)) flags.push('дубль названия между батчами: ' + allNames.get(nm));
      else allNames.set(nm, (o.id || '?') + ' (' + file + ')');
    }
    const oid = String(o.id || '').trim();
    if (oid) {
      if (existingById.has(oid)) flags.push('дубль ID в каталоге: ' + existingById.get(oid));
      if (allIds.has(oid)) flags.push('дубль ID между батчами: ' + allIds.get(oid));
      else allIds.set(oid, file);
    }
    if (!o.status) flags.push('нет статуса');
    if (!Array.isArray(o.sources) || !o.sources.length) flags.push('нет источников');
    allOrgs.push({ id: oid, name: o.name || o.id || '?', type: o.type, parent: String(o.parent || ''), file });
    if (flags.length) problems.push((o.name || o.id || '?') + ': ' + flags.join('; '));
    const cell = (v) => String(v == null ? '—' : v).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    out.push('| ' + [o.id, o.name, inn || '—', o.type || o.kind, o.parent || '—',
      o.activity || o.projects || '—', o.status || '—', o.confidence || '—',
      Array.isArray(o.sources) ? String(o.sources.length) : '0'].map(cell).join(' | ') + ' |');
  }
  out.push('');
  out.push('Кандидатов: ' + orgs.length + '.');
  out.push('');
}

out.push('## Производственные связи (по полю parent)');
out.push('');
const labelOf = (id) => {
  const cand = allOrgs.find(x => x.id === id);
  if (cand) return cand.name + ' [' + cand.id + ']';
  if (existingById.has(id)) return existingById.get(id) + ' [' + id + ']';
  return id;
};
const edges = allOrgs.filter(o => o.parent).map(o =>
  '- ' + labelOf(o.parent) + ' → ' + o.name + ' [' + o.id + '] (' + (o.type || 'тип не указан') + ')');
if (edges.length) edges.forEach(e => out.push(e));
else out.push('- Явные связи `parent` в батчах не заполнены — связи выверяются отдельно в `OIL_LINKS.md`.');
out.push('');

out.push('## Проверки перед согласованием');
out.push('');
if (problems.length) {
  out.push('Найдено замечаний: ' + problems.length);
  out.push('');
  problems.forEach(p => out.push('- ' + p));
} else {
  out.push('Замечаний нет: у всех кандидатов есть ИНН, статус и источники; дублей по ИНН нет.');
}
out.push('');
out.push('');
out.push('Межбатчевые дубли нужно слить в одну карточку до добавления в каталог');
out.push('(OIL_LINKS.md, раздел 7); поправки по ОПФ/руководителям — раздел 8.');
out.push('');
const summary = path.join(DIR, 'OIL_SUMMARY.md');
fs.writeFileSync(summary, out.join('\n'), 'utf8');
console.log('Сводка: ' + path.relative(ROOT, summary));
if (problems.length) {
  console.error('Замечаний: ' + problems.length);
  problems.slice(0, 20).forEach(p => console.error(' - ' + p));
  process.exitCode = 1;
}
