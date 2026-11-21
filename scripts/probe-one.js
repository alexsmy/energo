#!/usr/bin/env node
/* Один точечный запрос к указанной площадке — без записи данных и без сбора.
 * Запускается вручную (workflow_dispatch) чтобы проверить доступность из GitHub.
 *
 *   node scripts/probe-one.js --target=tektorg
 */
'use strict';
const { ThrottledClient } = require('./lib/throttle');

const arg = (name, def) => {
  const hit = process.argv.slice(2).find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};
const target = arg('target', 'tektorg');
const q = encodeURIComponent('турбина');

const TARGETS = {
  tektorg: {
    url: 'https://www.tektorg.ru/procedures?name=' + q + '&page=1',
    json: false, browser: true
  },
  gpb: {
    url: 'https://etpgpb.ru/procedures/?search=' + q + '&page=1',
    json: false, browser: true
  },
  roseltorg: {
    url: 'https://www.roseltorg.ru/procedures/search_ajax?query_field=' + q + '&sale=1&status%5B%5D=5&status%5B%5D=0&status%5B%5D=1',
    json: false, browser: true
  },
  eis: {
    url: 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' + q + '&morphology=on&fz44=on&fz223=on&recordsPerPage=_10',
    json: false, browser: true
  },
  gosplan: {
    url: 'https://v2test.gosplan.info/fz223/purchases?object_info=' + q + '&stage=1&limit=1',
    json: true, browser: false
  },
  gentender: {
    url: 'https://gentender.ru/api/tenders/search?q=' + q + '&only_active=1&limit=1',
    json: true, browser: false
  }
};

(async () => {
  const t = TARGETS[target];
  if (!t) { console.error('Неизвестный target. Доступно: ' + Object.keys(TARGETS).join(', ')); process.exitCode = 1; return; }
  const client = new ThrottledClient({ minInterval: 0, timeout: 20000, retries: 1, browser: t.browser });
  const t0 = Date.now();
  const res = t.json ? await client.getJson(t.url) : await client.getText(t.url);
  const bytes = res.body ? Buffer.byteLength(typeof res.body === 'string' ? res.body : JSON.stringify(res.body), 'utf8') : 0;
  const cookies = [...client.cookies.values()].reduce((a, jar) => a + jar.size, 0);
  console.log(JSON.stringify({
    target, url: t.url, ok: !!res.ok, http: res.status || 0, ms: Date.now() - t0,
    bytes, cookies, error: res.error || '', browser: t.browser,
    sample: typeof res.body === 'string' ? res.body.slice(0, 100).replace(/\s+/g, ' ') : ''
  }, null, 2));
  // Недоступность площадки — это результат проверки, а не сбой workflow.
  // Иначе GitHub шлёт «Run failed» письма за ожидаемые fetch failed.
})().catch(e => { console.error('Критическая ошибка:', e); process.exitCode = 1; });
