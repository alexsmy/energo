#!/usr/bin/env node
/* Курация данных research-wiki.js -> data/plants-detail.json.
   Отбираем только проверяемые факты: типы турбин (с количеством), котельное/
   генераторное оборудование, ремонты и реконструкции с годами. Ничего не выдумываем. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki-research.json'), 'utf8'));
let infobox = {};
try { infobox = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki-infobox.json'), 'utf8')); }
catch (e) { /* ещё не собран */ }
let official = {};
try { official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'official-research.json'), 'utf8')); }
catch (e) { /* ещё не собран */ }

// Достать модели оборудования из произвольного текста (обрывки предложений сайтов)
function modelsFromText(text, rx) {
  const found = new Set();
  let m;
  while ((m = rx.exec(text))) {
    const t = m[1].replace(/[.,;:]$/, '');
    if (t.length <= 28) found.add(t);
  }
  return [...found];
}
const MODEL_RX = /([А-Я]{1,4}-\d{1,4}(?:[-\/]\d{1,4}[а-я]?){0,4})\b/g;

// Инфобоксы часто пишут «3хТ-85-90-2,51хCLN660» без пробелов — разделяем модели
// Слить предложения ремонтов, отбросив повторы и оборванные фрагменты
function mergeRepairs(a, b) {
  const seen = new Set();
  const parts = [a, b].filter(Boolean).join(' ').split(/(?<=[.!?])\s+/);
  const out = [];
  for (let s of parts) {
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length < 40 || /(ст|№)\.$/.test(s)) continue;
    const key = s.slice(0, 55).toLowerCase();
    if (seen.has(key) || out.some(o => o.includes(s.slice(0, 45)))) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 7).join(' ').slice(0, 950);
}

function tidyModels(s) {
  return String(s || '')
    .replace(/(\d)\s*[хxX]\s*(?=[А-ЯA-Z])/g, '$1×')
    .replace(/(?<=[A-ZА-Я0-9)])(?=\d{1,2}×[А-ЯA-Z])/g, '; ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/^;\s*/, '').trim();
}

// Очистка значения инфобокса от вики-разметки и мусора
function cleanBox(v) {
  return String(v || '').replace(/\[[^\]]*\]/g, '').replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').replace(/[;,.\s]+$/, '').trim();
}

// Префиксы, которые действительно являются турбинами (или реакторами АЭС)
const TURBINE = /^(К|Т|ПТ|Р|РО|В|Г|ГТУ|ГТ|ПГ|ВВЭР|БН|РБН|КТ)-/;
// Котлы и генераторы — уходит в отдельное поле «Оборудование»
const BOILER = /^(ТГМ|ТГМП|ТГ|БКЗ|ТП|П|КВВ|Е|ДКВР)-/;
const GENERATOR = /^(ТВВ|СВФ|ТФ|ВТ|ГВ)-/;

function quantityFor(token, equipment) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const s of equipment) {
    const re = new RegExp(esc + '[^;.\\n]{0,60}?(\\d{1,3})\\s*(?:шт|турбин|энергоблок|агрегат)', 'i');
    const m = s.match(re);
    if (m) return +m[1];
    const m2 = s.match(new RegExp('(\\d{1,3})\\s*(?:шт|турбин|энергоблок|агрегат)[^;.\\n]{0,60}?' + esc, 'i'));
    if (m2) return +m2[1];
  }
  return 0;
}

function curateTurbines(x) {
  const tokens = x.turbines.filter(t => TURBINE.test(t));
  const part = tokens.map(t => {
    const q = quantityFor(t, x.equipment);
    return q ? q + '×' + t : t;
  });
  // Убираем дубли, сохраняя порядок
  return [...new Set(part)].slice(0, 12).join('; ');
}

function curateEquipment(x) {
  const b = x.turbines.filter(t => BOILER.test(t)).map(t => {
    const q = quantityFor(t, x.equipment);
    return q ? q + '×' + t : t;
  });
  const g = x.turbines.filter(t => GENERATOR.test(t)).map(t => {
    const q = quantityFor(t, x.equipment);
    return q ? q + '×' + t : t;
  });
  const out = [];
  if (b.length) out.push('котлы: ' + [...new Set(b)].slice(0, 8).join(', '));
  if (g.length) out.push('генераторы: ' + [...new Set(g)].slice(0, 8).join(', '));
  return out.join('; ');
}

// Состав мощности по энергоблокам/агрегатам — когда в Википедии нет моделей турбин
function curateUnits(x) {
  const text = (x.equipment || []).join(' ') + ' ' + (x.capacityHits || []).join(' ') + ' ' + (x.extract || '').slice(0, 18000);
  const out = [];
  const re = /(\d{1,2})\s+(?:энергоблоков|энергоблока|блоков|блока|турбоагрегатов|гидроагрегатов|агрегатов)\s+(?:по|мощностью\s+по|мощностью)\s+(\d{1,4}(?:[.,]\d+)?)\s*МВт/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 8) out.push(m[1] + '×' + m[2] + ' МВт');
  const pgu = text.match(/\b(?:ПГУ|ГТУ)-\d{2,4}[А-Яа-я]?\b/gi);
  if (pgu) out.push(...[...new Set(pgu)].slice(0, 5));
  return [...new Set(out)].slice(0, 10).join('; ');
}

