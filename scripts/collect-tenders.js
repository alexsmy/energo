#!/usr/bin/env node
/* Оркестратор сбора закупок: несколько независимых источников → нормализация → дедуп → лог.
 *
 *   node scripts/collect-tenders.js                  полный прогон
 *   node scripts/collect-tenders.js --source=gentender
 *   node scripts/collect-tenders.js --probe-only     только аудит ЭТП
 *   node scripts/collect-tenders.js --no-probe       без проверки площадок
 *   node scripts/collect-tenders.js --fixture=f.html тест HTML-парсера без сети
 *   node scripts/collect-tenders.js --refilter       пересопоставление старых записей
 *   node scripts/collect-tenders.js --verbose
 *
 * Локально под TLS-прокси Termux: NODE_TLS_REJECT_UNAUTHORIZED=0 ...
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ThrottledClient } = require('./lib/throttle');
const { buildCustomerIndex, matchCustomer, customerDisplay } = require('./lib/match-org');
const { dedup, makeRecord, sourceEntry, splitWordScore, identityKeys } = require('./lib/normalize');
const { platformName, canonicalPlatform, sourceRank } = require('./lib/platforms');
const { CollectLogger } = require('./lib/logger');
const { nonWorking, mskDate } = require('./lib/schedule');
const innStateLib = require('./lib/inn-state');
const tm = require('../js/text-match');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const MAX_RECORDS = 3000;
const DEFAULT_SOURCES = ['gosplan', 'gentender', 'tektorg', 'etpgpb', 'roseltorg', 'eis-html'];

const argv = process.argv.slice(2);
const arg = (name, def) => { const h = argv.find(a => a.startsWith('--' + name + '=')); return h ? h.slice(name.length + 3) : def; };
const has = (n) => argv.includes('--' + n);
const opts = {
  fixture: arg('fixture', ''),
  limit: Math.max(10, parseInt(arg('limit', String(MAX_RECORDS)), 10) || MAX_RECORDS),
  source: arg('source', '') || process.env.ENERGO_SOURCE || '',
  noProbe: has('no-probe'), probeOnly: has('probe-only'),
  refilter: has('refilter'), verbose: has('verbose'),
  dryRun: has('dry-run'), force: has('force'),
  allInns: has('all-inns'), deepArchive: has('deep-archive'), fullWindow: has('full-window')
};
const log = (...a) => { if (opts.verbose || !opts.fixture) console.log(...a); };

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return fallback; }
}
function writeJson(name, obj) { fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

/* Ключевые слова ищем только в названии закупки. Заказчик подсвечиваться
 * не должен: он нужен для поиска, но не является совпадением по слову.
 * Для составных запросов проверяются все группы must (И между группами). */
function tagRecords(records, keywords, enterprises) {
  const entries = (keywords || []).filter(Boolean);
  records.forEach(r => {
    const matched = tm.matchEntries(r.title || '', entries).map((e) => e.label);
    r.keywords = [...new Set(matched)];
    r.matchedKeywords = [...new Set(matched)];
    const ids = new Set(r.enterpriseIds || []);
    if (r.matchedOrgId) ids.add(r.matchedOrgId);
    const text = tm.norm(r.customer + ' ' + (r.matchedOrgName || ''));
    (enterprises || []).forEach(e => {
      if (!e || !e.id) return;
      const words = [e.query, ...(e.aliases || [])].filter(Boolean);
      if (words.some(n => text.includes(tm.norm(n)))) ids.add(e.id);
    });
    r.enterpriseIds = [...ids];
  });
  return records;
}

