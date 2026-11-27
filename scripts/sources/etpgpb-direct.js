#!/usr/bin/env node
/* Прямой сбор ЭТП ГПБ через её собственный JSON:API.
 * GET https://etpgpb.ru/api/v2/procedures/?search=<слово>&page=<N>
 * Вместо декодирования Nuxt __NUXT_DATA__ (деvalue, ~2700 элементов). */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://etpgpb.ru';
const API = BASE + '/api/v2/procedures/';
const NAME = 'etpgpb-direct';

function parse(body) {
  if (!body || !Array.isArray(body.data)) return [];
  return body.data;
}
function totalPages(body) {
  const n = body && body.meta && Number(body.meta.total_pages);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function lawOf(kind) {
  const s = String(kind || '').toLowerCase();
  if (s.includes('223')) return '223';
  if (s.includes('44')) return '44';
  if (s.includes('615')) return '615';
  return 'commercial';
}

function mapRow(item, org, foundAt) {
  const a = item && item.attributes;
  if (!a || !a.title || !org) return null;
  const recUrl = a.platform_url && /^https?:/.test(a.platform_url)
    ? a.platform_url
    : (a.truncated_path ? BASE + a.truncated_path : BASE);
  return makeRecord({
    id: 'GPB:' + item.id,
    externalId: String(item.id),
    regNumber: /^\d{15,}$/.test(String(a.registry_number || '')) ? String(a.registry_number) : '',
    title: a.title,
    customer: a.company_name || '',
    customerInn: '',
    org,
    platformCode: 'GPB',
    platformName: 'ЭТП ГПБ',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'ЭТП ГПБ (прямой JSON)',
    law: lawOf(a.kind),
    priceNum: a.amount,
    published: a.date_published,
    deadline: a.end_registration,
    updated: a.date_last_update,
    status: a.stage || '',
    stage: a.stage || '',
    url: recUrl,
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.gpbDirectInterval, 10) || parseInt(settings.gpbInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.gpbDirectMaxPages, 10) || parseInt(settings.gpbMaxPages, 10) || 2);

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take(NAME)) {
        logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const url = API + '?' + new URLSearchParams({ search: kw, page: String(page) }).toString();
      const t0 = Date.now();
      const res = await client.getJson(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: NAME, query: kw, error: res.error });
        logger.entry(NAME, kw + ' стр.' + page, requestInfo(res, url, t0, { records: 0 }));
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = parse(res.body).slice(0, maxRecords);
      let kept = 0;
      rows.forEach(item => {
        const org = matchCustomer({ customer: item && item.attributes && item.attributes.company_name }, index);
        const record = mapRow(item, org, foundAt);
        if (record) { found.push(record); kept++; }
      });
      logger.entry(NAME, kw + ' стр.' + page, requestInfo(res, url, t0, {
        records: rows.length, kept,
        total: res.body && res.body.meta && res.body.meta.total_count
      }));
      if (!rows.length || page >= totalPages(res.body)) break;
      if (found.length >= maxRecords) {
        return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }

  return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, totalPages, lawOf, mapRow, BASE, API, NAME };
