#!/usr/bin/env node
/* Сбор данных с официальных страниц станций, адреса которых указаны в инфобоксах
   Википедии. Достаём станционный адрес, типы турбин/котлов, год ввода и ремонты. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki-research.json'), 'utf8'));
const infobox = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki-infobox.json'), 'utf8'));

// id станции -> URL из инфобокса
const targets = [];
for (const [id, x] of Object.entries(res)) {
  const box = x.wikiTitle ? infobox[x.wikiTitle] : null;
  if (!box) continue;
  const m = String(box.site || '').match(/https?:\/\/[^\s\]]+/);
  if (!m) continue;
  const url = m[0].replace(/[),.;]+$/, '');
  if (!/^https?:\/\/[^\s]+\.[a-z]{2,}/i.test(url)) continue;
  targets.push({ id, name: x.name, url, wikiTitle: x.wikiTitle });
}
console.log('Официальных страниц:', targets.length);

function clean(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ');
}

function pick(text, re, limit = 4) {
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    const s = m[0].replace(/\s+/g, ' ').trim();
    if (s.length > 12 && s.length < 400) out.push(s);
  }
  return out;
}

(async () => {
  const out = {};
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(t.url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnergoRegistry/2.8)' } });
      clearTimeout(timer);
      const buf = await r.arrayBuffer();
      let txt = new TextDecoder('utf-8').decode(buf);
      // Часть российских сайтов отдаёт Windows-1251
      if (/ð|ðè|Í|ðå/.test(txt.slice(0, 2000))) {
        try { txt = new TextDecoder('windows-1251').decode(buf); } catch (e) {}
      }
      const text = clean(txt);
      const cut = s => s.split(/©|Телефон\s*:|Тел\.|E-mail|Эл\. почта|\s+(?=ТЭЦ|ГРЭС|ГЭС|ТЭС|Станция|Электростанция|Расположен|Является|Ввод|Строительство|Первые)/i)[0].replace(/[\s,;:-]+$/, '').trim();
      const address = pick(text, /Адрес\s*[:\-]\s*\d{0,6}[^]{5,180}/gi, 2).map(cut);
      const phones = pick(text, /(?:(?:Тел(?:ефон)?\.?|☎)\s*)?(?:\+7|8)\s*[\s(-]\d{2,4}[\s)-]\d{2,4}[\s-]\d{2}[\s-]\d{2}/gi, 4);
      const emails = pick(text, /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, 4);
      const turbines = pick(text, /(?:паров(?:ая|ой)|теплофикационн(?:ая|ой)|газов(?:ая|ой)|конденсационн(?:ая|ой))?\s*турбин[а-я]*\s+(?:типа\s+)?(?:№?\s*\d+\s*)?[(]?(?:К|Т|ПТ|Р|РО|ГТУ|ПГУ|Г)-?\d{1,4}[^.,;]{0,40}/gi, 8);
      const boilers = pick(text, /(?:кот(?:ёл|лоагрегат|ельн)[а-я]*\s+(?:типа\s+)?)(?:ТГМ|ТГ|БКЗ|ТП|П)-?\d{1,4}[^.,;]{0,30}/gi, 6);
      const repairs = pick(text, /[^.]{0,90}(?:19|20)\d{2}[^.]{0,40}(?:ремонт|реконструкц|модернизац|перевооруж|замен|введ[её]н|пуск)[^.]{0,140}\./gi, 8);
      const year = pick(text, /(?:Дата ввода в эксплуатацию|Ввод в эксплуатацию|Год ввода)[^.]{0,60}/gi, 2);
      out[t.id] = { name: t.name, url: t.url, wikiTitle: t.wikiTitle, address, phones, emails, turbines, boilers, repairs, year, ok: r.ok };
    } catch (e) {
      out[t.id] = { name: t.name, url: t.url, error: String(e.message).slice(0, 80) };
    }
    if ((i + 1) % 25 === 0) console.log('  обработано', i + 1);
    await sleep(150);
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'official-research.json'), JSON.stringify(out, null, 1), 'utf8');
  const ok = Object.values(out).filter(x => x.ok && x.address).length;
  console.log('Готово:', Object.keys(out).length, 'страниц, с адресами:', ok);
})().catch(e => { console.error('ФАТАЛЬНО:', e); process.exitCode = 1; });
