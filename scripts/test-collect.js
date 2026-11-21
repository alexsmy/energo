#!/usr/bin/env node
/* Локальные тесты планировщика и гейта — без сети. */
'use strict';
const assert = require('assert');
const { makePlan, formatPlan } = require('./lib/plan');
const { nonWorking, mskDate } = require('./lib/schedule');
const tm = require('../js/text-match');
const { makeRecord, dedup } = require('./lib/normalize');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

test('план ОХВАТЫВАЕТ все 78 ИНН реестра', () => {
  const plan = makePlan();
  assert.equal(plan.inns.length, 78);
  assert.equal(plan.bySource.gentender.count, 192);
  assert.equal(plan.bySource.gentender.weekly, 78);
});

test('плановые запросы основных источников укладываются в лимиты', () => {
  const plan = makePlan();
  for (const name of ['gosplan', 'gentender', 'tektorg', 'etpgpb', 'roseltorg']) {
    const b = plan.bySource[name];
    assert.ok(b, 'нет источника ' + name);
    assert.ok(b.limit > 0, 'нет лимита для ' + name);
    assert.ok(b.count <= b.limit, name + ': ' + b.count + ' > ' + b.limit);
  }
  assert.ok(formatPlan(plan).includes('ЕЖЕДНЕВНО запросов'));
});

test('гейт пропускает выходные и праздники, но не рабочие дни', () => {
  assert.equal(nonWorking(new Date('2026-11-21T10:00:00Z')).reason, 'выходной'); // суббота
  assert.equal(nonWorking(new Date('2026-11-22T10:00:00Z')).reason, 'выходной'); // воскресенье
  assert.equal(nonWorking(new Date('2026-05-01T10:00:00Z')).reason, 'праздник');
  assert.equal(nonWorking(new Date('2026-11-23T10:00:00Z')).reason, ''); // понедельник
  assert.equal(mskDate(new Date('2026-11-21T23:30:00Z')), '2026-11-22');
});

test('предфильтр отсекает нерелевантные заголовки до запроса', () => {
  const terms = ['уплотнение', 'лопатка', 'турбина'];
  assert.ok(tm.matchEntries('Ремонт проточной части турбины', terms).length > 0);
  assert.ok(tm.matchEntries('Замена уплотнений ТВД', terms).length > 0);
  assert.equal(tm.matchEntries('Поставка щебня', terms).length, 0);
});

test('дедупликация объединяет источники без потери записи', () => {
  const base = { title: 'Ремонт турбины', customer: 'ТГК-1', published: '2026-11-20', url: 'https://a' };
  const a = makeRecord({ ...base, id: 'A:1', platformCode: 'EIS', source: 'gosplan', sourceName: 'ГосПлан' });
  const b = makeRecord({ ...base, id: 'B:1', platformCode: 'TEK', source: 'tektorg', sourceName: 'ТЭК-Торг' });
  const merged = dedup([a], [b], 100);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].sources.length >= 2);
});

test('cookie jar запоминает куки только для своего домена', () => {
  const { ThrottledClient } = require('./lib/throttle');
  const c = new ThrottledClient({ browser: true, minInterval: 0 });
  const res = { headers: { getSetCookie: () => ['ipp_uid=abc; Path=/; HttpOnly', 'ipp_key=xyz; Path=/'] } };
  c._storeCookies('https://www.tektorg.ru/procedures', res);
  assert.equal(c._cookieHeader('https://www.tektorg.ru/procedures?page=2'), 'ipp_uid=abc; ipp_key=xyz');
  assert.equal(c._cookieHeader('https://etpgpb.ru/procedures/'), '');
});

if (!process.exitCode) console.log('\nВсе тесты пройдены: ' + passed);
