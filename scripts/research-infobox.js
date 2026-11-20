#!/usr/bin/env node
/* Инфобоксы станций из wikitext Википедии: Турбины, Котлы, Генераторы,
   год ввода, собственник, сайт. В explaintext этих полей нет.
   Параллельно по 6 запросов, с таймаутом и инкрементальной сохранностью. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const API = 'https://ru.wikipedia.org/w/api.php';
const OUT = path.join(ROOT, 'data', 'wiki-infobox.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki-research.json'), 'utf8'));
const titles = [...new Set(Object.values(res).map(x => x.wikiTitle).filter(Boolean))];
let out = {};
try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
const todo = titles.filter(t => !out[t]);
console.log('Статей:', titles.length, 'осталось:', todo.length);

function field(w, name) {
  const re = new RegExp('\\|\\s*' + name + '\\s*=([^\\n]*)', 'i');
  const m = w.match(re);
  if (!m) return '';
  return m[1].replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/<[^>]+>/g, '').replace(/''+/g, '').replace(/^\s*|\s*$/g, '').trim();
}

async function fetchTitle(title) {
  const u = API + '?' + new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', format: 'json' });
  for (let a = 0; a < 5; a++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'EnergoRegistry/2.8 (research; contact noreply@users.noreply.github.com)' } });
      clearTimeout(timer);
      if (r.status === 429) { await sleep(2500 * (a + 1)); continue; }
      const d = await r.json();
      const w = (d.parse && d.parse.wikitext && d.parse.wikitext['*']) || '';
      if (!w) return null;
      return {
        turbines: field(w, 'Турбины'), boilers: field(w, 'Котлы'),
        generators: field(w, 'Электрогенераторы'),
        year: field(w, 'Начало эксплуатации').replace(/[^\d\-–—]/g, '').slice(0, 12),
        owner: field(w, 'Собственник'), site: field(w, 'Сайт'),
        power: field(w, 'Мощность'), heat: field(w, 'Отпуск тепла')
      };
    } catch (e) { clearTimeout(timer); await sleep(500 * (a + 1)); }
  }
  return null;
}

(async () => {
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const title = todo.shift();
      const box = await fetchTitle(title);
      if (box) out[title] = box;
      done++;
      await sleep(350);
      if (done % 25 === 0) {
        fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
        console.log('  обработано', done, 'осталось', todo.length);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  const filled = Object.values(out).filter(x => x.turbines || x.boilers || x.generators).length;
  console.log('Готово:', Object.keys(out).length, 'статей, с оборудованием:', filled);
})().catch(e => { console.error('ФАТАЛЬНО:', e); process.exitCode = 1; });
