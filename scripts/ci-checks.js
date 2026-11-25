#!/usr/bin/env node
/* Локальные проверки перед сборкой. Вызываются build.js, поэтому работают и в CI,
 * и у разработчика — без изменений .github/workflows и без обращений к сети. */
'use strict';
const path = require('path');

console.log('--- проверки перед сборкой (без сети) ---');
require('../prototype/test-regressions.js');
require('./test-collect.js');
require('./test-direct.js');
require('./test-theme.js');
require('./test-ui-layout.js');

const { validateFile } = require('./validate-entities');
const report = validateFile(path.join(__dirname, '..', 'data', 'entities.tsv'));
if (report.issues && report.issues.length) {
  console.error('Проверка entities.tsv: замечаний ' + report.issues.length);
  process.exitCode = 1;
}

require('./check-release.js');
if (process.exitCode) {
  console.error('Проверки не пройдены — сборка остановлена');
  process.exit(process.exitCode);
}
console.log('--- все проверки пройдены ---');
