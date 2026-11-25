#!/usr/bin/env node
/* Регрессионные проверки читаемости интерфейса ( цвет текста / фон ).
 * Отлавливает типичную ошибку: белый текст в тёмной зоне + белый фон
 * нативного списка option => нечитаемые строки. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const compact = css.replace(/\s+/g, ' ');
let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

/* Относительная яркость и контраст по WCAG 2.x. */
function lum(hex) {
  const m = String(hex).match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, 'ожидался hex-цвет, получено: ' + hex);
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('у option/optgroup явно заданы тёмный текст и светлый фон', () => {
  const rule = compact.match(/select option\s*,\s*select optgroup\s*\{([^}]*)\}/);
  assert.ok(rule, 'нет правила `select option, select optgroup`');
  assert.match(rule[1], /color:\s*var\(--ink\)/, 'у option нет тёмного цвета текста');
  assert.match(rule[1], /background:\s*#fff/, 'у option нет светлого фона');
});

test('в тёмных зонах option не красится в белый', () => {
  const bad = compact.match(/option[^{]*\{[^}]*color:\s*(#fff|#ffffff|white)/gi);
  assert.equal(bad, null, 'найдено правило с белым текстом option: ' + (bad && bad[0]));
});

test('нативные календари и списки используют светлую цветовую схему', () => {
  assert.match(compact, /select\s*,\s*input\[type="date"\]\s*\{\s*color-scheme:\s*light/);
});

test('поля «Прямой поиск на площадке» имеют тёмный текст на светлом фоне', () => {
  const select = compact.match(/\.t-deep__row select\s*\{([^}]*)\}/);
  const input = compact.match(/\.t-deep__row input\s*\{([^}]*)\}/);
  assert.ok(select && input, 'нет правил для .t-deep__row select/input');
  assert.match(select[1], /color:\s*var\(--ink\)/, 'select унаследует белый текст от тёмной панели');
  assert.match(input[1], /color:\s*var\(--ink\)/, 'input унаследует белый текст от тёмной панели');
});

/* Основные пары «текст / фон», которые должны читаться в обоих режимах. */
const pairs = [
  ['основная кнопка / активный чип (верх градиента)', '#ffffff', '#22789c'],
  ['активный чип (низ градиента)', '#ffffff', '#15587a'],
  ['бейдж «Новое»', '#ffffff', '#147a49'],
  ['обычное поле ввода', '#12303f', '#ffffff'],
  ['бейдж источника', '#1b5b7b', '#e8f1f7'],
  ['подсвеченное совпадение', '#7a3d00', '#fff4e2'],
  ['базовое слово в светлых фильтрах', '#1b5b7b', '#eef7f9'],
  ['составной запрос в светлых фильтрах', '#7a3d00', '#fff6e8']
];
test('контраст основных пар «текст / фон» не ниже 4.5:1', () => {
  for (const [name, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, name + ': ' + ratio.toFixed(2) + ':1');
  }
});

test('активные элементы тёмной панели не используют слишком светлый верх', () => {
  // #2b93ad давал 3.57:1 — теперь заменён на #22789c (4.96:1).
  assert.ok(!compact.includes('#2b93ad'), 'найден старый светлый градиент #2b93ad');
});

if (!process.exitCode) console.log('\nПроверки темы пройдены: ' + passed);
