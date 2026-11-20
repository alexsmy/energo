#!/usr/bin/env node
/* Регрессионные тесты двух багов: разбитые слова ЕИС и составные слова в поиске.
 *   node prototype/test-regressions.js
 */
'use strict';
const assert = require('assert');
const { repairTitle, splitWordScore } = require('../scripts/lib/normalize');
const tm = require('../js/text-match');
const sort = require('../js/sort');

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

check('сортировка: по структуре сохраняет порядок исходных данных', () => {
  const list = [
    { id: 'c', name: 'Волга', region: 'Москва' },
    { id: 'a', name: 'Атом', region: 'Санкт-Петербург' },
    { id: 'b', name: 'Байкал', region: 'Алтайский край' }
  ];
  assert.deepStrictEqual(sort.sortItems(list, 'path').map(x => x.id), ['c', 'a', 'b']);
  assert.deepStrictEqual(list.map(x => x.id), ['c', 'a', 'b'], 'исходный список не меняется');
});

check('сортировка: по названию — алфавит', () => {
  const list = [
    { id: 'c', name: 'Волга', region: 'Москва' },
    { id: 'a', name: 'Атом', region: 'Санкт-Петербург' },
    { id: 'b', name: 'Байкал', region: 'Алтайский край' }
  ];
  assert.deepStrictEqual(sort.sortItems(list, 'name').map(x => x.id), ['a', 'b', 'c']);
});

check('сортировка: по региону, затем по названию', () => {
  const list = [
    { id: 'c', name: 'Волга', region: 'Москва' },
    { id: 'a', name: 'Атом', region: 'Москва' },
    { id: 'b', name: 'Байкал', region: 'Алтайский край' }
  ];
  assert.deepStrictEqual(sort.sortItems(list, 'region').map(x => x.id), ['b', 'a', 'c']);
});

check('сортировка: по структуре группирует записи холдинга подряд', () => {
  const list = [
    { id: 'h1', name: 'Холдинг 1', holdingName: 'Холдинг 1' },
    { id: 'h2', name: 'Холдинг 2', holdingName: 'Холдинг 2' },
    { id: 'c1', name: 'Компания 1', holdingName: 'Холдинг 1' }
  ];
  assert.deepStrictEqual(sort.sortItems(list, 'path').map(x => x.id), ['h1', 'c1', 'h2']);
  assert.deepStrictEqual(sort.sortItems(list, 'name').map(x => x.id), ['c1', 'h1', 'h2']);
});

check('режим сортировки «по достоверности» убран', () => {
  assert.deepStrictEqual(sort.MODES, ['path', 'name', 'region']);
});

console.log(`Пройдено тестов: ${n}`);
