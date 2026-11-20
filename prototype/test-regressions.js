#!/usr/bin/env node
/* Регрессионные тесты двух багов: разбитые слова ЕИС и составные слова в поиске.
 *   node prototype/test-regressions.js
 */
'use strict';
const assert = require('assert');
const { repairTitle, splitWordScore } = require('../scripts/lib/normalize');
const tm = require('../js/text-match');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('✓ ' + name); };

check('склейка разбитых слов ЕИС', () => {
  const cases = [
    ['МИ №3805/МИ - Гидро уплотнен ия (D27P101180)', 'МИ №3805/МИ - Гидроуплотнения (D27P101180)'],
    ['ремонту газо турбинной установки', 'ремонту газотурбинной установки'],
    ['двух газо турбин ных энергоагрегатов', 'двух газотурбинных энергоагрегатов'],
    ['котло турбинного цеха', 'котлотурбинного цеха'],
    ['Поставка турбин ного масла', 'Поставка турбинного масла']
  ];
  cases.forEach(([before, after]) => {
    assert.strictEqual(repairTitle(before), after, before);
    assert.strictEqual(splitWordScore(before) > 0, true, before);
    assert.strictEqual(splitWordScore(after), 0, after);
  });
});

check('ложные срабатывания склейки отсутствуют', () => {
  [
    'Каскад Вилюйских ГЭС им. Е.Н. Батенчука',
    'филиала "Тепло Территории"',
    'Поставка щебня',
    'Поставка масла турбинного'
  ].forEach((s) => assert.strictEqual(repairTitle(s), s, s));
});

check('составные слова находятся по ключевой фразе', () => {
  const kw = ['турбина', 'уплотнение', 'лопатка'];
  assert.deepStrictEqual(tm.matchKeywords('Гидроуплотнения', kw), ['уплотнение']);
  assert.deepStrictEqual(tm.matchKeywords('газотурбинной установки', kw), ['турбина']);
  assert.deepStrictEqual(tm.matchKeywords('котлотурбинного цеха', kw), ['турбина']);
  assert.deepStrictEqual(tm.matchKeywords('Поставка щебня', kw), []);
});

check('словоформы и составные фразы', () => {
  const phrase = { label: 'Ремонт проточной части турбины', search: 'турбина', must: [['ремонт'], ['проточн'], ['част'], ['турбин']] };
  assert.strictEqual(tm.matchesEntry('Ремонт проточной части газотурбинной установки', phrase), true);
  assert.strictEqual(tm.matchesEntry('Поставка турбинного масла', phrase), false);
});

console.log(`Пройдено тестов: ${n}`);
