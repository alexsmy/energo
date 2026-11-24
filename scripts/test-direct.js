#!/usr/bin/env node
/* Офлайн-тесты прямых адаптеров на сохранённых ответах площадок. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FX = path.join(ROOT, 'prototype', 'fixtures');
const tek = require('./sources/tektorg-direct');
const gpb = require('./sources/etpgpb-direct');
const ros = require('./sources/roseltorg-direct');
const { ThrottledClient } = require('./lib/throttle');
const { makeRecord, dedup } = require('./lib/normalize');
const { buildCustomerIndex } = require('./lib/match-org');

const read = (name) => fs.readFileSync(path.join(FX, name), 'utf8');
let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

(async () => {
  await test('JSON-клиент отправляет POST с телом', async () => {
    const c = new ThrottledClient({ minInterval: 0 });
    const original = global.fetch;
    let seen = null;
    global.fetch = async (url, init) => {
      seen = { url, init };
      return {
        ok: true, status: 200,
        headers: { get: () => null, getSetCookie: () => [] },
        json: async () => ({ ok: 1 }), text: async () => ''
      };
    };
    try {
      const r = await c.postJson('https://example.org/api', { a: 1 });
      assert.equal(r.ok, true);
      assert.equal(seen.init.method, 'POST');
      assert.equal(seen.init.body, '{"a":1}');
    } finally { global.fetch = original; }
  });

  await test('ТЭК-Торг: прямое JSON-тело даёт структурированные строки', () => {
    const rows = tek.parse(JSON.parse(read('tektorg-direct.json')));
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.ok(rows[0].id && rows[0].title && rows[0].organizerName && rows[0].inn);
    assert.ok(rows[0].dates && rows[0].dates.datePublished);
    assert.equal(tek.lawOf(rows[0]), 'commercial');
  });

  await test('ТЭК-Торг: lawOf распознаёт 223/44 по номеру', () => {
    assert.equal(tek.lawOf({ registryNumber: '32616602654' }), '223');
    assert.equal(tek.lawOf({ registryNumber: '0123456789012345678' }), '44');
  });

  await test('ЭТП ГПБ: JSON:API → атрибуты', () => {
    const body = JSON.parse(read('etpgpb-direct.json'));
    const rows = gpb.parse(body);
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.ok(rows[0].attributes && rows[0].attributes.title);
    assert.equal(gpb.totalPages(body), 2);
  });

  await test('Росэлторг: HTML-фрагмент разбирается, мусор помечается', () => {
    const { rows, broken } = ros.parse(read('roseltorg-direct.html'));
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.equal(broken, false);
    assert.ok(rows[0].id && rows[0].title && rows[0].url.includes('/procedure/'));
    const junk = ros.parse('<html><body><p>ANTI-BOT challenge</p></body></html>' + 'x'.repeat(1100));
    assert.equal(junk.broken, true, 'смена разметки не помечена');
  });

  await test('прямые записи дедуплируются со старыми адаптерами', () => {
    const enterprises = require('../data/tender-enterprises.json').items || [];
    const index = buildCustomerIndex(enterprises);
    const org = index[0];
    assert.ok(org, 'в списке предприятий нет ни одной организации');
    const foundAt = '2026-11-24T00:00:00.000Z';
    const row = tek.parse(JSON.parse(read('tektorg-direct.json')))[0];
    const fresh = tek.mapRow(row, org, foundAt);
    assert.ok(fresh, 'mapRow вернул null');
    const old = makeRecord({
      ...fresh, source: 'tektorg', sourceName: 'ТЭК-Торг',
      sources: [{ name: 'tektorg', collected: foundAt }]
    });
    const merged = dedup([old], [fresh], 100);
    assert.equal(merged.length, 1, 'дубль не склеен: ' + merged.length);
    assert.ok(merged[0].sources.length >= 2, 'источники не объединены');
  });

  await test('РАД: JSON indexer разбирается в записи', () => {
    const rad = require('./sources/rad-direct');
    const rows = rad.parse(JSON.parse(read('rad-direct.json')));
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.ok(rows[0].uuid && rows[0].title && rows[0].organizationTitle && rows[0].publicationDate);
    assert.ok(['44', '223', 'commercial'].includes(rad.lawOf(rows[0])));
  });

  await test('Фабрикант: RSC flight разбирает карточки', () => {
    const fab = require('./sources/fabrikant-direct');
    const rows = fab.parse(read('fabrikant-direct.html'));
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.ok(rows[0].id && rows[0].title && rows[0].url.includes('fabrikant.ru'));
    assert.ok(fab.isoDate(rows[0].published).startsWith('20'), 'дата: ' + rows[0].published);
  });

  await test('ЗаказРФ: серверная таблица разбирает строки', () => {
    const zak = require('./sources/zakazrf-direct');
    const rows = zak.parse(read('zakazrf-direct.html'));
    assert.ok(rows.length >= 3, 'строк: ' + rows.length);
    assert.ok(rows[0].id && rows[0].regNumber && rows[0].title && rows[0].customer);
    assert.ok(zak.isoDate('19.11.2026') === '2026-11-19');
  });

  await test('при слиянии приоритет у прямого парсера, не у API', () => {
    const { sourceRank } = require('./lib/platforms');
    const direct = sourceRank({ source: 'tektorg-direct' });
    const gosplan = sourceRank({ source: 'gosplan' });
    const old = sourceRank({ source: 'tektorg' });
    const gen = sourceRank({ source: 'gentender' });
    assert.ok(direct < gosplan, 'прямой источник должен обходить ГосПлан');
    assert.ok(gosplan < old, 'API ЕИС должен обходить старый SSR');
    assert.ok(old < gen, 'SSR должен обходить агрегатор');
  });

  await test('план учитывает новые источники и их бюджеты', () => {
    const { makePlan } = require('./lib/plan');
    const plan = makePlan();
    for (const name of ['tektorg-direct', 'etpgpb-direct', 'roseltorg-direct', 'rad-direct', 'fabrikant-direct', 'zakazrf-direct']) {
      const b = plan.bySource[name];
      assert.ok(b, 'нет источника ' + name);
      assert.ok(b.count > 0, 'план пустой: ' + name);
      assert.ok(b.count <= b.limit, name + ': план ' + b.count + ' > лимита ' + b.limit);
    }
  });

  if (!process.exitCode) console.log('\nВсе тесты прямых адаптеров пройдены: ' + passed);
})();
