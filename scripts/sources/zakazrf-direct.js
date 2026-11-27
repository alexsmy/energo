#!/usr/bin/env node
/* Прямой сбор ЗаказРФ: серверная таблица /NotificationEx?FastFilter=<слово>.
 * Это ASP.NET/Orchard SSR: все строки отдаютcя в первом ответе, поэтому
 * достаточно одного GET на ключевое слово (пагинация — через POST partial,
 * который пока не используем). Путь /NotificationEx разрешён robots.txt. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://etp.zakazrf.ru';
const NAME = 'zakazrf-direct';

function cp(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 0x10FFFF ? String.fromCodePoint(v) : '';
}
function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => cp(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => cp(+n))
    .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&apos;/gi, "'");
}
function strip(s) {
  return decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function isoDate(s) {
  const m = strip(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function parse(html) {
  const text = String(html || '');
  const rows = [];
  for (const m of text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => strip(x[1]));
    const link = (m[1].match(/\/NotificationEx\/id\/(\d+)/) || [])[1];
    if (!link || cells.length < 8) continue;
    rows.push({
      id: link,
      regNumber: (/^\d{10,}$/.test(cells[1]) ? cells[1] : ''),
      status: cells[2] || '',
      title: cells[4] || '',
      price: cells[5] || '',
      customer: cells[6] || '',
      published: isoDate(cells[9] || cells[8] || ''),
      deadline: isoDate(cells[11] || cells[10] || ''),
      url: BASE + '/NotificationEx/id/' + link
    });
  }
  return rows;
}
function mapRow(row, org, foundAt) {
  if (!row || !row.title || !org) return null;
  return makeRecord({
    id: 'ZAK:' + row.id,
    externalId: String(row.id),
    regNumber: row.regNumber,
    title: row.title,
    customer: row.customer || '',
    customerInn: '',
    org,
    platformCode: 'ZAKAZ',
    platformName: 'ЗаказРФ',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'ЗаказРФ (прямой HTML)',
    law: /44-ФЗ/i.test(row.status) ? '44' : '',
    priceNum: row.price,
    published: row.published,
    deadline: row.deadline,
    status: row.status,
    stage: row.status,
    url: row.url,
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.zakazrfDirectInterval, 10) || 900),
    timeout: 25000, retries: 2, backoff: [5000, 15000], browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.zakazrfDirectMaxPages, 10) || 1);

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take(NAME)) {
        logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const params = { FastFilter: kw };
      if (page > 1) params.PageNumber91182E96173849BB = String(page);
      const url = BASE + '/NotificationEx?' + new URLSearchParams(params).toString();
      const t0 = Date.now();
      const res = await client.getText(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: NAME, query: kw, error: res.error });
        logger.entry(NAME, kw, requestInfo(res, url, t0, { records: 0 }));
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
      const total = (res.body.match(/TotalRows[0-9A-F]+"[^>]*value="(\d+)"/) || [])[1] || '';
      logger.entry(NAME, kw + (page > 1 ? ' стр.' + page : ''), requestInfo(res, url, t0, {
        records: rows.length, kept, total
      }));
      if (!rows.length) break;
      if (found.length >= maxRecords) {
        return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }
  return { name: NAME, records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, isoDate, mapRow, BASE, NAME };
