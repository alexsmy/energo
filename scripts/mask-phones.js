#!/usr/bin/env node
/* Маскировка мобильных телефонов в данных проекта: последние 4 цифры → **-**.
 *   node scripts/mask-phones.js          замаскировать всё в data/
 *   node scripts/mask-phones.js --check  только проверить (выход 1, если есть полные номера)
 * Вызывается вручную и автоматически из build.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const { MOBILE_RE, maskDataTree, checkTargets } = require('./lib/mask-phones');

const ROOT = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  let found = 0;
  for (const file of checkTargets(ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    const hits = text.match(MOBILE_RE) || [];
    MOBILE_RE.lastIndex = 0;
    if (hits.length) {
      found += hits.length;
      console.log('НЕ ЗАМАСКИРОВАНО: ' + path.relative(ROOT, file) + ' (' + hits.length + ')');
    }
  }
  if (found) {
    console.error('Найдено полных мобильных номеров: ' + found + ' — запустите node scripts/mask-phones.js');
    process.exit(1);
  }
  console.log('Проверка маскировки телефонов: OK');
} else {
  const changed = maskDataTree(path.join(ROOT, 'data'));
  console.log('Маскировка телефонов: обработано файлов ' + changed);
}