function curateRepairs(x) {
  const good = x.repairs.filter(s => {
    if (s.length < 40 || s.length > 380) return false;
    if (!/(?:19|20)\d{2}/.test(s)) return false;
    return /ремонт|реконструкц|модернизац|перевооруж|замен|пуск|ввод|вывод|авари|technical/i.test(s);
  });
  const clean = good.map(s => s
    .replace(/\s+/g, ' ').trim()
    .replace(/^C\s(?=\d{4}|199|200)/, 'С ')
    .replace(/[,\s]+$/, '')
    .replace(/\s+([.!?])\s+/g, '$1 ')
  ).filter(s => s.length > 40);
  // Приоритет — текстам с ремонтом/модернизацией, затем по году
  const weight = s => (/ремонт|реконструкц|модернизац|перевооруж|замен/.test(s) ? 2 : 1) + (/20\d{2}/.test(s) ? 1 : 0);
  const sorted = clean.sort((a, b) => weight(b) - weight(a));
  const picked = [];
  let total = 0;
  for (const s of sorted) {
    if (picked.length >= 4 || total >= 640) break;
    const room = 640 - total;
    let piece = s.length > room ? s.slice(0, room).replace(/\s+\S*$/, '') + '…' : s;
    picked.push(piece);
    total += piece.length + 1;
  }
  return picked.join(' ');
}

const out = {};
let nT = 0, nE = 0, nR = 0, nU = 0;
for (const [id, x] of Object.entries(res)) {
  const d = {};
  const turbines = curateTurbines(x);
  const units = curateUnits(x);
  const equipment = curateEquipment(x);
  const repairs = curateRepairs(x);
  if (turbines) { d.turbines = turbines; nT++; }
  if (units) { d.units = units; nU++; }
  if (equipment) { d.equipment = equipment; nE++; }
  if (repairs) { d.repairs = repairs; nR++; }
  if (x.wikiTitle) d.wiki = 'https://ru.wikipedia.org/wiki/' + encodeURIComponent(x.wikiTitle.replace(/ /g, '_'));

  // Инфобокс Википедии: модели турбин, котлы, генераторы, год ввода, сайт станции
  const box = x.wikiTitle ? infobox[x.wikiTitle] : null;
  if (box) {
    const bt = cleanBox(box.turbines);
    if (bt && !d.turbines) { d.turbines = bt; nT++; }
    const bb = cleanBox(box.boilers), bg = cleanBox(box.generators);
    const bEq = [bb ? 'котлы: ' + bb : '', bg ? 'генераторы: ' + bg : ''].filter(Boolean).join('; ');
    if (bEq && !d.equipment) { d.equipment = bEq; nE++; }
    if (box.year && !d.year) d.year = box.year;
    // Заполняем пустую электрическую мощность из инфобокса, если там явно указано «МВт»
    if (!x.capacity) {
      const pw = cleanBox(box.power);
      const mw = pw.match(/([\d][\d\s.,]*)\s*МВт/i);
      if (mw) d.capacity = mw[1].replace(/\s/g, '').replace(',', '.');
    }
    const bs = String(box.site || '').match(/https?:\/\/[^\s\]]+/);
    if (bs && !d.site) d.site = bs[0];
  }

  // Официальная страница станции: собственный адрес и уточнённое оборудование
  const of = official[id];
  if (of && of.ok) {
    if (of.address && of.address[0]) d.address = of.address[0].replace(/^Адрес:\s*/, '');
    if (of.url && !d.site) d.site = of.url;
    const ofModels = modelsFromText((of.turbines || []).join(' '), MODEL_RX)
      .filter(t => TURBINE.test(t));
    if (ofModels.length) {
      const have = new Set((d.turbines || '').split('; ').map(s => s.replace(/^\d+×/, '')));
      const add = ofModels.filter(t => !have.has(t));
      if (add.length) d.turbines = [d.turbines, add.join('; ')].filter(Boolean).join('; ');
      if (!d.turbines) nT++;
    }
    const ofBoilers = modelsFromText((of.boilers || []).join(' '), MODEL_RX).filter(t => BOILER.test(t));
    if (ofBoilers.length) {
      d.equipment = [d.equipment, 'котлы: ' + ofBoilers.slice(0, 6).join(', ')].filter(Boolean).join('; ');
      nE++;
    }
    if (of.repairs && of.repairs.length) {
      const extra = of.repairs.map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 35).slice(0, 4);
      const merged = mergeRepairs(d.repairs, extra.join(' '));
      if (extra.length && !d.repairs) nR++;
      d.repairs = merged;
    }
    if (of.year && of.year[0] && !d.year) {
      const y = of.year[0].match(/(?:19|20)\d{2}/);
      if (y) d.year = y[0];
    }
  }

  if (d.turbines) d.turbines = tidyModels(d.turbines);
  if (d.equipment) d.equipment = tidyModels(d.equipment);
  if (Object.keys(d).length) out[id] = d;
}

const p = path.join(ROOT, 'data', 'plants-detail.json');
fs.writeFileSync(p, JSON.stringify(out, null, 1), 'utf8');
console.log(`Готово: турбины ${nT}, блоки ${nU}, оборудование ${nE}, ремонты ${nR}, записей ${Object.keys(out).length}`);
