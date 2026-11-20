#!/usr/bin/env node
/* Оркестратор сбора закупок: ГосПлан API (по умолчанию) → HTML ЕИС (резерв).
 *
 *   node scripts/collect-tenders.js                  полный прогон
 *   node scripts/collect-tenders.js --probe-only     только аудит ЭТП
 *   node scripts/collect-tenders.js --no-probe       без проверки площадок
 *   node scripts/collect-tenders.js --fixture=f.html тест парсера без сети
 *   node scripts/collect-tenders.js --refilter       пересопоставление старых записей с реестром
 *   node scripts/collect-tenders.js --verbose
 *
 * Локально под TLS-прокси Termux: NODE_TLS_REJECT_UNAUTHORIZED=0 ...
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ThrottledClient, sleep } = require('./lib/throttle');
const { buildCustomerIndex, matchCustomer, norm } = require('./lib/match-org');
const { dedup, isActive } = require('./lib/normalize');
const { CollectLogger } = require('./lib/logger');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UA = 'EnergoRegistry/1.9 (+https://github.com/alexsmy/energo)';
const MAX_RECORDS = 2000;

const argv = process.argv.slice(2);
const arg = (name, def) => { const h = argv.find(a => a.startsWith('--' + name + '=')); return h ? h.slice(name.length + 3) : def; };
const has = (n) => argv.includes('--' + n);
const opts = {
  fixture: arg('fixture', ''), limit: Math.max(10, parseInt(arg('limit', String(MAX_RECORDS)), 10) || MAX_RECORDS),
  noProbe: has('no-probe'), probeOnly: has('probe-only'), refilter: has('refilter'), verbose: has('verbose')
};
const log = (...a) => { if (opts.verbose || !opts.fixture) console.log(...a); };

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return fallback; }
}
function writeJson(name, obj) { fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function tagRecords(records, keywords, enterprises) {
  const kwSet = new Set(keywords.map(norm));
  records.forEach(r => {
    const text = norm(r.title + ' ' + r.customer);
    const query = (r.keywords || [])[0] || '';
    const terms = new Set([...(r.keywords || []), ...(kwSet.has(norm(query)) ? [query] : [])]);
    keywords.forEach(k => { if (text.includes(norm(k))) terms.add(k); });
    r.keywords = [...terms].filter(Boolean);
    const ids = new Set(r.enterpriseIds || []);
    if (r.matchedOrgId) ids.add(r.matchedOrgId);
    enterprises.forEach(e => {
      if ([e.query, ...(e.aliases || [])].some(n => text.includes(norm(n)))) ids.add(e.id);
    });
    r.enterpriseIds = [...ids];
  });
  return records;
}

async function probeEtps(audit, logger) {
  const client = new ThrottledClient({ minInterval: 0, timeout: 12000, retries: 1, backoff: [1000] });
  const platforms = audit.platforms || [];
  let ok = 0;
  for (const p of platforms) {
    const started = Date.now();
    const res = await client.getText(p.url);
    const ms = Date.now() - started;
    p.http = res.status || 0;
    p.ms = ms;
    p.ok = res.ok;
    p.checked = new Date().toISOString();
    p.access = p.ok ? 'open' : (p.http === 403 || p.http === 503 ? 'blocked' : 'unreachable');
    if (p.ok) ok++;
    logger.entry('etp-probe', p.url, { ok: res.ok, http: p.http, ms, error: res.error || '' });
  }
  audit.checked = new Date().toISOString();
  writeJson('etp-audit.json', audit);
  log(`Аудит ЭТП: доступно ${ok}/${platforms.length}`);
  return ok;
}

async function main() {
  const keywordsData = readJson('tender-keywords.json', { keywords: [] });
  const enterprisesData = readJson('tender-enterprises.json', { items: [] });
  const settings = readJson('tender-settings.json', {});
  const audit = readJson('etp-audit.json', { platforms: [] });
  const prev = readJson('tenders.json', { records: [] }).records || [];
  const keywords = keywordsData.keywords || [];
  const enterprises = enterprisesData.items || [];
  const logger = new CollectLogger(opts.fixture ? 'fixture' : opts.probeOnly ? 'probe' : 'scheduled');
  const foundAt = new Date().toISOString();

  // Пересопоставление уже собранных записей без сети.
  if (opts.refilter) {
    const index = buildCustomerIndex();
    const kept = prev.map(r => {
      const org = matchCustomer(r, index);
      return org ? { ...r, matchedOrgId: org.id, matchedOrgName: org.name, enterpriseIds: [org.id] } : null;
    }).filter(Boolean);
    const records = tagRecords(kept, keywords, enterprises);
    writeJson('tenders.json', { updated: foundAt, count: records.length, records });
    writeJson('tenders-status.json', { lastRun: foundAt, mode: 'refilter', total: records.length, sources: ['refilter'] });
    logger.entry('refilter', 'registry match', { ok: true, records: prev.length, kept: records.length });
    logger.finish({ total: records.length, unique: records.length, matchedOrg: records.length, errors: 0 });
    log(`Пересопоставлено: ${prev.length} → ${records.length}`);
    return;
  }

  let probeOk = 0;
  if (!opts.noProbe && !opts.fixture) probeOk = await probeEtps(audit, logger);
  if (opts.probeOnly) {
    writeJson('tenders-status.json', { lastRun: foundAt, mode: 'probe', probeOk });
    logger.finish({ probeOk, sources: ['etp-probe'] });
    return;
  }

  const priority = (settings.sourcePriority || ['gosplan', 'eis-html']).filter(Boolean);
  const envSource = process.env.ENERGO_SOURCE;
  const sources = opts.fixture ? ['eis-html'] : (envSource ? [envSource] : priority);
  const results = [];
  let records = [];
  let usedSource = '';

  for (const name of sources) {
    try {
      const adapter = name === 'gosplan' ? require('./sources/gosplan') : require('./sources/eis-html');
      const result = await adapter.collect({
        keywords, enterprises, settings, audit, logger,
        fixture: opts.fixture ? path.resolve(opts.fixture) : '',
        maxRecords: opts.limit
      });
      results.push({ name: result.name, available: result.available, requests: result.requests, okRequests: result.okRequests, records: result.records.length, errors: result.errors.length });
      log(`Источник ${result.name}: доступен=${result.available}, запросов=${result.requests}, записей=${result.records.length}`);
      if (result.records.length) {
        records = result.records;
        usedSource = result.name;
        break; // основной источник сработал — резерв не дёргаем
      }
    } catch (e) {
      const err = String((e && e.stack) || e || 'unknown');
      logger.entry(name, 'adapter', { ok: false, error: err });
      results.push({ name, available: false, error: err });
      log(`Источник ${name}: ошибка ${err}`);
    }
  }

  const tagged = tagRecords(records, keywords, enterprises);
  const merged = dedup(prev, tagged, opts.limit);
  writeJson('tenders.json', { updated: foundAt, count: merged.length, records: merged });
  const errors = results.flatMap(r => r.errors || []);
  const summary = {
    total: merged.length,
    unique: tagged.length,
    matchedOrg: merged.filter(r => r.matchedOrgId).length,
    active: merged.filter(r => r.phase === 'active').length,
    archive: merged.filter(r => r.phase === 'archive').length,
    source: usedSource,
    sources: results,
    errors: errors.length,
    probeOk,
    partial: !usedSource
  };
  writeJson('tenders-status.json', Object.assign({ lastRun: foundAt, mode: opts.fixture ? 'fixture' : 'live' }, summary));
  logger.finish(summary);
  log(`ИТОГО: ${tagged.length} найдено, ${merged.length} в файле, источник ${usedSource || 'нет'}, ошибок ${errors.length}`);
  if (!usedSource) log('ВНИМАНИЕ: новые совпадения не найдены (источники недоступны или выдача пуста) — сохранены предыдущие данные.');
}

main().catch(e => { console.error('Критическая ошибка:', e); process.exitCode = 1; });
