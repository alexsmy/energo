#!/usr/bin/env node
/* Адаптер: Росэлторг (ЕЭТП).
 * Публичный поиск отдаёт HTML-фрагмент через /procedures/search_ajax.
 * Площадка используется РусГидро, Росатомом, СГК, «Т Плюс» и др. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');

const BASE = 'https://www.roseltorg.ru';

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

function parse(html) {
  const blocks = String(html || '').split(/<div class="search-results__item/).slice(1);
  return blocks.map(b => {
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
    const section = strip((b.match(/title="Торговая секция">([^<]+)/) || [])[1]);
    return {
      id, title, customer, inn, status, deadline,
      price: priceRaw.replace(/&nbsp;/g, ' '),
      section,
      url: BASE + '/procedure/' + encodeURIComponent(id) + '/1'
    };
  }).filter(Boolean);
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.roseltorgInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.roseltorgMaxPages, 10) || 3);
  const modes = [
    { phase: 'active', statuses: ['5', '0', '1'] },
    { phase: 'archive', statuses: ['2', '3', '4'] }
  ];

  for (const mode of modes) {
    for (const kw of keywords) {
      for (let page = 0; page < maxPages; page++) {
        if (consecutiveFails >= 5) break;
        if (opts.take && !opts.take('roseltorg')) {
          logger.entry('roseltorg', kw, { ok: false, records: 0, error: 'budget-exhausted', phase: mode.phase });
          break;
        }
        const params = new URLSearchParams();
        params.set('query_field', kw);
        params.set('sale', '1');
        mode.statuses.forEach(s => params.append('status[]', s));
        if (page) params.set('page', String(page));
        const url = BASE + '/procedures/search_ajax?' + params.toString();
        const t0 = Date.now();
        const res = await client.getText(url);
        requests++;
        if (!res.ok) {
          consecutiveFails++;
          errors.push({ source: 'roseltorg', query: kw, error: res.error });
          logger.entry('roseltorg', kw + ' [' + mode.phase + ']', requestInfo(res, url, t0, { records: 0, phase: mode.phase }));
          break;
        }
        consecutiveFails = 0;
        okRequests++;
        const rows = parse(res.body);
        let kept = 0;
        rows.forEach(rec => {
          const org = matchCustomer({ customer: rec.customer, customerInn: rec.inn }, index);
          if (!org) return;
          found.push(makeRecord({
            id: 'ROS:' + rec.id,
            externalId: rec.id,
            title: rec.title,
            customer: rec.customer,
            customerInn: rec.inn,
            org,
            platformCode: 'ROS',
            platformName: 'Росэлторг (ЕЭТП)',
            platformUrl: BASE,
            source: 'roseltorg',
            sourceName: 'Росэлторг',
            law: '',
            priceNum: rec.price,
            published: '',
            deadline: rec.deadline,
            status: rec.status,
            stage: rec.status,
            phase: mode.phase,
            url: rec.url,
            foundAt, lastSeen: foundAt
          }));
          kept++;
        });
        logger.entry('roseltorg', kw + ' [' + mode.phase + ', стр.' + (page + 1) + ']',
          requestInfo(res, url, t0, { records: rows.length, kept, phase: mode.phase }));
        if (!rows.length) break;
        if (found.length >= maxRecords) return { name: 'roseltorg', records: found, requests, okRequests, errors, available: okRequests > 0 };
      }
    }
  }

  return { name: 'roseltorg', records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, BASE };
