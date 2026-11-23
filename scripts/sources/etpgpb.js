#!/usr/bin/env node
/* Адаптер: ЭТП ГПБ (Газпромбанк).
 * Реестр процедур открыт, данные — в Nuxt-снимке страницы.
 * Площадка используется Газпром энергохолдингом и частными компаниями. */
'use strict';
const { ThrottledClient } = require('../lib/throttle');
const { requestInfo } = require('../lib/logger');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { makeRecord } = require('../lib/normalize');
const { fromHtml } = require('../lib/nuxt-data');

const BASE = 'https://etpgpb.ru';

function parse(html) {
  const root = fromHtml(html);
  const ps = root && root.pinia && root.pinia.PROCEDURES_STORE;
  return (ps && ps.procedures) || [];
}

function lawOf(kind) {
  const s = String(kind || '').toLowerCase();
  if (s.includes('223')) return '223';
  if (s.includes('44')) return '44';
  if (s.includes('615')) return '615';
  return 'commercial';
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, logger, maxRecords = 2000 } = opts;
  const index = buildCustomerIndex(enterprises);
  const client = new ThrottledClient({
    minInterval: Math.max(700, parseInt(settings.gpbInterval, 10) || 900),
    timeout: 25000,
    retries: 2,
    backoff: [5000, 15000],
    browser: true
  });
  const found = [];
  const errors = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const foundAt = new Date().toISOString();
  const maxPages = Math.max(1, parseInt(settings.gpbMaxPages, 10) || 3);

  for (const kw of keywords) {
    for (let page = 1; page <= maxPages; page++) {
      if (consecutiveFails >= 5) break;
      if (opts.take && !opts.take('etpgpb')) {
        logger.entry('etpgpb', kw, { ok: false, records: 0, error: 'budget-exhausted' });
        break;
      }
      const url = BASE + '/procedures/?' + new URLSearchParams({ search: kw, page: String(page) }).toString();
      const t0 = Date.now();
      const res = await client.getText(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: 'etpgpb', query: kw, error: res.error });
        logger.entry('etpgpb', kw + ' стр.' + page, requestInfo(res, url, t0, { records: 0 }));
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const rows = parse(res.body);
      let kept = 0;
      rows.forEach(item => {
        const a = item && item.attributes;
        if (!a || !a.title) return;
        const org = matchCustomer({ customer: a.company_name }, index);
        if (!org) return;
        const law = lawOf(a.kind);
        const recUrl = a.platform_url && /^https?:/.test(a.platform_url)
          ? a.platform_url
          : (a.truncated_path ? BASE + a.truncated_path : BASE);
        found.push(makeRecord({
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
          source: 'etpgpb',
          sourceName: 'ЭТП ГПБ',
          law,
          priceNum: a.amount,
          published: a.date_published,
          deadline: a.end_registration,
          updated: a.date_last_update,
          status: a.stage || '',
          stage: a.stage || '',
          url: recUrl,
          foundAt, lastSeen: foundAt
        }));
        kept++;
      });
      logger.entry('etpgpb', kw + ' стр.' + page, requestInfo(res, url, t0, { records: rows.length, kept }));
      if (!rows.length || rows.length < 20) break;
      if (found.length >= maxRecords) return { name: 'etpgpb', records: found, requests, okRequests, errors, available: okRequests > 0 };
    }
  }

  return { name: 'etpgpb', records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parse, BASE };
