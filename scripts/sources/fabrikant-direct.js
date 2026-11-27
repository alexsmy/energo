#!/usr/bin/env node
/* Прямой сбор Фабриканта: публичная выдача /procedure/search?query=… .
 * Данные приходят в Next.js RSC flight-пayload (self.__next_f.push), а не в
 * __NEXT_DATA__; разбираем только карточки лотов, остальное отбрасываем. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://www.fabrikant.ru';
const NAME = 'fabrikant-direct';

function unescape(v) {
  return String(v || '').replace(/\\"/g, '"').replace(/\\+/g, '').trim();
}
function after(text, from, marker, re, window) {
  const at = text.indexOf(marker, from);
  if (at < 0 || at - from > (window || 2500)) return '';
  const m = re.exec(text.slice(at, at + (window || 2500)));
  return m ? unescape(m[1]) : '';
}

function parse(html) {
  // В flight-пayload кавычки и слеши экранированы: снимаем экранирование,
  // а границы имени задаём следующей парой полей, чтобы кавычки внутри
  // названия организации ("Силовые машины") не ломали разбор.
  const s = String(html || '').replace(/\\\//g, '/').replace(/\\"/g, '"');
  const re = /"url":"(https:\/\/fabrikant\.ru\/[^"]+)","name":"([\s\S]*?)","lotId":(\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    out.push({
      id: m[3],
      url: unescape(m[1]),
      title: unescape(m[2]),
      customer: after(s, m.index, 'Организатор', /"name":"([\s\S]*?)"\}\]/),
      published: after(s, m.index, 'Дата публикации', /"children":"(\d{2}\.\d{2}\.\d{4})(?: \d{2}:\d{2})?"/),
      deadline: after(s, m.index, 'Дата окончания приёма заявок', /"children":"(\d{2}\.\d{2}\.\d{4})(?: \d{2}:\d{2})?"/)
    });
  }
  return out;
}
function isoDate(v) {
  const m = String(v || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function mapRow(row, org, foundAt) {
  if (!row || !row.title || !org) return null;
  return makeRecord({
    id: 'FAB:' + row.id,
    externalId: String(row.id),
    title: row.title,
    customer: row.customer || '',
    customerInn: '',
    org,
    platformCode: 'FAB',
    platformName: 'Фабрикант',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'Фабрикант (прямой HTML/RSC)',
    law: '',
    published: isoDate(row.published),
    deadline: isoDate(row.deadline),
    updated: isoDate(row.published),
    status: '',
    url: row.url || BASE + '/procedure/search',
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.fabDirectInterval, 10) || 900),
    timeout: 25000, retries: 2, backoff: [5000, 15000], browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.fabDirectMaxPages, 10) || 2);

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take(NAME)) {
        logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const params = { query: kw };
      if (page > 1) params.page_number = String(page);
      const url = BASE + '/procedure/search?' + new URLSearchParams(params).toString();
      const t0 = Date.now();
      const res = await client.getText(url);
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
      rows.forEach(row => {
        const org = matchCustomer({ customer: row.customer }, index);
        const record = mapRow(row, org, foundAt);
        if (record) { found.push(record); kept++; }
      });
      logger.entry(NAME, kw + ' стр.' + page, requestInfo(res, url, t0, { records: rows.length, kept }));
      if (!rows.length || rows.length < 10) break;
      if (found.length >= maxRecords) {
        return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }
  return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, isoDate, mapRow, BASE, NAME };
