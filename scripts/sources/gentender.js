#!/usr/bin/env node
/* Адаптер: публичный поиск GenTender (агрегатор 44/223/малых и коммерческих закупок).
 * API отдаёт площадку (etp_name), закон, заказчика, цену, даты и ссылку на первоисточник.
 * В выдачу оставляем только заказчиков реестра — как и для остальных источников. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { mapGentender } = require('../lib/normalize');

const BASE = 'https://gentender.ru';

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, limitRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(900, parseInt(settings.gentenderInterval, 10) || 1150),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000]
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const limit = Math.min(100, Math.max(10, parseInt(settings.gentenderLimit, 10) || 100));
  const maxPages = Math.max(1, parseInt(settings.gentenderMaxPages, 10) || 2);
  const archiveDays = Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30);
  const publishFrom = new Date(Date.now() - archiveDays * 86400000).toISOString().slice(0, 10);

  async function fetchPage(params, label, phase, query, pages) {
    if (consecutiveFails >= 6) return 0;
    let kept = 0;
    const pageLimit = Math.max(1, pages || maxPages);
    for (let page = 0; page < pageLimit; page++) {
      if (opts.take && !opts.take('gentender')) {
        logger.entry('gentender', label, { ok: false, records: 0, error: 'budget-exhausted', phase });
        return kept;
      }
      const p = { ...params, limit: String(limit), offset: String(page * limit) };
      const url = BASE + '/api/tenders/search?' + new URLSearchParams(p).toString();
      const t0 = Date.now();
      const res = await client.getJson(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: 'gentender', query: label, error: res.error });
        logger.entry('gentender', label, requestInfo(res, url, t0, { records: 0, phase }));
        return kept;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = (res.body && res.body.rows) || [];
      rows.forEach(row => {
        if (!row || !row.title) return;
        const org = matchCustomer({
          customer: row.customer_name,
          customerInn: row.customer_code || row.customer_key
        }, index);
        if (!org) return;
        found.push(mapGentender(row, org, foundAt, query, phase));
        kept++;
      });
      logger.entry('gentender', label + (page ? ' стр.' + (page + 1) : ''),
        requestInfo(res, url, t0, { records: rows.length, kept, phase, total: res.body && res.body.total }));
      if (rows.length < limit || (res.body && res.body.total != null && (page + 1) * limit >= res.body.total)) break;
      if (found.length >= limitRecords) return kept;
    }
    return kept;
  }

  const inns = [...new Set(index.filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10)))];
  const maxInn = Math.max(0, parseInt(process.env.ENERGO_MAX_INN || '0', 10) || 0);
  const selectedInns = maxInn ? inns.slice(0, maxInn) : inns;

  const innPageCount = Math.max(1, parseInt(settings.gentenderInnPages, 10) || 1);
  for (const inn of selectedInns) {
    await fetchPage({ customer_inn: inn, only_active: '1' }, 'ИНН ' + inn + ' (действующие)', 'active', 'ИНН ' + inn, innPageCount);
    await fetchPage({ customer_inn: inn, only_active: '0', publish_from: publishFrom }, 'ИНН ' + inn + ' (архив)', 'archive', 'ИНН ' + inn, innPageCount);
    if (found.length >= limitRecords) break;
  }

  // Ключевые слова по всем площадкам — дополняют охват по ИНН и ловят
  // закупки, где заказчик указан названием без ИНН.
  for (const kw of keywords) {
    await fetchPage({ q: kw, only_active: '1' }, kw + ' (действующие)', 'active', kw);
    await fetchPage({ q: kw, only_active: '0', publish_from: publishFrom }, kw + ' (архив)', 'archive', kw);
  }

  return { name: 'gentender', records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, BASE };
