#!/usr/bin/env node
/* Исследование станций через Википедию: типы турбин, ремонты, руководство.
   Результат — data/wiki-research.json (сырые выдержки + извлечённые факты).
   Скрипт НЕ меняет реестр, только готовит материал для ручной курации. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = 'https://ru.wikipedia.org/w/api.php';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ ...params, format: 'json' });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'EnergoRegistry/2.8 (research; contact: noreply@users.noreply.github.com)' } });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
}

function parsePlants() {
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'plants.tsv'), 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  lines.shift();
  return lines.map(l => {
    const c = l.split('|');
    return { id: c[0], parent: c[1], name: c[2], type: c[3], region: c[4], capacity: c[5] };
  });
}

// Извлечь упоминания турбин/оборудования из текста статьи
function extractTurbines(text) {
  const found = new Set();
  // К-300-170, К-800-240-3, Т-180/210-130-3, ПТ-60-90/13, РО-115/697а-ВМ-750,
  // В-420, Г-2, ТГМ-104, ВВЭР-1000, БН-800, СВФ-1690/185-64, ТВВ-200-2А и т.п.
  // ВНИМАНИЕ: в JS \b работает только с ASCII-словесными символами, поэтому
  // ведущий \b отсекает кириллические обозначения (РО, К, Т) — не используем его.
  const re = /([А-Я]{1,4}-\d{1,4}(?:[-\/]\d{1,4}[а-я]?){0,4}(?:-[А-Я]{1,4}-\d{1,4})?)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[1];
    if (tok.length <= 28) found.add(tok);
  }
  // Отсечь мусорные совпадения вроде дат/номеров без профильного контекста
  return [...found].filter(t => /^(К|Т|ПТ|П|Р|РО|В|Г|ТГМ|ТГ|ВВЭР|БН|РБН|СВФ|ТВВ|КТЗ|АП|ЭП|ГТ|ГТУ|ПГ|ТП|ВД|ЦН|СВ|ВО|ТЦ|ОЦ|АТ|БКЗ|ТГМП|Е|КВВ|Д)-/.test(t)).slice(0, 20);
}

function extractEquipmentSentences(text) {
  const out = [];
  const re = /[^.\n]{0,120}(?:турбин|турбоагрегат|гидроагрегат|энергоблок|котел|котлоагрегат|генератор|парогазов)[^.\n]{0,160}[.\n]/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 14) {
    const s = m[0].trim();
    if (s.length > 40) out.push(s);
  }
  return out;
}

// Релевантность найденной статьи: название станции должно совпадать по значащим
// токенам и цифрам (иначе поиск подменяет ТЭЦ-9 на общую статью, ГРЭС-1 на ГРЭС-2).
function relevant(name, title) {
  if (/\((?:значения| disambiguation|неоднозначн)/i.test(title)) return false;
  const norm = s => s.toLowerCase().replace(/ё/g, 'е').replace(/им\..*$/, '').trim();
  const a = norm(name), b = norm(title);
  const toksA = a.split(/[^a-zа-я0-9]+/).filter(t => t.length > 2);
  const toksB = b.split(/[^a-zа-я0-9]+/).filter(t => t.length > 2);
  const digA = (a.match(/\d+/g) || []).filter(d => d.length <= 3);
  const digB = (b.match(/\d+/g) || []).filter(d => d.length <= 3);
  // Если в названии станции есть номер, он обязан присутствовать в заголовке:
  // иначе «Сургутская ГРЭС-1» подменяется на «Рефтинскую ГРЭС» по слову «ГРЭС».
  if (digA.length && !digA.every(d => digB.includes(d))) return false;
  if (!digA.length && digB.length) return false;
  return toksA.some(t => toksB.includes(t));
}

function extractRepairs(text) {
  const out = [];
  const re = /[^.\n]{0,140}(?:ремонт|реконструкц|модернизац|капитальн|авария|аварийн|замена|вывод.{0,12}эксплуатац|ввод.{0,20}эксплуатац|пуск.{0,15}(?:блока|энергоблока|турбины))[^.\n]{0,140}[.\n]/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 12) {
    const s = m[0].trim();
    if (s.length > 30) out.push(s);
  }
  return out;
}

function extractPeople(text) {
  const out = [];
  const re = /[^.\n]{0,120}(?:начальник\s+(?:станции|ТЭЦ|ГРЭС|ГЭС)|директор\s+(?:станции|ТЭЦ|ГРЭС|ГЭС)|главный\s+инженер|руководитель\s+(?:станции|предприятия))[^.\n]{0,120}[.\n]/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 8) {
    const s = m[0].trim();
    if (s.length > 25) out.push(s);
  }
  return out;
}

function extractCapacity(text) {
  const out = [];
  const re = /[^.\n]{0,90}(?:установленная\s+(?:электрическая\s+)?мощность|мощностью)[^.\n]{0,90}[.\n]/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 5) out.push(m[0].trim());
  return out;
}

(async () => {
  const plants = parsePlants();
  // Имена родительских организаций для уточнения поиска (ТЭЦ-22 Мосэнерго и т.п.)
  const entRaw = fs.readFileSync(path.join(ROOT, 'data', 'entities.tsv'), 'utf8').replace(/^\uFEFF/, '');
  const parentName = new Map();
  entRaw.split(/\r?\n/).slice(1).filter(Boolean).forEach(l => {
    const c = l.split('|'); if (c[0]) parentName.set(c[0], c[3]);
  });
  console.log('Станций:', plants.length);

  // Полный текст статьи отдаётся только по одному titles за запрос
  // (prop=extracts без exintro принудительно exlimit=1), поэтому идём через поиск.
  const pages = new Map(); // title -> extract
  const byName = new Map(); // name -> title
  let searched = 0;
  for (const p of plants) {
    const queries = [p.name];
    const pn = parentName.get(p.parent);
    if (pn) queries.push(p.name + ' ' + pn);
    let res = [];
    for (const q of queries) {
      let data;
      try { data = await api({ action: 'query', list: 'search', srsearch: q, srlimit: 5 }); }
      catch (e) { continue; }
      res = data.query && data.query.search ? data.query.search : [];
      if (res.some(c => relevant(p.name, c.title.replace(/<[^>]+>/g, '')))) break;
      await sleep(150);
    }
    // Берём первый релевантный результат, а не просто первый попавшийся
    for (const cand of res) {
      const title = cand.title.replace(/<[^>]+>/g, '');
      if (!relevant(p.name, title)) continue;
      let d;
      try { d = await api({ action: 'query', prop: 'extracts', explaintext: 1, redirects: 1, titles: title }); }
      catch (e) { continue; }
      const pg = Object.values((d.query && d.query.pages) || {})[0];
      if (pg && pg.extract) { pages.set(title, pg.extract); byName.set(p.name, title); searched++; break; }
    }
    await sleep(180);
    if (searched % 20 === 0 && searched) console.log  ('  найдено по поиску:', searched);
  }
  console.log('По поиску:', searched, 'итого статей:', byName.size);

  const report = {};
  for (const p of plants) {
    const title = byName.get(p.name);
    const extract = title ? pages.get(title) : '';
    report[p.id] = {
      name: p.name, parent: p.parent, type: p.type, region: p.region,
      capacity: p.capacity, wikiTitle: title || '',
      turbines: extract ? extractTurbines(extract) : [],
      equipment: extract ? extractEquipmentSentences(extract) : [],
      repairs: extract ? extractRepairs(extract) : [],
      people: extract ? extractPeople(extract) : [],
      capacityHits: extract ? extractCapacity(extract) : [],
      extract: extract || ''
    };
  }

  const outPath = path.join(ROOT, 'data', 'wiki-research.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 1), 'utf8');
  const withWiki = Object.values(report).filter(r => r.wikiTitle).length;
  const withTurb = Object.values(report).filter(r => r.turbines.length).length;
  const withRep = Object.values(report).filter(r => r.repairs.length).length;
  console.log(`Готово: статей ${withWiki}, с турбинами ${withTurb}, с ремонтами ${withRep}. Файл: ${outPath}`);
})().catch(e => { console.error('ФАТАЛЬНО:', e); process.exitCode = 1; });
