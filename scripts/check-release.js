#!/usr/bin/env node
/* Локальные проверки перед публикацией: только файлы и детерминированные данные, без сети. */
'use strict';
const fs = require('fs');
const path = require('path');
const { digitsOnly, isEisReg } = require('./lib/normalize');

const ROOT = path.join(__dirname, '..');
const errors = [];
let checks = 0;
const fail = (msg) => { errors.push(msg); };

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch (e) { fail('JSON ' + rel + ': ' + e.message); return null; }
}

// 1. Все JSON в data/ и корневой манифест должны читаться.
const dataDir = path.join(ROOT, 'data');
for (const name of fs.readdirSync(dataDir)) {
  if (name.toLowerCase().endsWith('.json')) { checks++; readJson(path.join('data', name)); }
}
checks++; const version = readJson('version.json');
if (version && !/^\d+\.\d+\./.test(String(version.version || ''))) fail('version.json: некорректный version');

// 2. Обязательные поля основных наборов.
const tenders = readJson('data/tenders.json') || { records: [] };
if (!Array.isArray(tenders.records)) fail('tenders.json: нет records');
else {
  for (const r of tenders.records) {
    if (!r.id || !r.title || !r.url) fail('tenders.json: запись без id/title/url: ' + (r.id || '?'));
  }
}
const audit = readJson('data/etp-audit.json') || { platforms: [] };
for (const p of (audit.platforms || [])) if (!p.code || !p.name || !p.url) fail('etp-audit.json: площадка без code/name/url');
checks++;

// 3. Канонические ID закупок не должны повторяться.
if (Array.isArray(tenders.records)) {
  const seen = new Map();
  for (const r of tenders.records) {
    const reg = digitsOnly(r.regNumber || (isEisReg(r.id, r) ? r.id : ''));
    const key = reg.length >= 10 ? 'reg:' + reg : 'id:' + String(r.id || '');
    if (seen.has(key)) fail('дубль закупки ' + key + ': ' + seen.get(key) + ' и ' + (r.title || '').slice(0, 50));
    else seen.set(key, (r.title || '').slice(0, 50));
  }
  checks++;
}

// 4. Smoke: локальные ресурсы из HTML-страниц должны существовать.
const pages = ['index.html', 'log.html', 'archive.html', 'print.html'];
for (const page of pages) {
  const full = path.join(ROOT, page);
  if (!fs.existsSync(full)) { fail('нет страницы ' + page); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|#)/i.test(ref)) continue;
    const file = ref.split(/[?#]/)[0];
    if (!file || file.startsWith('data/archive/')) continue; // архив снимков восстанавливается в CI
    checks++;
    if (!fs.existsSync(path.join(ROOT, file))) fail(page + ': нет файла ' + file);
  }
}
for (const file of ['js/data.js', 'js/tenders-data.js', 'data/entities.tsv', 'data/tenders.json', 'data/etp-audit.json', 'version.json']) {
  checks++;
  if (!fs.existsSync(path.join(ROOT, file))) fail('нет критичного файла ' + file);
}

if (errors.length) {
  console.error('ПРОВЕРКИ НЕ ПРОЙДЕНЫ (' + errors.length + '):');
  errors.slice(0, 40).forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log('Проверки релиза: OK (' + checks + ' проверок, ' + tenders.records.length + ' закупок без дублей)');
