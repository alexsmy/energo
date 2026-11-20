#!/usr/bin/env node
/* Единая схема записи и дедупликация источников. */
'use strict';

function day(s) { return s ? String(s).slice(0, 10) : ''; }
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function mapGosplan(p, org, foundAt, query) {
  return {
    id: p.purchase_number,
    title: p.object_info || '',
    customer: p.customer || '',
    customerInn: p.customer || '',
    matchedOrgId: org ? org.id : '',
    matchedOrgName: org ? org.name : '',
    etp: 'EIS',
    source: 'ЕИС / ГосПлан API',
    price: p.max_price != null ? String(p.max_price) + ' ₽' : '',
    published: day(p.published_at),
    deadline: day(p.submission_close_at),
    updated: day(p.updated_at),
    stage: p.stage,
    phase: p.stage === 1 || p.stage === 2 ? 'active' : 'archive',
    url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + encodeURIComponent(p.purchase_number),
    foundQuery: query || '',
    keywords: [],
    enterpriseIds: org ? [org.id] : [],
    foundAt,
    lastSeen: foundAt
  };
}

function dedup(prev, next, limit) {
  const map = new Map();
  [...prev, ...next].forEach(r => {
    if (!r || !r.id) return;
    const old = map.get(r.id);
    if (!old) { map.set(r.id, { ...r }); return; }
    map.set(r.id, {
      ...old, ...r,
      keywords: [...new Set([...(old.keywords || []), ...(r.keywords || [])])],
      enterpriseIds: [...new Set([...(old.enterpriseIds || []), ...(r.enterpriseIds || [])])],
      lastSeen: r.foundAt || old.lastSeen || ''
    });
  });
  return [...map.values()]
    .sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')))
    .slice(0, limit);
}

/* Действующая закупка: дедлайн не прошёл, статус не завершён/отменён. */
function isActive(r, today) {
  const s = norm(r.status);
  if (/заверш|отмен|несостоявш|прекращ/.test(s)) return false;
  if (!r.deadline) return true;
  return r.deadline >= today;
}

module.exports = { day, norm, mapGosplan, dedup, isActive };
