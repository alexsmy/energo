#!/usr/bin/env node
/* Адаптер: бесплатный ГосПлан API (данные ЕИС 44-ФЗ / 223-ФЗ / 615-ПП) в JSON. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { mapGosplan } = require('../lib/normalize');

const BASE = 'https://v2test.gosplan.info';
const FOUND_AT = new Date().toISOString();

async function collect(opts) {
  const { keywords = [], settings = {}, logger, limitRecords = 2000 } = opts;
  const index = buildCustomerIndex();
  const client = new ThrottledClient({
    minInterval: Math.max(1000, parseInt(settings.gosplanInterval, 10) || 6500),
    timeout: 25000,
    retries: 3,
    backoff: [35000, 70000]
  });
  const found = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const errors = [];
  const maxPages = Math.max(1, parseInt(settings.gosplanMaxPages, 10) || 3);
  const limit = Math.min(100, Math.max(10, parseInt(settings.gosplanLimit, 10) || 100));

  async function fetchList(endpoint, params, label, phase) {
    if (consecutiveFails >= 5) return; // circuit breaker: источник недоступен
    const url = BASE + endpoint + '?' + new URLSearchParams(params).toString();
    const res = await client.getJson(url);
    requests++;
    if (!res.ok) {
      consecutiveFails++;
      errors.push({ source: 'gosplan', query: label, error: res.error });
      logger.entry('gosplan', label, { ok: false, http: res.status || 0, records: 0, error: res.error, phase });
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
      found.push(mapGosplan(p, org, FOUND_AT, label));
      kept++;
    });
    logger.entry('gosplan', label, { ok: true, http: res.status, records: rows.length, kept, phase, url });
  }

  // 1. По ИНН организаций реестра — точный охват «все закупки нашего заказчика».
  const inns = [...new Set(index.filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10)))];
  const maxInn = Math.max(0, parseInt(process.env.ENERGO_MAX_INN || '0', 10) || 0);
  const selectedInns = maxInn ? inns.slice(0, maxInn) : inns;
  for (const inn of selectedInns) {
    await fetchList('/fz223/purchases', { customer: inn, stage: 1, limit }, 'ИНН ' + inn + ' (223)', 'active');
    await fetchList('/fz44/purchases', { customer: inn, stage: 1, limit }, 'ИНН ' + inn + ' (44)', 'active');
  }

  // 2. По ключевым словам: действующие и завершённые с глубиной.
  const archiveDays = Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30);
  for (const kw of keywords) {
    await fetchList('/fz223/purchases', { object_info: kw, stage: 1, limit }, kw + ' (223, действующие)', 'active');
    await fetchList('/fz44/purchases', { object_info: kw, stage: 1, limit }, kw + ' (44, действующие)', 'active');
    await fetchList('/fz223/purchases', { object_info: kw, stage: 3, published_forpast: archiveDays + 'd', limit }, kw + ' (223, завершённые ' + archiveDays + 'д)', 'archive');
    for (let page = 1; page < maxPages; page++) {
      const before = found.length;
      await fetchList('/fz223/purchases', { object_info: kw, stage: 3, published_forpast: archiveDays + 'd', limit, skip: page * limit }, kw + ' (223, архив стр.' + (page + 1) + ')', 'archive');
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
