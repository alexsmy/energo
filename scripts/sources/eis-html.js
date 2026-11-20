#!/usr/bin/env node
/* Резервный адаптер: прямой HTML-поиск на сайте ЕИС (сохранён из старого сборщика).
 * Не удаляется — дорабатывается отдельно. Используется только если API недоступен
 * или явно запрошено settings.sourcePriority.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ThrottledClient, sleep } = require('../lib/throttle');
const { buildCustomerIndex, matchCustomer } = require('../lib/match-org');
const { isActive, norm } = require('../lib/normalize');

const ROOT = path.join(__dirname, '..', '..');
const FOUND_AT = new Date().toISOString();

function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&apos;/gi, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function isoDate(s) {
  const m = decode(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function parseEis(html, query) {
  const blocks = html.split(/<div class="registry-entry__header"/).slice(1);
  const pick = (b, re) => { const m = b.match(re); return m ? decode(m[1]) : ''; };
  return blocks.map(b => {
    const num = pick(b, /registry-entry__header-mid__number[\s\S]{0,500}?№\s*(\d{10,})/) || pick(b, /regNumber=(\d{10,})/);
    if (!num) return null;
    const href = pick(b, /href="(\/epz\/order\/notice\/[^"]+)"/);
    const title = pick(b, /Объект закупки<\/div>\s*<div class="registry-entry__body-value">([\s\S]*?)<\/div>/) || pick(b, /registry-entry__body-value">([\s\S]*?)<\/div>/);
    const customer = pick(b, /Заказчик<\/div>[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>/);
    const customerCode = pick(b, /organizationCode=(\d{10,})/);
    const status = pick(b, /registry-entry__header-mid__title[^>]*>([\s\S]*?)<\/div>/);
    const price = pick(b, /price-block__value"[^>]*>([\s\S]*?)<\/div>/);
    const raw = (re) => { const m = b.match(re); return m ? m[1] : ''; };
    return {
      id: num, title, customer, customerCode, status,
      etp: 'EIS', source: 'ЕИС / HTML', price,
      published: isoDate(raw(/Размещено<\/div>\s*<div class="data-block__value">([\s\S]*?)<\/div>/)),
      updated: isoDate(raw(/Обновлено<\/div>\s*<div class="data-block__value">([\s\S]*?)<\/div>/)),
      deadline: isoDate(raw(/Окончание подачи заявок<\/div>\s*<div class="data-block__value">([\s\S]*?)<\/div>/)),
      url: href ? 'https://zakupki.gov.ru' + href : 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + encodeURIComponent(num),
      keywords: query ? [query] : [], query
    };
  }).filter(Boolean);
}

async function collect(opts) {
  const { keywords = [], enterprises = [], settings = {}, audit, logger, fixture = '', maxRecords = 2000 } = opts;
  const index = buildCustomerIndex();
  const client = new ThrottledClient({ minInterval: Math.max(100, parseInt(settings.htmlInterval, 10) || 1500), timeout: 25000, retries: 2, backoff: [6000, 12000] });
  const eUrl = (audit.platforms || []).find(p => p.code === 'EIS');
  const template = (eUrl && eUrl.urlTemplate) || 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString={q}&morphology=on&fz44=on&fz223=on&pageNumber=1&sortBy=UPDATE_DATE&recordsPerPage=_10';
  const perPage = 10, maxPages = Math.max(1, parseInt(settings.htmlMaxPages, 10) || 5);
  const today = FOUND_AT.slice(0, 10);
  const found = [];
  let requests = 0, okRequests = 0, consecutiveFails = 0;
  const errors = [];

  const modes = [
    { phase: 'active', depth: 0 },
    { phase: 'archive', depth: Math.max(1, parseInt(settings.archiveDepthDays, 10) || 30) }
  ];
  const queries = [...new Set([...keywords, ...enterprises.map(e => e.query)])].filter(Boolean);

  async function runQuery(q, mode) {
    if (consecutiveFails >= 4) return;
    for (let page = 1; page <= maxPages; page++) {
      let url = template.replace('{q}', encodeURIComponent(q)).replace('{company}', encodeURIComponent(q));
      url = url.replace(/pageNumber=1/, 'pageNumber=' + page);
      if (mode.depth) {
        const d = new Date(Date.now() - mode.depth * 86400000);
        const from = [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('.');
        url += '&publishDateFrom=' + encodeURIComponent(from);
      }
      const res = fixture ? { ok: true, body: fixture, status: 200 } : await client.getText(url);
      requests++;
      if (!res.ok) {
        consecutiveFails++;
        errors.push({ source: 'eis-html', query: q, error: res.error });
        logger.entry('eis-html', q + ' [' + mode.phase + ']', { ok: false, http: res.status || 0, records: 0, error: res.error, phase: mode.phase });
        break;
      }
      consecutiveFails = 0;
      okRequests++;
      const parsed = parseEis(res.body, q);
      if (!parsed.length) { logger.entry('eis-html', q + ' [' + mode.phase + ']', { ok: true, http: res.status, records: 0, phase: mode.phase }); break; }
      let kept = 0;
      parsed.forEach(r => {
        const org = matchCustomer(r, index);
        if (!org) return;
        const keep = mode.phase === 'active' ? isActive(r, today) : !isActive(r, today);
        if (!keep) return;
        found.push({ ...r, matchedOrgId: org.id, matchedOrgName: org.name, phase: mode.phase, enterpriseIds: [org.id], foundAt: FOUND_AT, lastSeen: FOUND_AT });
        kept++;
      });
      logger.entry('eis-html', q + ' [' + mode.phase + ', стр.' + page + ']', { ok: true, http: res.status, records: parsed.length, kept, phase: mode.phase });
      if (fixture || parsed.length < perPage) break;
    }
  }

  for (const mode of modes) for (const q of queries) await runQuery(q, mode);

  return { name: 'eis-html', records: found, requests, okRequests, errors, available: okRequests > 0 };
}

module.exports = { collect, parseEis };
