#!/usr/bin/env node
/* Маскировка личных мобильных телефонов: последние 4 цифры заменяются на **-**.
 * Покрывает data/research-2026/** и data/entities.tsv. ИДEMPOTENT: повторный
 * запуск ничего не меняет. Режим --check используется тестами и CI. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// +7 (906) 572-83-19 / +7 916 992-39-88 / 8 (919) 491-40-35
// Не трогаем городские (+7 495/812/351…), toll-free 8 800 и ИНН вида 8905000428
// (после «8» обязателен пробел или скобка).
const MOBILE = /(?<!\d)(?<prefix>(?:\+7[\s(]*|8[\s(]+)9\d{2}[)\s-]*\d{3}[\s-]*)(?<a>\d{2})(?<sep>[\s-]?)(?<b>\d{2})(?!\d)/g;

function targets() {
  const out = [path.join(ROOT, 'data', 'entities.tsv')];
  const dir = path.join(ROOT, 'data', 'research-2026');
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (/\.(json|md|tsv|txt)$/i.test(name)) out.push(path.join(dir, name));
  }
  return out;
}

function mask(text) {
  return text.replace(MOBILE, '$<prefix>**-**');
}

function hasUnmasked(text) {
  MOBILE.lastIndex = 0;
  return MOBILE.test(text);
}

let changed = 0;
let found = 0;
const checkOnly = process.argv.includes('--check');
for (const file of targets()) {
  const before = fs.readFileSync(file, 'utf8');
  const hits = (before.match(MOBILE) || []).length;
  if (hits) found += hits;
  if (!hits) continue;
  if (checkOnly) {
    console.log('НЕ ЗАМАСКИРОВАНО: ' + path.relative(ROOT, file) + ' (' + hits + ')');
    process.exitCode = 1;
    continue;
  }
  const after = mask(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
    console.log('Замаскировано ' + hits + ': ' + path.relative(ROOT, file));
  }
}
if (!checkOnly) console.log('Обработано файлов: ' + changed + ', номеров: ' + found);
if (checkOnly && !process.exitCode) console.log('Проверка маскировки телефонов: OK');
