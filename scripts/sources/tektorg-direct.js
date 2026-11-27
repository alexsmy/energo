#!/usr/bin/env node
/* Прямой сбор ТЭК-Торга без SSR/Next.js: собственный JSON-эндпоинт площадки.
 * POST https://www.tektorg.ru/api/getProcedures
 *   {"params":{"name":"турбина","page":1,"limit":20}}
 * Ответ — те же поля, что и в __NEXT_DATA__, но 7–40 КБ вместо ~640 КБ HTML.
 * Это независимый от ГосПлан/GenTender контур прямого сбора. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://www.tektorg.ru';
const API = BASE + '/api/getProcedures';
const NAME = 'tektorg-direct';

function parse(body) {
  if (!body || !Array.isArray(body.data)) return [];
  return body.data;
}

function lawOf(rec) {
  const s = String(rec && rec.sectionAlias || '').toLowerCase();
  if (s.includes('44')) return '44';
  if (s.includes('223')) return '223';
  const reg = String(rec && rec.registryNumber || '');
  if (/^3\d{10}$/.test(reg)) return '223';
  if (/^0\d{18}$/.test(reg)) return '44';
  return 'commercial';
}

function mapRow(rec, org, foundAt) {
  if (!rec || !rec.id || !rec.title || !org) return null;
  const law = lawOf(rec);
  const recUrl = BASE + (rec.sectionAlias ? '/' + rec.sectionAlias : '') + '/procedures/' + rec.id;
  return makeRecord({
    id: 'TEK:' + rec.id,
    externalId: String(rec.id),
    regNumber: /^\d{15,}$/.test(String(rec.registryNumber || '')) ? String(rec.registryNumber) : '',
    title: rec.title,
    customer: rec.organizerName || '',
    customerInn: rec.inn || '',
    org,
    platformCode: 'TEK',
    platformName: 'ТЭК-Торг',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'ТЭК-Торг (прямой JSON)',
    law,
    priceNum: rec.sumPrice,
    published: rec.dates && rec.dates.datePublished,
    deadline: rec.dates && rec.dates.dateEndRegistration,
    updated: rec.dates && rec.dates.datePublished,
    status: rec.statusName || '',
    stage: rec.statusName || '',
    url: recUrl,
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.tektorgDirectInterval, 10) || parseInt(settings.tektorgInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.tektorgDirectMaxPages, 10) || parseInt(settings.tektorgMaxPages, 10) || 4);
  const limit = 20;

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take(NAME)) {
        logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const payload = { params: { name: kw, page, limit } };
      const t0 = Date.now();
      const res = await client.postJson(API, payload);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: NAME, query: kw, error: res.error });
        logger.entry(NAME, kw + ' стр.' + page, requestInfo(res, API, t0, { records: 0 }));
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = parse(res.body).slice(0, maxRecords);
      let kept = 0;
      rows.forEach(rec => {
        const org = matchCustomer({ customer: rec.organizerName, customerInn: rec.inn }, index);
        const record = mapRow(rec, org, foundAt);
        if (record) { found.push(record); kept++; }
      });
      logger.entry(NAME, kw + ' стр.' + page, requestInfo(res, API, t0, {
        records: rows.length, kept, total: res.body && res.body.total
      }));
      const totalPages = res.body && Number(res.body.totalPages) || 1;
      if (!rows.length || rows.length < limit || page >= totalPages) break;
      if (found.length >= maxRecords) {
        return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }

  return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, lawOf, mapRow, BASE, API, NAME };
