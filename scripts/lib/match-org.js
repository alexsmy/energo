#!/usr/bin/env node
/* Сопоставление заказчика закупки с организациями реестра (339 записей). */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const clean = (s) => norm(String(s || '')
  .replace(/[«»"'\.,\(\)\-–—]/g, ' ')
  .replace(/^(ооо|ао|пао|фгуп|гуп|зао|оао|филиал)\s+/i, ' '));

function buildCustomerIndex() {
  let reg;
  try { reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8')); }
  catch (e) { return []; }

  // У станций ИНН наследуется от родителя: для одного ИНН предпочитаем юрлицо.
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
    index.push({ id: i.id, name: i.name, kind: i.kind, inn: i.inn, keys: [...keys] });
  });
  // Станции без собственного ИНН — по названию, с привязкой к родителю.
  reg.items.filter(i => i.kind === 'plant').forEach(p => {
    const parent = reg.items.find(x => x.id === p.parent);
    const keys = new Set();
    const k = clean(p.name);
    if (k.length >= 8) keys.add(k);
    if (keys.size) index.push({ id: parent ? parent.id : p.id, name: parent ? parent.name : p.name, kind: 'plant', inn: p.inn || '', keys: [...keys] });
  });
  return index.filter(x => x.keys.length);
}

function matchCustomer(r, index) {
  const text = norm(r.customer || '');
  const code = String(r.customerCode || r.customerInn || '').slice(0, 10);
  if (code) {
    const hit = index.find(x => x.inn && x.inn.slice(0, 10) === code && x.kind !== 'plant');
    if (hit) return hit;
    const any = index.find(x => x.keys.includes('inn:' + code) && x.kind !== 'plant');
    if (any) return any;
  }
  if (text.length < 8) return null;
  let best = null;
  for (const x of index) {
    for (const k of x.keys) {
      if (k.startsWith('inn:') || k.length < 8) continue;
      if (text.includes(k) || k.includes(text)) {
        if (!best || k.length > best.len) best = { org: x, len: k.length };
      }
    }
  }
  return best ? best.org : null;
}

module.exports = { norm, clean, buildCustomerIndex, matchCustomer };
