#!/usr/bin/env node
/* Управление общим списком ключевых слов для вкладки «Закупки».
 * Список хранится в data/tender-keywords.json (на сервере), НЕ в браузере.
 *
 *   node scripts/keywords.js list
 *   node scripts/keywords.js add "уплотнения"
 *   node scripts/keywords.js remove "лопатки"
 *   node scripts/keywords.js add "Ремонт проточной части турбины" --search=турбина --must=ремонт,проточн,част,турбин
 *
 * Составной запрос: --search задаёт опорное слово для API, --must — обязательные
 * группы через запятую (внутри группы синонимы пишутся через /).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'tender-keywords.json');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};
const [action, ...rest] = argv.filter((a) => !a.startsWith('--'));
const word = rest.join(' ').trim();

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const labelOf = (k) => (k && typeof k === 'object' ? k.label || k.search : k);

if (action === 'list' || !action) {
  const groups = [
    ['base', 'Базовые слова'],
    ['composite', 'Составные запросы']
  ];
  let i = 0;
  groups.forEach(([kind, title]) => {
    const list = data.keywords.filter((k) => ((k && k.kind === 'composite') ? 'composite' : 'base') === kind);
    if (!list.length) return;
    console.log(title + ':');
    list.forEach((k) => {
      const e = typeof k === 'object' ? k : { label: k, search: k };
      i++;
      console.log(`  ${i}. ${e.label} [поиск: ${e.search}${e.must ? ', группы: ' + e.must.map((g) => g.join('/')).join(' + ') : ''}]`);
    });
  });
  process.exit(0);
}

if (!word) {
  console.error('Укажите слово: node scripts/keywords.js add|remove "слово"');
  process.exit(1);
}

function makeEntry(w) {
  const search = (opt('search', '') || w).trim();
  const must = (opt('must', '') || '').trim();
  const groups = must
    ? must.split(',').map((g) => g.split('/').map((s) => s.trim()).filter(Boolean)).filter((g) => g.length)
    : [[search]];
  // kind: явный --kind имеет приоритет, иначе фраза из 2+ групп считается составной.
  const explicit = opt('kind', '').trim();
  const kind = explicit === 'composite' || explicit === 'base'
    ? explicit
    : (groups.length > 1 ? 'composite' : 'base');
  return { label: w, search, must: groups, kind };
}

const before = data.keywords.length;
if (action === 'add') {
  if (!data.keywords.some((k) => norm(labelOf(k)) === norm(word))) data.keywords.push(makeEntry(word));
} else if (action === 'remove') {
  data.keywords = data.keywords.filter((k) => norm(labelOf(k)) !== norm(word));
} else {
  console.error('Неизвестное действие: ' + action);
  process.exit(1);
}

data.keywords.sort((a, b) => {
  const ka = (a && a.kind === 'composite') ? 1 : 0;
  const kb = (b && b.kind === 'composite') ? 1 : 0;
  return ka - kb || labelOf(a).localeCompare(labelOf(b), 'ru');
});
data.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Слов: ${before} → ${data.keywords.length}. Файл: data/tender-keywords.json`);