/* Приводим старые записи к новой схеме без потери данных. */
function normalizeLegacy(r, index, enterprises) {
  if (!r || !r.id) return null;
  const org = matchCustomer(r, index);
  const rawPlatform = r.platformCode || r.etp || 'OTHER';
  const p = canonicalPlatform(r.platformName || platformName(rawPlatform), r.platformUrl || r.url);
  const sourceName = r.sourceName || (/(госplan|гос ?план)/i.test(r.source || '') ? 'ГосПлан API'
    : /gen/i.test(r.source || '') ? 'GenTender'
      : /тэк/i.test(r.source || '') ? 'ТЭК-Торг'
        : /гпб/i.test(r.source || '') ? 'ЭТП ГПБ'
          : /росэлторг/i.test(r.source || '') ? 'Росэлторг'
            : /еис|zakupki|eis/i.test(r.source || '') ? 'ЕИС'
              : (r.source || 'Источник'));
  const rec = makeRecord({
    ...r,
    org,
    platformCode: p.code || rawPlatform,
    platformName: p.name || r.platformName || platformName(rawPlatform),
    platformUrl: r.platformUrl || '',
    source: r.source || '',
    sourceName,
    keywords: r.keywords || [],
    matchedKeywords: r.matchedKeywords || [],
    enterpriseIds: r.enterpriseIds || []
  });
  rec.sources = (r.sources && r.sources.length) ? r.sources : [sourceEntry(rec)];
  return rec;
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

/* В выдачу попадают только закупки, совпавшие хотя бы с одной ключевой фразой.
 * Иначе обход по ИНН Enterprises добавляет всё подряд («Поставка щебня»). */
function applyRequireKeyword(records, settings) {
  if (settings.requireKeyword === false) return { kept: records, dropped: 0 };
  const kept = records.filter(r => (r.matchedKeywords || r.keywords || []).length > 0);
  return { kept, dropped: records.length - kept.length };
}

/* Бюджет сетевых запросов на прогон: не даём площадкам исчерпать квоты
 * и не упираемся в 429. Расход считается по каждому источнику отдельно. */
function createBudget(map) {
  const usage = {};
  Object.keys(map || {}).forEach((name) => {
    usage[name] = { limit: Number(map[name]) || 0, used: 0, exhausted: false };
  });
  const take = (name) => {
    const u = usage[name];
    if (!u) return true;
    if (u.used >= u.limit) { u.exhausted = true; return false; }
    u.used += 1;
    return true;
  };
  return { take, usage };
}

/* В API уходит только опорное слово фразы: «ремонт проточной части турбины»
 * и «замена лопаток турбины» дают один запрос по слову «турбина». */
function queryTerms(keywords) {
  return [...new Set((keywords || []).map((k) => tm.entryOf(k).search).filter(Boolean))];
}

/* Ключи активных закупок из последнего снимка архива (обычно вчерашнего).
 * Если архива ещё нет — сравниваем с текущим содержимым tenders.json. */
function previousActiveKeys(today, fallbackRecords) {
  const dir = path.join(DATA, 'archive');
  try {
    const files = fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < today)
      .sort();
    if (files.length) {
      const snap = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
      return new Set((snap.records || []).filter(r => r.phase === 'active').flatMap(r => identityKeys(r)));
    }
  } catch (e) { /* архив может отсутствовать — используем фолбэк */ }
  return new Set(fallbackRecords.filter(r => r.phase === 'active').flatMap(r => identityKeys(r)));
}

function adapterFor(name) {
  switch (name) {
    case 'gosplan': return require('./sources/gosplan');
    case 'gentender': return require('./sources/gentender');
    case 'tektorg': return require('./sources/tektorg');
    case 'etpgpb': return require('./sources/etpgpb');
    case 'roseltorg': return require('./sources/roseltorg');
    case 'eis-html': return require('./sources/eis-html');
    default: return null;
  }
}

