#!/usr/bin/env node
/* Управление общим списком ключевых слов для вкладки «Закупки».
 * Список хранится в data/tender-keywords.json (на сервере), НЕ в браузере.
 *
 *   node scripts/keywords.js list
 *   node scripts/keywords.js add "уплотнения"
 *   node scripts/keywords.js remove "лопатки"
 */
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'tender-keywords.json');
const [action, ...rest] = process.argv.slice(2);
const word = rest.join(' ').trim();

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

if (action === 'list' || !action) {
  data.keywords.forEach((k, i) => console.log(`${i + 1}. ${k}`));
  process.exit(0);
}

if (!word) {
  console.error('Укажите слово: node scripts/keywords.js add|remove "слово"');
  process.exit(1);
}

const before = data.keywords.length;
if (action === 'add') {
  if (!data.keywords.some(k => norm(k) === norm(word))) data.keywords.push(word);
} else if (action === 'remove') {
  data.keywords = data.keywords.filter(k => norm(k) !== norm(word));
} else {
  console.error('Неизвестное действие: ' + action);
  process.exit(1);
}

data.keywords.sort((a, b) => a.localeCompare(b, 'ru'));
data.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Слов: ${before} → ${data.keywords.length}. Файл: data/tender-keywords.json`);
