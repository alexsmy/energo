#!/usr/bin/env node
/* Прямой сбор РАД / Lot-online через собственный JSON indexer площадки.
 * GET https://tender.lot-online.ru/api-gateway/indexer/api/lots/query
 *     ?limit=20&page=0&search=<слово>
 * Ответ: {count, data:[{uuid, eisNumber, title, organizationTitle, ...}]}.
 * Нумерация страниц с нуля; корневой lot-online.ru в robots полностью закрыт,
 * используем только tender.lot-online.ru. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://tender.lot-online.ru';
const API = BASE + '/api-gateway/indexer/api/lots/query';
const NAME = 'rad-direct';

function parse(body) {
  if (!body || !Array.isArray(body.data)) return [];
  return body.data;
}
function lawOf(row) {
  const reg = String(row && row.eisNumber || '');
  if (/^3\d{10}$/.test(reg)) return '223';
  if (/^0\d{18}$/.test(reg)) return '44';
  if (/^\d{15,}$/.test(reg)) return '44';
  return 'commercial';
}
function mapRow(row, org, foundAt) {
  if (!row || !row.title || !org) return null;
  const day = (v) => (v && v.date ? String(v.date).slice(0, 10) : '');
  return makeRecord({
    id: 'RAD:' + (row.uuid || row.eisNumber),
    externalId: String(row.uuid || row.eisNumber || ''),
    regNumber: /^\d{10,}$/.test(String(row.eisNumber || '')) ? String(row.eisNumber) : '',
    title: row.titleOffer && row.titleOffer.length > row.title.length ? row.titleOffer : row.title,
    customer: row.organizationTitle || row.organizationShortTitle || '',
    customerInn: '',
    org,
    platformCode: 'RAD',
    platformName: 'РАД / Lot-online',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'РАД (прямой JSON)',
    law: lawOf(row),
    priceNum: row.price,
    published: day(row.publicationDate),
    deadline: day(row.demandEndDate),
    updated: day(row.publicationDate),
    status: row.status || '',
    stage: row.statusGroup || '',
    url: BASE + '/search?search=' + encodeURIComponent(row.title || ''),
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.radDirectInterval, 10) || 900),
    timeout: 25000, retries: 2, backoff: [5000, 15000], browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.radDirectMaxPages, 10) || 2);
  const limit = 20;

  for (const kw of keywords) {
    for (let page = 0; page < maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take(NAME)) {
        logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const url = API + '?' + new URLSearchParams({ limit: String(limit), page: String(page), search: kw });
      const t0 = Date.now();
      const res = await client.getJson(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: NAME, query: kw, error: res.error });
        logger.entry(NAME, kw + ' стр.' + (page + 1), requestInfo(res, url, t0, { records: 0 }));
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = parse(res.body);
      let kept = 0;
      rows.forEach(row => {
        const org = matchCustomer({ customer: row.organizationTitle || row.organizationShortTitle }, index);
        const record = mapRow(row, org, foundAt);
        if (record) { found.push(record); kept++; }
      });
      logger.entry(NAME, kw + ' стр.' + (page + 1), requestInfo(res, url, t0, {
        records: rows.length, kept, total: res.body && res.body.count
      }));
      const count = Number(res.body && res.body.count) || 0;
      if (!rows.length || rows.length < limit || (page + 1) * limit >= count) break;
      if (found.length >= maxRecords) {
        return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }
  return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, lawOf, mapRow, BASE, API, NAME };
