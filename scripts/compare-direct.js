#!/usr/bin/env node
/* Сверка выдачи до и после прогона прямых адаптеров (офлайн).
 * По умолчанию база — data/tenders.json из HEAD; можно передать путь файла. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { identityKeys } = require('./lib/normalize');

const ROOT = path.join(__dirname, '..');
const arg = process.argv[2];
let before;
if (arg) before = JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
else before = JSON.parse(execFileSync('git', ['show', 'HEAD:data/tenders.json'], { cwd: ROOT, encoding: 'utf8' }));
const after = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tenders.json'), 'utf8'));
const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tenders-status.json'), 'utf8'));
const oldRecords = before.records || [];
const records = after.records || [];
const oldIds = new Set(oldRecords.map(r => r.id));
const added = records.filter(r => !oldIds.has(r.id));
const removed = oldRecords.filter(r => !oldIds.has(r.id) && !records.some(x => x.id === r.id));

const countBy = (list, key) => {
  const out = {};
  list.forEach(r => {
    const values = key === 'keyword' ? (r.matchedKeywords || []) : [r[key] || '—'];
    values.forEach(v => { out[v] = (out[v] || 0) + 1; });
  });
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
};

console.log('СВЕРКА ВЫДАЧИ (прямые адаптеры)');
console.log('Было: ' + oldRecords.length + ' | Стало: ' + records.length +
  ' | Добавлено: ' + added.length + ' | Потеряно: ' + removed.length);
console.log('Активных: ' + records.filter(r => r.phase === 'active').length +
  ' | архивных: ' + records.filter(r => r.phase === 'archive').length +
  ' | с пометкой «новое»: ' + records.filter(r => r.isNew).length);
console.log('Совпало с реестром: ' + records.filter(r => r.matchedOrgId).length +
  ' | без ключевого слова: ' + records.filter(r => !(r.matchedKeywords || []).length).length);

// Проверка уникальности по тем же ключам, что использует дедупликатор.
const seen = new Map();
let duplicates = 0;
records.forEach(r => {
  for (const k of identityKeys(r)) {
    if (seen.has(k) && seen.get(k) !== r.id) { duplicates++; break; }
    seen.set(k, r.id);
  }
});
console.log('Дубликатов по каноническим ключам: ' + duplicates);

console.log('\nДобавлено по источникам:');
countBy(added, 'source').forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));
console.log('\nДобавлено по ключевым словам:');
countBy(added, 'keyword').forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));
console.log('\nИсточники последнего прогона:');
(status.sources || []).forEach(s => console.log('  ' + (s.name || '?') + ': запросов ' + (s.requests || 0) +
  ', записей ' + (s.records || 0) + ', ошибок ' + (s.errors || 0)));

if (removed.length || duplicates) process.exitCode = 1;