async function main() {
  if (opts.dryRun) {
    const plan = require('./lib/plan');
    console.log(plan.formatPlan(plan.makePlan()));
    return;
  }
  const gate = nonWorking(new Date());
  if (gate.reason && !opts.force) {
    log(`Пропуск ${gate.day}: ${gate.reason}. Для ручного прогона: --force.`);
    return;
  }
  const keywordsData = readJson('tender-keywords.json', { keywords: [] });
  const enterprisesData = readJson('tender-enterprises.json', { items: [] });
  const settings = readJson('tender-settings.json', {});
  const audit = readJson('etp-audit.json', { platforms: [] });
  const prev = readJson('tenders.json', { records: [] }).records || [];
  const keywords = keywordsData.keywords || [];
  const terms = queryTerms(keywords);
  const budget = createBudget(settings.requestBudget || {});
  const enterprises = enterprisesData.items || [];
  const index = buildCustomerIndex(enterprises);
  const logger = new CollectLogger(opts.fixture ? 'fixture' : opts.probeOnly ? 'probe' : 'scheduled');
  logger.budgetState = (name) => {
    const u = budget.usage[name];
    return u ? `${u.used}/${u.limit}` : '';
  };
  const foundAt = new Date().toISOString();
  const today = mskDate(new Date());

  // Накопленное состояние обхода по ИНН + инкрементальное окно архива.
  const innState = innStateLib.load();
  const lastStatus = readJson('tenders-status.json', {});
  const overlapDays = Math.max(1, parseInt(settings.archiveOverlapDays, 10) || 2);
  const incrementalFrom = (!opts.fullWindow && !lastStatus.partial && !opts.force)
    ? innStateLib.incrementalFrom(lastStatus.lastRun, overlapDays) : '';
  const weekday = new Date(mskDate(new Date()) + 'T12:00:00Z').getUTCDay();
  // Архив по каждому ИНН — раз в неделю (понедельник) или по требованию.
  // В остальные дни релевантный архив приходит из keyword-запросов.
  const deepArchive = opts.deepArchive || opts.force || weekday === 1;

  // Пересопоставление уже собранных записей без сети.
  if (opts.refilter) {
    const normalized = prev.map(r => normalizeLegacy(r, index, enterprises)).filter(Boolean);
    const tagged = tagRecords(normalized, keywords, enterprises);
    const filtered = applyRequireKeyword(tagged, settings);
    const records = dedup([], filtered.kept, opts.limit);
    const splitAfter = records.filter(r => splitWordScore(r.title)).length;
    writeJson('tenders.json', { updated: foundAt, count: records.length, records });
    writeJson('tenders-status.json', {
      lastRun: foundAt, mode: 'refilter', total: records.length,
      active: records.filter(r => r.phase === 'active').length,
      archive: records.filter(r => r.phase === 'archive').length,
      droppedNoKeyword: filtered.dropped,
      titlesSuspicious: splitAfter,
      sources: ['refilter']
    });
    logger.entry('refilter', 'registry match', { ok: true, records: prev.length, kept: records.length, droppedNoKeyword: filtered.dropped });
    logger.finish({ total: records.length, unique: records.length, matchedOrg: records.filter(r => r.matchedOrgId).length, droppedNoKeyword: filtered.dropped, errors: 0 });
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

  const priority = opts.source
    ? opts.source.split(',').map(s => s.trim()).filter(Boolean)
    : ((settings.sourcePriority || DEFAULT_SOURCES).filter(Boolean));
  const sources = opts.fixture ? ['eis-html'] : priority;
  const results = [];
  let records = [];

  for (const name of sources) {
    const adapter = adapterFor(name);
    if (!adapter) { log(`Неизвестный источник: ${name}`); continue; }
    try {
      const result = await adapter.collect({
        keywords: terms, enterprises, settings, audit, logger,
        take: budget.take,
        fixture: opts.fixture ? path.resolve(opts.fixture) : '',
        maxRecords: opts.limit,
        innState, incrementalFrom, deepArchive, allInns: opts.allInns
      });
      results.push({
        name: result.name, available: result.available, requests: result.requests,
        okRequests: result.okRequests, records: result.records.length,
        errors: result.errors.length, errorItems: result.errors || []
      });
      log(`Источник ${result.name}: доступен=${result.available}, запросов=${result.requests}, записей=${result.records.length}`);
      records.push(...result.records);
    } catch (e) {
      const err = String((e && e.stack) || e || 'unknown');
      logger.entry(name, 'adapter', { ok: false, error: err });
      results.push({ name, available: false, error: err, errors: 1, errorItems: [{ source: name, query: 'adapter', error: err }] });
      log(`Источник ${name}: ошибка ${err}`);
    }
  }

  const tagged = tagRecords(records, keywords, enterprises);
  // Старые записи тоже приводим к новой схеме, иначе в файле остаются
  // «безымянные» площадки и потерянные источники.
  const prevNormalized = prev.map(r => normalizeLegacy(r, index, enterprises)).filter(Boolean);
  const mergedAll = dedup(prevNormalized, tagged, opts.limit);
  // Глубина архива: завершённые закупки старше archiveDepthDays не держим.
  const archiveDays = Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30);
  const cutoff = new Date(Date.now() - archiveDays * 86400000).toISOString().slice(0, 10);
  const taggedAll = tagRecords(mergedAll.filter(r => r.phase !== 'archive' || String(r.published || r.deadline || '') >= cutoff), keywords, enterprises);
  const filtered = applyRequireKeyword(taggedAll, settings);
  const merged = filtered.kept;

  // Локальный переход active → archive без лишнего запроса к API:
  // deadline прошёл или запись была в prev.active, но сегодня не найдена.
  const foundKeys = new Set(tagged.flatMap(r => identityKeys(r)));
  const prevActiveKeys = new Set(prev.filter(p => p.phase === 'active').flatMap(p => identityKeys(p)));
  const yesterdayKeys = previousActiveKeys(today, prev);
  let localArchived = 0, newCount = 0;
  merged.forEach(r => {
    if (r.phase !== 'active') return;
    const keys = identityKeys(r);
    // «Новое» — появилось по сравнению со вчерашним снимком архива.
    r.isNew = yesterdayKeys.size > 0 && !keys.some(k => yesterdayKeys.has(k));
    if (r.isNew) { r.firstSeen = r.firstSeen || foundAt; newCount++; }
    const expired = !!r.deadline && String(r.deadline) < today;
    const vanished = keys.some(k => prevActiveKeys.has(k)) && !keys.some(k => foundKeys.has(k));
    if (expired || vanished) {
      r.phase = 'archive';
      r.phaseSource = expired ? 'deadline' : 'local';
      localArchived++;
    }
  });
  const corroborated = merged.filter(r => (r.sources || []).length >= 2).length;
  const titlesSuspicious = merged.filter(r => splitWordScore(r.title)).length;
  writeJson('tenders.json', { updated: foundAt, count: merged.length, records: merged });
  const errors = results.flatMap(r => r.errorItems || []);
  const probeErrors = (logger.run.entries || []).filter(e => e.source === 'etp-probe' && e.ok === false);
  const bySource = {};
  merged.forEach(r => {
    const key = r.platformCode || r.etp || 'OTHER';
    bySource[key] = (bySource[key] || 0) + 1;
  });
  const summary = {
    total: merged.length,
    unique: tagged.length,
    matchedOrg: merged.filter(r => r.matchedOrgId).length,
    active: merged.filter(r => r.phase === 'active').length,
    archive: merged.filter(r => r.phase === 'archive').length,
    bySource,
    sources: results,
    errors: errors.length,
    probeErrors: probeErrors.length,
    probeOk,
    droppedNoKeyword: filtered.dropped,
    titlesSuspicious,
    localArchived,
    newCount,
    corroborated,
    corroboratedPct: merged.length ? Math.round(corroborated / merged.length * 100) : 0,
    relevantPerRequest: results.reduce((a, r) => a + (r.requests || 0), 0)
      ? +(tagged.length / results.reduce((a, r) => a + (r.requests || 0), 0)).toFixed(2) : 0,
    deepArchive, incrementalFrom,
    budget: budget.usage,
    partial: results.some(r => !r.available)
  };
  writeJson('tenders-status.json', Object.assign({ lastRun: foundAt, mode: opts.fixture ? 'fixture' : 'live' }, summary));

  // Сводная информация по каждому ИНН — «сначала сводка, потом добивание».
  const coverage = { updated: foundAt, inns: {} };
  [...new Set(index.filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10)))].forEach(inn => {
    const st = innState.items[inn] || {};
    const org = index.find(x => x.inn && x.inn.slice(0, 10) === inn && x.kind !== 'plant');
    coverage.inns[inn] = {
      name: org ? org.name : '',
      lastOk: st.lastOk || '',
      lastArchive: st.lastArchive || '',
      total: st.total != null ? st.total : null,
      emptyStreak: st.emptyStreak || 0,
      covered: !!st.lastOk && (Date.now() - new Date(st.lastOk).getTime()) <= 8 * 86400000
    };
  });
  writeJson('tender-coverage.json', coverage);
  innStateLib.save(innState);
  logger.finish(summary);
  log(`ИТОГО: ${tagged.length} найдено, ${merged.length} в файле (отброшено без ключевых слов: ${filtered.dropped}), площадок ${Object.keys(bySource).length}, ошибок ${errors.length}`);
  if (!records.length) log('ВНИМАНИЕ: новые совпадения не найдены (источники недоступны или выдача пуста) — сохранены предыдущие данные.');
}

main().catch(e => { console.error('Критическая ошибка:', e); process.exitCode = 1; });
