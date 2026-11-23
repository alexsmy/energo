#!/usr/bin/env node
/* Локальные тесты планировщика и гейта — без сети. */
'use strict';
const assert = require('assert');
const { makePlan, formatPlan } = require('./lib/plan');
const { nonWorking, mskDate } = require('./lib/schedule');
const tm = require('../js/text-match');
const { makeRecord, dedup, phaseOf } = require('./lib/normalize');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

test('план ОХВАТЫВАЕТ все ИНН из списка предприятий', () => {
  const plan = makePlan();
  const { buildCustomerIndex } = require('./lib/match-org');
  const items = require('../data/tender-enterprises.json').items || [];
  const expected = new Set(buildCustomerIndex(items)
    .filter(x => x.inn && x.kind !== 'plant').map(x => x.inn.slice(0, 10))).size;
  assert.equal(plan.inns.length, expected);
  assert.ok(plan.inns.length >= 150, 'слишком мало ИНН после расширения реестра');
  assert.equal(plan.bySource.gentender.weekly, expected);
});

test('плановые запросы учитывают лимиты и помечают превышение', () => {
  const plan = makePlan();
  const text = formatPlan(plan);
  for (const name of ['gosplan', 'gentender', 'tektorg', 'etpgpb', 'roseltorg']) {
    const b = plan.bySource[name];
    assert.ok(b, 'нет источника ' + name);
    assert.ok(b.limit > 0, 'нет лимита для ' + name);
    assert.ok(b.effective <= b.limit, name + ': effective ' + b.effective + ' > ' + b.limit);
    assert.ok(b.count >= b.effective, name + ': effective больше плана');
    if (b.count > b.limit) assert.ok(text.includes('ВНИМАНИЕ: ' + name), 'нет предупреждения о ' + name);
  }
  assert.ok(text.includes('ЕЖЕДНЕВНО запросов'));
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

test('короткий номер ЕИС распознаётся по закону, а не только по длине 15+', () => {
  const { isEisReg, digitsOnly } = require('./lib/normalize');
  assert.equal(isEisReg('32616602654', { law: '223' }), true);
  assert.equal(isEisReg('7700000000', { law: '' }), false); // ИНН не номер закупки
  assert.equal(digitsOnly('+7 (495) 123-45-67'), '74951234567');
});

test('дедуп склеивает ГосПлан и GenTender при разной форме заказчика', () => {
  const { normCustomer, eisUrl } = require('./lib/normalize');
  assert.equal(normCustomer('АКЦИОНЕРНОЕ ОБЩЕСТВО "ГИДРОРЕМОНТ-ВКК"'), normCustomer('АО «Гидроремонт-ВКК»'));
  const base = {
    title: 'Поставка турбинного масла', published: '2026-11-20', deadline: '2026-12-01',
    priceNum: 1000, law: '223', platformCode: 'EIS', platformName: 'ЕИС Закупки'
  };
  const a = makeRecord({
    ...base, id: '32616602654', regNumber: '32616602654', externalId: '32616602654',
    customer: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ГИДРОРЕМОНТ-ВКК"', customerInn: '7700000000',
    source: 'gosplan', sourceName: 'ГосПлан API', url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=32616602654'
  });
  const b = makeRecord({
    ...base, id: '32616602654', regNumber: '', externalId: '32616602654',
    customer: 'АО «Гидроремонт-ВКК»', source: 'gentender', sourceName: 'GenTender',
    url: 'https://zakupki.gov.ru/223/purchase/public/purchase/info/common-info.html?regNumber=32616602654'
  });
  const merged = dedup([a], [b], 100);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].regNumber, '32616602654');
  assert.ok(merged[0].sources.length >= 2);
  assert.ok(merged[0].url.includes('common-info.html'), 'должна остаться прямая ссылка на процедуру');
  assert.equal(eisUrl('32616602654', '223').includes('common-info.html'), true);
});

test('разные лоты одного заказчика не склеиваются по похожему названию', () => {
  const base = { customer: 'АО «Тест»', customerInn: '7700000000', published: '2026-11-20', deadline: '2026-12-01', priceNum: 1000, law: '223' };
  const a = makeRecord({ ...base, id: 'x:1', title: 'Ремонт турбины лот 1', platformCode: 'TEK' });
  const b = makeRecord({ ...base, id: 'x:2', title: 'Ремонт турбины лот 2', platformCode: 'TEK' });
  assert.equal(dedup([a], [b], 100).length, 2);
});

test('фаза закупки пересчитывается по статусу и дедлайну', () => {
  assert.equal(phaseOf({ status: 'Работа комиссии', stage: 1, deadline: '2026-11-19' }), 'archive');
  assert.equal(phaseOf({ status: 'Подача заявок', deadline: '2026-12-20' }), 'active');
  assert.equal(phaseOf({ status: 'Подача заявок', deadline: '2026-11-19' }), 'archive');
  assert.equal(phaseOf({ status: 'Подача заявок', deadline: '' }), 'active');
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
