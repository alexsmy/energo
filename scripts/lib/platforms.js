#!/usr/bin/env node
/* Канонические площадки: распознавание названий из API/HTML и человеческие подписи. */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'platforms.json');
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();

let cached = null;
function load() {
  if (cached) return cached;
  try { cached = JSON.parse(fs.readFileSync(FILE, 'utf8')).items || []; }
  catch (e) { cached = []; }
  return cached;
}

function byCode(code) {
  return load().find((p) => p.code === code) || null;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch (e) { return ''; }
}

/* Приводит произвольное имя площадки (Gentender, HTML, API) к каноническому коду. */
function canonicalPlatform(rawName, url) {
  const host = hostOf(url);
  const text = norm(rawName);
  const list = load();
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch (e) { /* без URL */ }
  // Сначала пути: КИМ Росатома живёт на roseltorg.ru/kim/atom, а не на отдельном хосте.
  if (pathname && host) {
    const hostMatch = (p) => (p.hosts || []).some((h) => host === h || host.endsWith('.' + h));
    const hitPath = list.find((p) => hostMatch(p) && (p.paths || []).some((s) => pathname.includes(s.toLowerCase())));
    if (hitPath) return { code: hitPath.code, name: hitPath.name, kind: hitPath.kind };
  }
  if (host) {
    const hit = list.find((p) => (p.hosts || []).some((h) => host === h || host.endsWith('.' + h)));
    if (hit) return { code: hit.code, name: hit.name, kind: hit.kind };
  }
  if (text) {
    // Сначала точные/длинные шаблоны, чтобы «сбер б2б» не стал «сбербанк-аст».
    const scored = [];
    for (const p of list) {
      for (const pat of p.patterns || []) {
        const n = norm(pat);
        if (n && (text === n || text.includes(n) || n.includes(text))) scored.push({ p, len: n.length });
      }
    }
    scored.sort((a, b) => b.len - a.len);
    if (scored.length) return { code: scored[0].p.code, name: scored[0].p.name, kind: scored[0].p.kind };
  }
  return { code: 'OTHER', name: rawName ? String(rawName).trim() : 'Другая площадка', kind: 'other' };
}

function platformName(code) {
  const p = byCode(code);
  return p ? p.name : (code || 'Другая площадка');
}

function lawLabel(law) {
  const v = String(law || '');
  if (v === '44') return '44-ФЗ';
  if (v === '223') return '223-ФЗ';
  if (v === '615') return '615-ПП';
  if (v === 'commercial' || v === 'comm' || v === 'zmo') return 'коммерческая';
  return '';
}

function sourceRank(r) {
  const s = String((r && (r.source || r.sourceName)) || '').toLowerCase();
  // Приоритет при слиянии одного тендера из нескольких источников:
  // собственный прямой парсер площадки > API ЕИС > старые SSR-адаптеры >
  // агрегатор GenTender > резервный HTML-парсер. Меньше число — выше приоритет.
  if (/-direct/.test(s)) return 0;
  if (/gosplan|госplan|гос ?план/.test(s)) return 1;
  if (/gentender|гендер/.test(s)) return 3;
  if (/eis-html|еис/.test(s)) return 4;
  if (/tektorg|тэк|etpgpb|гпб|roseltorg|росэлторг/.test(s)) return 2;
  return 2;
}

module.exports = { load, byCode, canonicalPlatform, platformName, lawLabel, sourceRank, norm };
