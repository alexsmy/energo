#!/usr/bin/env node
/* Разовый поиск по одному ключевому слову через реальные парсеры,
 * без записи в data/tenders.json и без изменения состояния сбора.
 *
 *   node scripts/probe-keyword.js "модернизация"
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tm = require('../js/text-match');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const word = process.argv[2] || 'модернизация';
const read = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return fallback; }
};

const settings = read('tender-settings.json', {});
const keywordsAll = read('tender-keywords.json', { keywords: [] }).keywords || [];
const entry = keywordsAll.find((k) => tm.norm(k.label || k.search) === tm.norm(word));
if (!entry) { console.error('Слово не найдено в data/tender-keywords.json: ' + word); process.exit(1); }
const term = tm.entryOf(entry).search;
const enterprises = read('tender-enterprises.json', { items: [] }).items || [];
const audit = read('etp-audit.json', {});
const innState = read('tender-inn-state.json', {});

const usage = {};
Object.keys(settings.requestBudget || {}).forEach((n) => { usage[n] = { limit: Number(settings.requestBudget[n]) || 0, used: 0 }; });
const take = (name) => {
  const u = usage[name];
  if (!u) return true;
  if (u.used >= u.limit) return false;
  u.used += 1;
  return true;
};
const logger = { entry() {}, info() {}, warn() {}, error() {} };

async function run() {
  console.log(`Поиск: "${word}" (в API уходит: "${term}")`);
  for (const name of ['gosplan', 'gentender']) {
    const adapter = require('./sources/' + name);
    const logItems = [];
    const localLogger = {
      entry(source, label, data) { logItems.push({ source, label, ok: data && data.ok, error: data && data.error, found: data && data.found, taken: data && data.taken }); },
      info() {}, warn() {}, error() {}
    };
    const t0 = Date.now();
    let result;
    try {
      result = await adapter.collect({
        keywords: [term], enterprises, settings, audit, logger: localLogger,
        take, maxRecords: 300, deepArchive: false, allInns: false, innState
      });
    } catch (e) {
      console.log(`  ${name}: ОШИБКА ${String(e && e.message || e)}`);
      continue;
    }
    const records = result.records || [];
    const matched = records.filter((r) => tm.matchEntries(r.title || '', [entry]).length > 0);
    console.log(`  ${name}: сырых=${records.length}, по названию "${word}"=${matched.length}, `
      + `запросов=${result.requests || 0}, ошибок=${result.errors ? result.errors.length : 0}, `
      + `время=${Math.round((Date.now() - t0) / 1000)}с`);
    matched.slice(0, 8).forEach((r) => console.log(`    • ${String(r.title || '').slice(0, 110)}`));
    if (logItems.length) {
      const bad = logItems.filter((x) => x.ok === false).slice(0, 5);
      if (bad.length) console.log('    неуспешные запросы: ' + JSON.stringify(bad));
    }
  }
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
