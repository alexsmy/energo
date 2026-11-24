#!/usr/bin/env node
/* План сетевых запросов на один прогон — без обращений к сети.
 * Используется `--dry-run` и как ориентир при изменении бюджетов.
 * Считает верхнюю границу: адаптеры могут прекратить выборку раньше
 * (пустая страница, circuit breaker), но не могут превысить этот план.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tm = require('../../js/text-match');
const { buildCustomerIndex } = require('./match-org');

const DATA = path.join(__dirname, '..', '..', 'data');
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch (e) { return fallback; }
}
const int = (v, def, min) => Math.max(min == null ? 1 : min, parseInt(v, 10) || def);

function makePlan() {
  const keywords = readJson('tender-keywords.json', { keywords: [] }).keywords || [];
  const entries = keywords.map(k => tm.entryOf(k)).filter(e => e.search);
  const baseEntries = entries.filter(e => e.kind !== 'composite');
  const compositeEntries = entries.filter(e => e.kind === 'composite');
  const terms = [...new Set(entries.map(e => e.search).filter(Boolean))];
  // Составные запросы должны опираться на уже существующее базовое слово:
  // тогда они не добавляют ни одного сетевого запроса.
  const extraTerms = terms.filter(t => !baseEntries.some(e => e.search === t));
  const enterprises = readJson('tender-enterprises.json', { items: [] }).items || [];
  const settings = readJson('tender-settings.json', {});
  const index = buildCustomerIndex(enterprises);
  const inns = [...new Set(index.filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10)))];

  const requests = [];
  const add = (source, label, phase, cadence) => requests.push({ source, label, phase, cadence: cadence || 'daily' });

  // ГосПлан: обход по ИНН по умолчанию выключен ( sluggish 10 запросов/мин).
  const gosMaxInn = int(process.env.ENERGO_MAX_INN || settings.gosplanMaxInn, 0, 0);
  const gosInns = gosMaxInn > 0 ? inns.slice(0, gosMaxInn) : [];
  const gosPages = int(settings.gosplanMaxPages, 2, 1);
  for (const inn of gosInns) {
    add('gosplan', 'ИНН ' + inn + ' (223)', 'active');
    add('gosplan', 'ИНН ' + inn + ' (44)', 'active');
  }
  for (const term of terms) {
    add('gosplan', term + ' (223, действующие)', 'active');
    add('gosplan', term + ' (44, действующие)', 'active');
    add('gosplan', term + ' (223, завершённые)', 'archive');
    add('gosplan', term + ' (44, завершённые)', 'archive');
    for (let page = 1; page < gosPages; page++) add('gosplan', term + ' (223, архив стр.' + (page + 1) + ')', 'archive');
  }

  // GenTender: ВСЕ ИНН реестра × два режима. Это главный контур покрытия.
  const genMaxInn = int(process.env.ENERGO_MAX_INN, 0, 0);
  const genInns = genMaxInn > 0 ? inns.slice(0, genMaxInn) : inns;
  const genInnPages = int(settings.gentenderInnPages, 1, 1);
  const genPages = int(settings.gentenderMaxPages, 2, 1);
  for (const inn of genInns) {
    for (let p = 0; p < genInnPages; p++) {
      add('gentender', 'ИНН ' + inn + ' (действующие)' + (p ? ' стр.' + (p + 1) : ''), 'active');
      add('gentender', 'ИНН ' + inn + ' (архив)' + (p ? ' стр.' + (p + 1) : ''), 'archive', 'weekly');
    }
  }
  for (const term of terms) {
    for (let p = 0; p < genPages; p++) {
      add('gentender', term + ' (действующие)' + (p ? ' стр.' + (p + 1) : ''), 'active');
      add('gentender', term + ' (архив)' + (p ? ' стр.' + (p + 1) : ''), 'archive');
    }
  }

  // Прямые площадки: только ключевые слова, по страницам из настроек.
  const direct = [
    ['tektorg', 'tektorgMaxPages'],
    ['etpgpb', 'gpbMaxPages'],
    ['roseltorg', 'roseltorgMaxPages']
  ];
  for (const [name, key] of direct) {
    const pages = int(settings[key], 2, 1);
    const modes = name === 'roseltorg' ? ['active', 'archive'] : [''];
    for (const mode of modes) for (const term of terms) for (let p = 0; p < pages; p++) {
      add(name, term + (mode ? ' [' + mode + ']' : '') + (p ? ' стр.' + (p + 1) : ''), mode || 'active');
    }
  }

  // Резервный HTML-парсер ЕИС: слова + названия предприятий × два режима.
  const queries = [...new Set([...terms, ...enterprises.map(e => e.query)])].filter(Boolean);
  const htmlPages = int(settings.htmlMaxPages, 5, 1);
  for (const phase of ['active', 'archive']) for (const q of queries) for (let p = 0; p < htmlPages; p++) {
    add('eis-html', q + ' [' + phase + ']' + (p ? ' стр.' + (p + 1) : ''), phase);
  }

  const intervals = {
    gosplan: int(settings.gosplanInterval, 6500, 0),
    gentender: int(settings.gentenderInterval, 1150, 0),
    tektorg: int(settings.tektorgInterval, 900, 0),
    etpgpb: int(settings.gpbInterval, 900, 0),
    roseltorg: int(settings.roseltorgInterval, 900, 0),
    'eis-html': int(settings.htmlInterval, 1500, 0)
  };
  const budget = settings.requestBudget || {};
  const bySource = {};
  for (const r of requests) {
    const b = bySource[r.source] || (bySource[r.source] = {
      count: 0, daily: 0, weekly: 0, limit: Number(budget[r.source]) || 0,
      interval: intervals[r.source] || 0, phases: {}
    });
    b.count++;
    if (r.cadence === 'weekly') b.weekly++; else b.daily++;
    b.phases[r.phase || '-'] = (b.phases[r.phase || '-'] || 0) + 1;
  }
  Object.values(bySource).forEach(b => {
    b.effective = b.limit ? Math.min(b.count, b.limit) : b.count;
    b.dailyEffective = b.limit ? Math.min(b.daily, b.limit) : b.daily;
    b.seconds = Math.round(b.dailyEffective * b.interval / 1000);
  });

  return { terms, extraTerms, baseCount: baseEntries.length, compositeCount: compositeEntries.length, inns, enterprises: enterprises.length, requests, bySource, settings };
}

function formatPlan(plan) {
  const lines = [];
  lines.push('ПЛАН ЗАПРОСОВ НА ОДИН ПРОГОН (без сети)');
  lines.push('Базовых слов: ' + plan.baseCount + ' · составных запросов: ' + plan.compositeCount +
    ' · уникальных слов в API: ' + plan.terms.length);
  lines.push('Слов в API: ' + plan.terms.join(', ') + ' | ИНН организаций: ' + plan.inns.length + ' | предприятий в списке: ' + plan.enterprises);
  if (plan.extraTerms && plan.extraTerms.length) {
    lines.push('Составные запросы без базового слова (добавляют запросы): ' + plan.extraTerms.join(', '));
  }
  lines.push('');
  lines.push('Источник       Всего  День  Нед.  Лимит  Время/день  Режимы');
  let total = 0, daily = 0, weekly = 0;
  for (const [name, b] of Object.entries(plan.bySource)) {
    total += b.effective; daily += b.dailyEffective; weekly += b.weekly;
    lines.push(name.padEnd(15) + String(b.count).padStart(5) + String(b.dailyEffective).padStart(6) +
      String(b.weekly).padStart(6) + String(b.limit || '—').padStart(7) +
      (Math.floor(b.seconds / 60) + 'м' + String(b.seconds % 60).padStart(2, '0') + 'с').padStart(12) +
      '   ' + Object.entries(b.phases).map(([k, v]) => k + ':' + v).join(', '));
  }
  lines.push('');
  lines.push('ЕЖЕДНЕВНО запросов: ' + daily + ' | ПОНЕДЕЛЬНИК дополнительно: ' + weekly + ' | недельный максимум: ' + (daily + weekly));
  for (const [name, b] of Object.entries(plan.bySource)) {
    if (b.limit && b.count > b.limit) lines.push('ВНИМАНИЕ: ' + name + ' — план ' + b.count + ' > лимита ' + b.limit + ' (будет урезан бюджетом)');
  }
  return lines.join('\n');
}

module.exports = { makePlan, formatPlan };

if (require.main === module) console.log(formatPlan(makePlan()));
