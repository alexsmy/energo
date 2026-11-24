#!/usr/bin/env node
/* Статистика выдачи по ключевым словам: сколько закупок нашло каждое
 * базовое слово и каждый составной запрос. Работает офлайн, без сети.
 *
 *   node scripts/keyword-stats.js
 *   node scripts/keyword-stats.js --json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tm = require('../js/text-match');

const DATA = path.join(__dirname, '..', 'data');
const read = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch (e) { return fallback; }
};

const records = read('tenders.json', { records: [] }).records || [];
const entries = (read('tender-keywords.json', { keywords: [] }).keywords || []).map(tm.entryOf);
const norm = tm.norm;

const rows = entries.map((e) => {
  const hit = records.filter((r) => (r.matchedKeywords || r.keywords || []).some((x) => norm(x) === norm(e.label)));
  return {
    label: e.label,
    kind: e.kind === 'composite' ? 'composite' : 'base',
    search: e.search,
    total: hit.length,
    active: hit.filter((r) => r.phase === 'active').length,
    archive: hit.filter((r) => r.phase === 'archive').length,
    fresh: hit.filter((r) => r.isNew).length
  };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ updated: new Date().toISOString(), records: records.length, rows }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => String(n).padStart(5);
console.log('ЗАКУПКИ ПО КЛЮЧЕВЫМ СЛОВАМ (записей: ' + records.length + ')');
console.log(pad('Слово', 30) + '  Тип        Всего  Действ.  Архив  Новых');
for (const kind of ['base', 'composite']) {
  for (const r of rows.filter((x) => x.kind === kind)) {
    console.log(pad(r.label, 30) + '  ' + pad(kind, 10) + num(r.total) + num(r.active) + num(r.archive) + num(r.fresh));
  }
}
const without = records.filter((r) => !(r.matchedKeywords || r.keywords || []).length).length;
if (without) console.log('\nБез совпавшего слова: ' + without);
