#!/usr/bin/env node
/* Прямой сбор Росэлторга: публичный HTML-фрагмент /procedures/search_ajax.
 * У площадки нет открытого JSON API, поэтому работаем с её собственным веб-
 * запросом, но разбираем только карточки и явно сообщаем о смене разметки. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://www.roseltorg.ru';
const API = BASE + '/procedures/search_ajax';
const NAME = 'roseltorg-direct';

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
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

/* Возвращает { rows, broken }: broken=true, если HTML получен, но разметка
 * не узнана — это отличает «0 закупок» от «ANTI-BOT / смена вёрстки». */
function parse(html) {
  const text = String(html || '');
  const blocks = text.split(/<div class="search-results__item/).slice(1);
  const rows = blocks.map(b => {
    const id = (b.match(/data-feature-favorite-lots-procedure-number="([^"]+)"/) || [])[1] || '';
    if (!id) return null;
    const title = strip((b.match(/search-results__link--description">([\s\S]*?)<\/a>/) || [])[1]);
    const customerBlock = (b.match(/search-results__customer([\s\S]*?)(?:search-results__keywords|search-results__data)/) || [])[1] || b;
    const customerTitle = (customerBlock.match(/title="([^"]*)"/) || [])[1] || '';
    const customer = strip(customerTitle.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ''));
    const inn = (strip(customerTitle).match(/ИНН\s*(\d{10,12})/) || [])[1] || '';
    const status = strip((b.match(/search-results__status[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const deadline = isoDate((b.match(/search-results__time">([\s\S]*?)<\/time>/) || [])[1]);
    const priceRaw = strip((b.match(/search-results__sum[\s\S]{0,1500}?<p class="desktop">([\s\S]*?)<\/p>/) || [])[1]);
    return {
      id, title, customer, inn, status, deadline,
      price: priceRaw.replace(/&nbsp;/g, ' '),
      url: BASE + '/procedure/' + encodeURIComponent(id) + '/1'
    };
  }).filter(Boolean);
  return { rows, broken: text.length > 1000 && rows.length === 0 };
}

function mapRow(rec, org, foundAt, phase) {
  if (!rec || !rec.id || !rec.title || !org) return null;
  return makeRecord({
    id: 'ROS:' + rec.id,
    externalId: rec.id,
    title: rec.title,
    customer: rec.customer,
    customerInn: rec.inn,
    org,
    platformCode: 'ROS',
    platformName: 'Росэлторг (ЕЭТП)',
    platformUrl: BASE,
    source: NAME,
    sourceName: 'Росэлторг (прямой HTML)',
    law: '',
    priceNum: rec.price,
    published: '',
    deadline: rec.deadline,
    status: rec.status,
    stage: rec.status,
    phase,
    url: rec.url,
    foundAt, lastSeen: foundAt
  });
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.roseltorgDirectInterval, 10) || parseInt(settings.roseltorgInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, parseFails = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.roseltorgDirectMaxPages, 10) || parseInt(settings.roseltorgMaxPages, 10) || 2);
  const modes = [
    { phase: 'active', statuses: ['5', '0', '1'] },
    { phase: 'archive', statuses: ['2', '3', '4'] }
  ];

  for (const mode of modes) {
    for (const kw of keywords) {
      for (let page = 0; page < maxPages; page++) {
        if (consecutiveFails >= 5) break;
        if (opts.take && !opts.take(NAME)) {
          logger.entry(NAME, kw, { ok: false, records: 0, error: 'budget-exhausted', phase: mode.phase });
          break;
        }
        const params = new URLSearchParams();
        params.set('query_field', kw);
        params.set('sale', '1');
        mode.statuses.forEach(s => params.append('status[]', s));
        if (page) params.set('page', String(page)); // у площадки нумерация с нуля
        const url = API + '?' + params.toString();
        const t0 = Date.now();
        const res = await client.getText(url);
        requests++;
        if (!res.ok) {
          consecutiveFails++;
          errors.push({ source: NAME, query: kw, error: res.error });
          logger.entry(NAME, kw + ' [' + mode.phase + ']', requestInfo(res, url, t0, { records: 0, phase: mode.phase }));
          break;
        }
        consecutiveFails = 0;
        okRequests++;
        const { rows, broken } = parse(res.body);
        if (broken) {
          parseFails++;
          errors.push({ source: NAME, query: kw, error: 'markup-changed-or-challenge' });
        }
        let kept = 0;
        rows.forEach(rec => {
          const org = matchCustomer({ customer: rec.customer, customerInn: rec.inn }, index);
          const record = mapRow(rec, org, foundAt, mode.phase);
          if (record) { found.push(record); kept++; }
        });
        logger.entry(NAME, kw + ' [' + mode.phase + ', стр.' + (page + 1) + ']',
          requestInfo(res, url, t0, { records: rows.length, kept, phase: mode.phase, error: broken ? 'markup-changed-or-challenge' : '' }));
        if (!rows.length) break;
        if (found.length >= maxRecords) {
          return { name: NAME, records: found, requests, okRequests, errors, parseFails, available: okRequests > 0 };
        }
      }
    }
  }

  return { name: NAME, records: found, requests, okRequests, errors, parseFails, available: okRequests > 0 };
}

module.exports = { collect, parse, mapRow, BASE, API, NAME };
