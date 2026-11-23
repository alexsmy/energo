#!/usr/bin/env node
/* Адаптер: бесплатный ГосПлан API (данные ЕИС 44-ФЗ / 223-ФЗ / 615-ПП) в JSON. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { mapGosplan } = require('../lib/normalize');

const BASE = 'https://v2test.gosplan.info';

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(1000, parseInt(settings.gosplanInterval, 10) || 6500),
    timeout: 25000,
    retries: 3,
    backoff: [35000, 70000]
  });
  const found = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0, budgetStop = false;
  const errors = [];
  const maxPages = Math.max(1, parseInt(settings.gosplanMaxPages, 10) || 2);
  const limit = Math.min(100, Math.max(10, parseInt(settings.gosplanLimit, 10) || 100));
  const foundAt = new Date().toISOString();

  async function fetchList(endpoint, params, label, phase, law) {
    if (consecutiveFails >= 5 || budgetStop) return; // circuit breaker / бюджет запросов
    if (opts.take && !opts.take('gosplan')) {
      budgetStop = true;
      logger.entry('gosplan', label, { ok: false, records: 0, error: 'budget-exhausted', phase });
      return;
    }
    const url = BASE + endpoint + '?' + new URLSearchParams(params).toString();
    const t0 = Date.now();
    const res = await client.getJson(url);
    requests++;
    if (!res.ok) {
      consecutiveFails++;
      errors.push({ source: 'gosplan', query: label, error: res.error });
      logger.entry('gosplan', label, requestInfo(res, url, t0, { records: 0, phase }));
      return;
    }
    consecutiveFails = 0;
    okRequests++;
    const rows = Array.isArray(res.body) ? res.body : [];
    let kept = 0;
    rows.forEach(p => {
      if (!p || !p.purchase_number) return;
      if (phase === 'active' && p.stage !== 1 && p.stage !== 2) return;
      if (phase === 'archive' && p.stage === 1) return;
      const org = matchCustomer({ customer: p.customer, customerInn: p.customer }, index);
      if (!org) return; // жёсткая привязка к реестру
      found.push(mapGosplan(p, org, foundAt, label, law));
      kept++;
    });
    logger.entry('gosplan', label, requestInfo(res, url, t0, { records: rows.length, kept, phase, total: res.body && res.body.total }));
  }

  // 1. По ИНН организаций реестра — точный охват «все закупки нашего заказчика».
  // По умолчанию выключено: ГосПлан отдаёт 10 запросов/мин, полный обход ИНН
  // занимает десятки минут. Обход по ИНН делает GenTender, а ГосПлан ищет
  // по ключевым словам (быстро и без 429). Включить: settings.gosplanMaxInn.
  const inns = [...new Set(index.filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10)))];
  const maxInn = Math.max(0, parseInt(process.env.ENERGO_MAX_INN || String(settings.gosplanMaxInn || 0), 10) || 0);
  const selectedInns = maxInn > 0 ? inns.slice(0, maxInn) : [];
  for (const inn of selectedInns) {
    await fetchList('/fz223/purchases', { customer: inn, stage: 1, limit }, 'ИНН ' + inn + ' (223)', 'active', '223');
    await fetchList('/fz44/purchases', { customer: inn, stage: 1, limit }, 'ИНН ' + inn + ' (44)', 'active', '44');
    if (found.length > maxRecords) break;
  }

  // 2. По ключевым словам: действующие и завершённые с глубиной.
  const archiveDays = Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30);
  for (const kw of keywords) {
    await fetchList('/fz223/purchases', { object_info: kw, stage: 1, limit }, kw + ' (223, действующие)', 'active', '223');
    await fetchList('/fz44/purchases', { object_info: kw, stage: 1, limit }, kw + ' (44, действующие)', 'active', '44');
    await fetchList('/fz223/purchases', { object_info: kw, stage: 3, published_forpast: archiveDays + 'd', limit }, kw + ' (223, завершённые ' + archiveDays + 'д)', 'archive', '223');
    await fetchList('/fz44/purchases', { object_info: kw, stage: 3, published_forpast: archiveDays + 'd', limit }, kw + ' (44, завершённые ' + archiveDays + 'д)', 'archive', '44');
    for (let page = 1; page < maxPages; page++) {
      const before = found.length;
      await fetchList('/fz223/purchases', { object_info: kw, stage: 3, published_forpast: archiveDays + 'd', limit, skip: page * limit }, kw + ' (223, архив стр.' + (page + 1) + ')', 'archive', '223');
      if (found.length === before) break;
    }
  }

  return {
    name: 'gosplan',
    records: found,
    requests,
    okRequests,
    errors,
    available: okRequests > 0
  };
}

module.exports = { collect, BASE };
