#!/usr/bin/env node
/* Проверка предприятий по ИНН через публичный API тендерного агрегатора.
 * Запрашиваем строго по ИНН (customer_key), сверяем название заказчика и ищем
 * контактные поля в ответе API. Ничего не подставляем: результат — отчёт.
 *   node scripts/verify-contacts.js [--limit=80] [--only=7700000000,7700000001]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseTSV } = require('./validate-entities');
const { ThrottledClient } = require('./lib/throttle');
const { norm } = require('../js/text-match');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'inn-verification.json');
const args = process.argv.slice(2);
const arg = (name) => args.find(a => a.startsWith('--' + name + '='));
const LIMIT = arg('limit') ? Math.max(1, parseInt(arg('limit').slice(8), 10) || 80) : 80;
const ONLY = arg('only') ? arg('only').slice(7).split(',').filter(Boolean) : null;

const rows = parseTSV(path.join(ROOT, 'data', 'entities.tsv'));
const byInn = new Map();
for (const r of rows) {
  const inn = String(r.inn || '').trim();
  if (!/^\d{10}$/.test(inn)) continue;
  if (!byInn.has(inn)) byInn.set(inn, []);
  byInn.get(inn).push(r);
}
let inns = [...byInn.keys()];
if (ONLY) inns = inns.filter(i => ONLY.includes(i));
inns = inns.slice(0, LIMIT);

const STOP = new Set(['ооо', 'ао', 'пао', 'оао', 'фирма', 'научно', 'производственное', 'объединение', 'завод', 'концерн']);
function tokens(s) {
  return norm(s).replace(/[^a-zа-я0-9 ]/gi, ' ').split(' ')
    .filter(w => w.length >= 3 && !STOP.has(w));
}
function similar(a, b) {
  const sa = new Set(tokens(a)), sb = new Set(tokens(b));
  if (!sa.size || !sb.size) return false;
  if ([...sa].some(w => [...sb].some(x => x === w || x.startsWith(w) || w.startsWith(x)))) return true;
  return [...sa].filter(w => sb.has(w)).length >= 2;
}
function contactFields(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') { contactFields(v, key, out); continue; }
    if (v && /phone|tel|email|e_mail|contact|fio|person/i.test(k)) out.push({ field: key, value: String(v) });
  }
}

const report = {
  generated: new Date().toISOString(),
  source: 'GenTender /api/tenders/search (customer_key = ИНН)',
  checked: 0, confirmed: [], nameUnclear: [], mismatch: [], noData: [], errors: [], contactsFound: []
};

async function check(client, inn) {
  const ents = byInn.get(inn);
  const url = 'https://gentender.ru/api/tenders/search?' + new URLSearchParams({ customer_key: inn, limit: '3', offset: '0' });
  const res = await client.getJson(url);
  report.checked++;
  if (!res.ok) return { inn, ids: ents.map(e => e.id), error: res.error };
  const apiRows = (res.body && res.body.rows) || [];
  if (!apiRows.length) return { noData: { inn, ids: ents.map(e => e.id), name: ents[0].name } };
  const apiNames = [...new Set(apiRows.map(r => String(r.customer_name || '')).filter(Boolean))];
  const apiKeys = [...new Set(apiRows.map(r => String(r.customer_key || '')).filter(Boolean))];
  const contacts = [];
  apiRows.forEach(r => contactFields(r, '', contacts));
  if (contacts.length) report.contactsFound.push({ inn, contacts });
  const okInn = apiKeys.includes(inn) || apiKeys.some(k => k.slice(0, 10) === inn);
  const okName = ents.some(e => apiNames.some(n => similar(n, e.name) || similar(n, e.full)));
  const item = { inn, ids: ents.map(e => e.id), name: ents[0].name, apiNames, records: apiRows.length, okInn, okName, url };
  if (!okInn) return { mismatch: item };
  if (!okName) return { nameUnclear: item };
  return { confirmed: item };
}

function apply(result) {
  if (!result) return;
  if (result.error) report.errors.push(result);
  else if (result.noData) report.noData.push(result.noData);
  else if (result.mismatch) report.mismatch.push(result.mismatch);
  else if (result.nameUnclear) report.nameUnclear.push(result.nameUnclear);
  else if (result.confirmed) report.confirmed.push(result.confirmed);
}

(async () => {
  const client = new ThrottledClient({ minInterval: 950, timeout: 20000, retries: 2, backoff: [4000, 8000] });
  for (const inn of inns) apply(await check(client, inn));

  // Повтор ошибок (429/таймаут) с увеличенным интервалом.
  if (report.errors.length) {
    const retry = new ThrottledClient({ minInterval: 5000, timeout: 25000, retries: 3, backoff: [10000, 20000] });
    const failed = report.errors.slice();
    report.errors = [];
    for (const e of failed) apply(await check(retry, e.inn));
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Проверено ИНН: ${report.checked}; подтверждено: ${report.confirmed.length}; ИНН верен, название уточняется: ${report.nameUnclear.length}; несовпадений: ${report.mismatch.length}; без данных: ${report.noData.length}; ошибок: ${report.errors.length}; контакты в API: ${report.contactsFound.length}`);
  console.log('Отчёт: ' + OUT);
})();
