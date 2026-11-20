#!/usr/bin/env node
/* Изолированный прототип: проверка ГосПлан API как источника закупок.
 * НЕ трогает продакшн-скрипты и данные. Результат: prototype/probe-results.json + probe.log
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const BASE = 'https://v2test.gosplan.info';
const MIN_INTERVAL = 6500; // лимит 10 запросов/мин на IP
const UA = 'EnergoRegistry/1.9 (+https://github.com/alexsmy/energo)';

const lines = [];
function log(s) { const line = new Date().toISOString() + ' ' + s; lines.push(line); console.log(line); }
function save() {
  fs.writeFileSync(path.join(OUT, 'probe.log'), lines.join('\n') + '\n', 'utf8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let lastRequest = 0;
async function request(label, endpoint, params) {
  const url = BASE + endpoint + '?' + new URLSearchParams(params).toString();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = MIN_INTERVAL - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429) {
        log(`${label} 429, попытка ${attempt}, ждём 35 с`);
        await sleep(35000);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : (data && data.detail ? -1 : 1);
      log(`${label}: OK, записей ${count}, url ${url}`);
      return { ok: true, data, url };
    } catch (e) {
      log(`${label}: ошибка (${e.message || e}), попытка ${attempt}`);
      if (attempt === 3) return { ok: false, error: String(e.message || e), url };
    }
  }
  return { ok: false, error: 'retries exhausted', url };
}

function day(s) { return s ? String(s).slice(0, 10) : ''; }

function mapRecord(p, orgByInn) {
  const org = orgByInn[p.customer] || orgByInn[p.placer] || null;
  return {
    id: p.purchase_number,
    title: p.object_info || '',
    customer: p.customer || '',
    customerInn: p.customer || '',
    matchedOrgId: org ? org.id : '',
    matchedOrgName: org ? org.name : '',
    etp: 'EIS',
    source: 'ЕИС (ГосПлан API)',
    price: p.max_price != null ? String(p.max_price) + ' ₽' : '',
    published: day(p.published_at),
    deadline: day(p.submission_close_at),
    updated: day(p.updated_at),
    stage: p.stage,
    url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + encodeURIComponent(p.purchase_number),
    keywords: [],
    phase: p.stage === 1 ? 'active' : 'archive'
  };
}

async function main() {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8'));
  const kws = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tender-keywords.json'), 'utf8')).keywords;
  const orgByInn = {};
  reg.items.forEach(i => { if (i.inn) orgByInn[i.inn] = { id: i.id, name: i.name }; });
  log(`Реестр: ${reg.items.length} записей, ИНН ${Object.keys(orgByInn).length}, слов ${kws.length}`);

  const results = {};
  results.root = await request('root', '', {});
  results.byCustomer = await request('по ИНН C-BGK', '/fz223/purchases', { customer: '0277077282', limit: 3 });
  results.active = await request('ключ + действующие', '/fz223/purchases', { object_info: 'турбины', stage: 1, limit: 5 });
  results.archive = await request('ключ + завершённые за 30 дней', '/fz223/purchases', { object_info: 'лопаток', stage: 3, published_forpast: '30d', limit: 5 });
  results.fz44 = await request('44-ФЗ уплотнения', '/fz44/purchases', { object_info: 'уплотнения', stage: 1, limit: 5 });

  const mapped = [];
  Object.entries(results).forEach(([k, r]) => {
    if (!r.ok || !Array.isArray(r.data)) return;
    r.data.forEach(p => { if (p && p.purchase_number) mapped.push(mapRecord(p, orgByInn)); });
  });
  const uniq = [...new Map(mapped.map(r => [r.id, r])).values()];
  fs.writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify({
    testedAt: new Date().toISOString(),
    requests: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { ok: r.ok, count: Array.isArray(r.data) ? r.data.length : 0, error: r.error || '', url: r.url }])),
    mapped: uniq
  }, null, 2), 'utf8');
  log(`ИТОГО: уникальных записей ${uniq.length}, совпало с реестром ${uniq.filter(r => r.matchedOrgId).length}`);
  save();
}

main().catch(e => { log('КРИТИЧЕСКАЯ ОШИБКА ' + (e.stack || e)); save(); process.exitCode = 1; });
