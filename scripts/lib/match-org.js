#!/usr/bin/env node
/* Сопоставление заказчика закупки с организациями реестра (339 записей).
 * Совпадение по ИНН имеет приоритет; по названию — только по границам слов,
 * чтобы «ТГК-1» не совпадала с «ТГК-11». */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const clean = (s) => norm(String(s || '')
  .replace(/[«»"'\.,\(\)\-–—]/g, ' ')
  .replace(/^(ооо|ао|пао|фгуп|гуп|зао|оао|филиал)\s+/i, ' '));

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function hasKey(text, key) {
  if (!text || !key) return false;
  if (key.startsWith('inn:')) return false;
  const re = new RegExp('(^|[^a-zа-я0-9])' + escRe(key) + '([^a-zа-я0-9]|$)', 'i');
  return re.test(text);
}

/* enterprises — необязательный список из tender-enterprises.json:
 * добавляет псевдонимы станций/филиалов (например, «Затонская ТЭЦ»). */
function buildCustomerIndex(enterprises) {
  let reg;
  try { reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8')); }
  catch (e) { return []; }

  const byInn = new Map();
  reg.items.forEach(i => {
    if (!i.inn) return;
    const isPlant = i.kind === 'plant';
    if (!byInn.has(i.inn) || !isPlant) byInn.set(i.inn, i);
  });

  const index = [];
  byInn.forEach(i => {
    const keys = new Set();
    const min = i.kind === 'plant' ? 8 : 5;
    [i.name, i.full].forEach(v => {
      const k = clean(v);
      if (k.length >= min) keys.add(k);
      const short = k.replace(/^(башкирская|территориальная|сибирская)\s+/, '');
      if (short.length >= min) keys.add(short);
    });
    if (i.inn && i.inn.length >= 10) keys.add('inn:' + i.inn.slice(0, 10));
    index.push({
      id: i.id, name: i.name, full: i.full || i.name,
      kind: i.kind, inn: i.inn || '', keys: [...keys], aliases: []
    });
  });

  // Станции без собственного ИНН — по названию, с привязкой к родителю.
  reg.items.filter(i => i.kind === 'plant').forEach(p => {
    const parent = reg.items.find(x => x.id === p.parent);
    const keys = new Set();
    const k = clean(p.name);
    if (k.length >= 8) keys.add(k);
    if (keys.size) index.push({
      id: parent ? parent.id : p.id,
      name: parent ? parent.name : p.name,
      full: parent ? (parent.full || parent.name) : (p.full || p.name),
      kind: 'plant', inn: p.inn || '', keys: [...keys], aliases: []
    });
  });

  // Псевдонимы из ручного списка предприятий.
  const aliasMap = new Map();
  (enterprises || []).forEach(e => {
    if (!e || !e.id) return;
    const list = aliasMap.get(e.id) || [];
    [e.query, ...(e.aliases || [])].filter(Boolean).forEach(a => list.push(clean(a)));
    aliasMap.set(e.id, list);
  });
  aliasMap.forEach((aliases, id) => {
    index.filter(x => x.id === id).forEach(x => {
      aliases.forEach(a => {
        if (a.length >= 3) { x.keys.push(a); x.aliases.push(a); }
      });
    });
  });

  return index.filter(x => x.keys.length);
}

function matchCustomer(r, index) {
  if (!r) return null;
  const rawCode = String(r.customerCode || r.customerInn || '').replace(/\D/g, '');
  const rawCustomer = String(r.customer || '');
  const code = (rawCode.length >= 10 ? rawCode : (rawCustomer.replace(/\D/g, '').length >= 10 ? rawCustomer.replace(/\D/g, '') : '')).slice(0, 10);

  if (code) {
    const hit = index.find(x => x.inn && x.inn.slice(0, 10) === code && x.kind !== 'plant');
    if (hit) return hit;
    const any = index.find(x => x.keys.includes('inn:' + code) && x.kind !== 'plant');
    if (any) return any;
  }

  const text = clean([r.customer, r.customerName, r.matchedOrgName].filter(Boolean).join(' '));
  if (text.length < 5 || /^\d+$/.test(text)) return null;

  let best = null;
  for (const x of index) {
    for (const k of x.keys) {
      if (k.startsWith('inn:') || k.length < 5) continue;
      if (!hasKey(text, k) && !(text.length >= 8 && k.length >= 8 && text.includes(k))) continue;
      const score = k.length + (x.kind === 'plant' ? -2 : 0);
      if (!best || score > best.score) best = { org: x, score };
    }
  }
  return best ? best.org : null;
}

/* Если API вернул только ИНН, показываем человеческое название из реестра. */
function customerDisplay(raw, org) {
  const text = String(raw || '').trim();
  if (org) {
    if (!text || /^\d+$/.test(text) || text.length < 6) return org.full || org.name;
    // Короткое/битое имя дополняем полным названием реестра.
    if (text.length < 10 && (org.full || '').length > text.length) return org.full || org.name;
  }
  return text || (org ? (org.full || org.name) : '');
}

module.exports = { norm, clean, buildCustomerIndex, matchCustomer, customerDisplay, hasKey };
