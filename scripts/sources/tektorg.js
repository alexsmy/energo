#!/usr/bin/env node
/* Адаптер: публичный реестр процедур ТЭК-Торг.
 * Данные лежат в __NEXT_DATA__ (JSON), поэтому парсинг устойчивее HTML.
 * ТЭК-Торг — основная площадка Интер РАО, Роснефти и ряда энергокомпаний. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord, priceNum } = require('../lib/normalize');

const BASE = 'https://www.tektorg.ru';

function parse(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let j;
  try { j = JSON.parse(m[1]); } catch (e) { return []; }
  const lp = j.props && j.props.pageProps && j.props.pageProps.initialReduxState && j.props.pageProps.initialReduxState.listingProcedures;
  return (lp && lp.data) || [];
}

function lawOf(rec) {
  const s = String(rec.sectionAlias || '').toLowerCase();
  if (s.includes('44')) return '44';
  if (s.includes('223')) return '223';
  const reg = String(rec.registryNumber || '');
  // 223-ФЗ: 11 цифр, начинается с 3; 44-ФЗ: 19 цифр, начинается с 0.
  if (/^3\d{10}$/.test(reg)) return '223';
  if (/^0\d{18}$/.test(reg)) return '44';
  return 'commercial';
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, limitRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.tektorgInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true // Variti: нужен браузерный UA и cookie challenge
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.tektorgMaxPages, 10) || 3);

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take('tektorg')) {
        logger.entry('tektorg', kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const url = BASE + '/procedures?' + new URLSearchParams({ name: kw, page: String(page) }).toString();
      const t0 = Date.now();
      const res = await client.getText(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: 'tektorg', query: kw, error: res.error });
        logger.entry('tektorg', kw + ' стр.' + page, requestInfo(res, url, t0, { records: 0 }));
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = parse(res.body);
      let kept = 0;
      rows.forEach(rec => {
        if (!rec || !rec.id || !rec.title) return;
        const org = matchCustomer({ customer: rec.organizerName, customerInn: rec.inn }, index);
        if (!org) return;
        const law = lawOf(rec);
        const recUrl = BASE + (rec.sectionAlias ? '/' + rec.sectionAlias : '') + '/procedures/' + rec.id;
        found.push(makeRecord({
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
          source: 'tektorg',
          sourceName: 'ТЭК-Торг',
          law,
          priceNum: rec.sumPrice,
          published: rec.dates && rec.dates.datePublished,
          deadline: rec.dates && rec.dates.dateEndRegistration,
          updated: rec.dates && rec.dates.datePublished,
          status: rec.statusName || '',
          stage: rec.statusName || '',
          url: recUrl,
          foundAt, lastSeen: foundAt
        }));
        kept++;
      });
      logger.entry('tektorg', kw + ' стр.' + page, requestInfo(res, url, t0, { records: rows.length, kept }));
      if (!rows.length || rows.length < 20) break;
      if (found.length >= limitRecords) return { name: 'tektorg', records: found, requests, okRequests, errors, available: okRequests > 0 };
    }
  }

  return { name: 'tektorg', records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, BASE };
