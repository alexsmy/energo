#!/usr/bin/env node
/* Регрессионные проверки единого стиля и ширины вкладки «Закупки».
 * Не дают вернуться тёмным фильтрам, скруглённой шапке и отступам сверху:
 * проверяют разметку, CSS и логику сворачивания без сети и без браузера. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'tenders.js'), 'utf8');
let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(^|\\n)\\s*' + esc + '\\s*\\{([^}]*)\\}', 'm'));
  return m ? m[2] : null;
}

test('блок фильтров закупок свёрнут по умолчанию', () => {
  assert.match(html, /<div class="t-filters" id="tFiltersPanel" hidden>/, 'нет скрытого #tFiltersPanel');
  const panel = html.indexOf('id="tFiltersPanel"');
  for (const id of ['tQ', 'tDateFrom', 'tDateTo', 'tSource', 'tKeywords']) {
    assert.ok(html.indexOf('id="' + id + '"') > panel, id + ' должен быть внутри панели фильтров');
  }
});

test('кнопка «Фильтры» есть в панели инструментов закупок', () => {
  const btn = html.match(/<button[^>]*id="tFilterToggle"[^>]*>/);
  assert.ok(btn, 'нет кнопки #tFilterToggle');
  assert.match(btn[0], /aria-controls="tFiltersPanel"/, 'кнопка не связана с панелью');
  assert.match(btn[0], /aria-expanded="false"/, 'кнопка должна быть закрыта по умолчанию');
  const toolbar = html.indexOf('class="t-toolbar"');
  assert.ok(btn.index > toolbar, 'кнопка должна лежать в .t-toolbar');
  assert.ok(btn.index < html.indexOf('id="tFiltersPanel"'), 'кнопка должна быть выше панели фильтров');
});

test('логика сворачивания фильтров и счётчик активных условий', () => {
  assert.match(js, /filtersOpen:\s*false/, 'нет состояния filtersOpen=false');
  assert.match(js, /function setFiltersOpen\(open\)/, 'нет функции setFiltersOpen');
  assert.match(js, /panel\.hidden\s*=\s*!state\.filtersOpen/, 'панель не скрывается/показывается');
  assert.match(js, /sessionStorage\.setItem\(FILTER_KEY/, 'состояние не сохраняется в сессии');
  assert.match(js, /\$\('tFilterToggle'\)\.addEventListener\('click'/, 'нет обработчика кнопки');
  assert.match(js, /function updateFilterButton\(\)/, 'нет обновления кнопки');
  assert.match(js, /function render\(\)\s*\{\s*updateFilterButton\(\)/, 'счётчик не обновляется при рендере');
});

test('фильтры реестра сворачиваются в кнопку и на десктопе', () => {
  assert.match(rule('.btn--filters') || '', /display:\s*inline-flex/, 'кнопка фильтров скрыта на десктопе');
  assert.match(css, /\.layout\{grid-template-columns:0 minmax\(0,1fr\);gap:0\}/, 'закрытая панель занимает колонку');
  assert.match(css, /body\.filters-open \.layout\{grid-template-columns:242px minmax\(0,1fr\);gap:18px\}/, 'нет раскрытой колонки фильтров');
  const collapsed = css.match(/body:not\(\.filters-open\) \.filters\{([^}]*)\}/);
  assert.ok(collapsed, 'нет правила свёрнутой панели реестра');
  assert.match(collapsed[1], /opacity:\s*0/, 'панель не скрывается');
  assert.match(collapsed[1], /pointer-events:\s*none/, 'скрытая панель ловит клики');
  assert.match(css, /body\.filters-open \.filters__close\{display:grid\}/, 'нет кнопки закрытия на десктопе');
});

test('у липкой панели слов светлый фон', () => {
  const sticky = rule('.t-sticky');
  assert.ok(sticky, 'нет правила .t-sticky');
  assert.match(sticky, /background:\s*rgba\(255,255,255/, 'липкая панель снова тёмная');
  assert.match(sticky, /border-bottom:\s*1px solid var\(--line\)/, 'нет светлой границы');
});

test('фильтры закупок не перекрашиваются в тёмный цвет', () => {
  const rules = css.match(/\.t-band \.(?:t-filters|field|t-chip|t-hint|t-selected)[^{]*\{[^}]*\}/g) || [];
  const bad = rules.filter(r => /#fff|rgba\(255,255,255/.test(r));
  assert.equal(bad.length, 0, 'найдено тёмное переопределение: ' + (bad[0] || ''));
  const hint = rule('.t-filters .t-hint');
  assert.match(hint || '', /color:\s*var\(--muted\)/, 'подсказка не светлого блока');
  const label = rule('.t-filters .t-kw__label');
  assert.match(label || '', /color:\s*var\(--muted\)/, 'подпись групп слов не светлого блока');
});

test('кнопка «Фильтры» видна на всех ширинах', () => {
  assert.match(rule('.t-toolbar .btn--filters') || '', /display:\s*inline-flex/, 'кнопка скрыта CSS');
});

test('полоса закупок идёт на всю ширину без зазора сверху', () => {
  assert.match(rule('.tenders-view') || '', /padding-top:\s*0/, 'есть отступ сверху');
  const band = rule('.t-band');
  assert.match(band || '', /border-radius:\s*0/, 'у шапки закупок скруглённые края');
  const bleed = rule('.tenders-view .t-band');
  assert.match(bleed || '', /margin-left:\s*calc\(-1 \* var\(--wrap-pad\)\)/, 'нет левого выхода за .wrap');
  assert.match(bleed || '', /margin-right:\s*calc\(-1 \* var\(--wrap-pad\)\)/, 'нет правого выхода за .wrap');
});

test('между шапкой и фильтрами нет белого зазора', () => {
  assert.match(rule('.t-band') || '', /padding:18px var\(--wrap-pad\) 12px/, 'у шапки нет нижнего отступа внутри полосы');
  assert.match(rule('.t-band .t-tabs') || '', /margin:14px 0 0/, 'нижний margin вкладок схлопывается наружу');
  assert.match(rule('.t-band .t-toolbar') || '', /margin:0;padding:14px 0 0/, 'toolbar добавляет отступ');
});

test('полоса инструментов реестра идёт на всю ширину без боковых зазоров', () => {
  const bar = rule('.content > .toolbar');
  assert.ok(bar, 'нет правила .content > .toolbar');
  assert.match(bar, /border-radius:\s*0/, 'у полосы реестра скруглённые края');
  assert.match(bar, /margin:\s*0 calc\(-1 \* var\(--wrap-pad\)\) 12px/, 'есть боковые отступы полосы');
  assert.match(bar, /padding:\s*12px var\(--wrap-pad\)/, 'внутренние отступы не следуют за --wrap-pad');
});

test('реестр рисует карточки порциями, а не все сразу', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /limit:\s*80/, 'нет размера порции');
  assert.match(app, /state\.limit = 80/, 'порция не сбрасывается при смене фильтров');
  assert.match(app, /more\.id = 'moreCards'/, 'нет кнопки «Показать ещё»');
  assert.match(app, /list\.slice\(0, state\.limit\)\.forEach/, 'таблица реестра рисует все строки');
  assert.match(css, /\.card\{content-visibility:auto/, 'нет content-visibility для карточек');
});

test('закупки тоже рисуют карточки порциями', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'tenders.js'), 'utf8');
  assert.match(html, /id="tMore"/, 'нет кнопки «Показать ещё» в закупках');
  assert.match(app, /limit:\s*40/, 'нет размера порции закупок');
  assert.match(app, /state\.limit \+= 40/, 'кнопка не увеличивает порцию');
  assert.match(app, /state\.limit = 40/, 'порция не сбрасывается при смене фильтров');
});

test('автообновление даёт 5 секунд, а не 10', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /<b>5<\/b> с/, 'в уведомлении не 5 секунд');
  assert.match(app, /let seconds = 5/, 'счётчик не 5 секунд');
  assert.ok(!app.includes('let seconds = 10'), 'остался старый счётчик на 10 секунд');
});

test('на 360 px кнопка «Фильтры» закупок стоит в первом ряду', () => {
  const narrow = css.match(/@media\(max-width:560px\)\{([\s\S]*?)\n\}/);
  assert.ok(narrow, 'нет медиазапроса ≤560px');
  assert.match(narrow[1], /#tFilterToggle\{grid-row:1;grid-column:1\}/, 'кнопка фильтров не первая');
  assert.match(narrow[1], /#tReset\{grid-row:1;grid-column:2/, 'сброс не рядом с фильтрами');
});

test('на узких экранах кнопки компактные, но остаются касаемыми', () => {
  const narrow = css.match(/@media\(max-width:480px\)\{([\s\S]*?)\n\}/);
  assert.ok(narrow, 'нет медиазапроса для узких экранов');
  assert.match(narrow[1], /\.icon-btn\{width:30px;height:30px/, 'иконки шапки не уменьшены');
  assert.match(narrow[1], /\.seg__btn\{padding:5px 9px;font-size:11\.5px\}/, 'сегменты не уменьшены');
  assert.match(narrow[1], /\.btn,\.btn--sm,\.select--sm\{padding:6px 9px;font-size:12px\}/, 'кнопки и поля не уменьшены');
});

test('компактные плашки не накладываются на крупные', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /heroStats\.getBoundingClientRect\(\)\.bottom/, 'нет проверки ухода крупных плашек');
  assert.match(app, /const compact = heroBottom < h \+ 8/, 'порог появления компактной копии старый');
});

test('горизонтальные отступы заданы одной переменной', () => {
  assert.match(rule('.wrap') || '', /padding:\s*0 var\(--wrap-pad\)/, '.wrap не использует --wrap-pad');
  assert.match(css, /:root\{[^}]*--wrap-pad:22px/, 'нет базового значения --wrap-pad');
  assert.match(css, /@media\(max-width:720px\)\{[^}]*:root\{--wrap-pad:13px\}/, 'нет мобильного значения --wrap-pad');
});

test('липкие чипы не перекрывают шапку при свёрнутых фильтрах', () => {
  assert.match(js, /const collapsed = !panel \|\| panel\.hidden/, 'не определяется свёрнутое состояние');
  assert.match(js, /const anchor = collapsed && band \? band : box/, 'не выбран якорь для липкой панели');
  assert.match(js, /anchor\.getBoundingClientRect\(\)\.bottom < h \+ 12/, 'нет проверки выхода якоря из виду');
});

if (!process.exitCode) console.log('\nПроверки вёрстки и фильтров пройдены: ' + passed);
