#!/usr/bin/env node
/* Проверки клиентского сбора посещений: только продакшн-домен, без секретов в репозитории. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'js', 'visits.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'visits-config.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}

test('трекер подключён только на главной странице', () => {
  assert.match(html, /<script src="js\/visits\.js\?v=/);
  assert.match(js, /alexsmy\.github\.io\/energo\/index\.html/);
});

test('локальные и тестовые заходы не отправляются', () => {
  assert.match(js, /if \(!PROD\) return/);
  assert.match(js, /^  var PROD =/m);
});

test('endpoint один — WordPress на nppuast.com, из конфига', () => {
  assert.equal(cfg.endpoint, 'https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit');
  assert.equal(cfg.githubDispatch, undefined, 'GitHub-канал должен быть удалён');
  const all = JSON.stringify(cfg);
  assert.ok(!/workers\.dev|bot-29-nx0w|api\.github\.com/.test(all), 'в конфиге остались старые каналы');
  assert.match(js, /data\/visits-config\.json/);
  assert.match(js, /c\.endpoint/);
  assert.ok(!js.includes('visitsToken'), 'токен в localStorage удалён');
  assert.ok(!/repository_dispatch|client_payload/.test(js), 'GitHub dispatch удалён');
  assert.equal(cfg.timeoutMs, 5000);
});

test('если канал висит, есть таймаут, чанкование, backoff и outbox', () => {
  assert.match(js, /AbortController/);
  assert.match(js, /timeoutMs/);
  assert.match(js, /MAX_CHUNK_BYTES = 32 \* 1024/);
  assert.match(js, /function chunk\(/);
  assert.match(js, /retryDelay = Math\.min\(60000, retryDelay \* 2\)/);
  assert.match(js, /energo-visit-outbox/);
  assert.match(js, /visitsEndpoint/);
  assert.match(js, /flushing = true/);
  assert.match(js, /flushAgain/);
  assert.ok(!js.includes('endpointIndex'), 'переключение каналов удалено');
});

test('каждое событие имеет стабильный event_id для дедупликации на сервере', () => {
  assert.match(js, /ev\.eid = uuid\(\)/);
  assert.match(js, /ev\.eid/);
});

test('в клиентском коде нет токенов Telegram и GitHub', () => {
  assert.ok(!/TELEGRAM_BOT_TOKEN|bot[0-9]{6,}:|ghp_|github_pat_/i.test(js), 'найден секрет в js/visits.js');
  assert.ok(!/TELEGRAM_BOT_TOKEN|bot[0-9]{6,}:|ghp_|github_pat_/i.test(JSON.stringify(cfg)), 'найден секрет в конфиге');
});

test('собираются все нужные группы событий', () => {
  for (const type of ['session', 'tab', 'click', 'search', 'link']) {
    assert.ok(js.includes("push('" + type + "'"), 'нет события ' + type);
  }
  assert.match(js, /browserOf|osOf|deviceOf/);
  assert.match(js, /navigator\.connection/);
  assert.ok(!js.includes('IntersectionObserver'), 'просмотр мини-карточек не должен быть событием');
  assert.match(js, /kind: 'org_card'/, 'нет клика по карточке организации');
  assert.match(js, /kind: 'tender_card'/, 'нет клика по карточке закупки');
  assert.match(js, /data-kw/);
  assert.match(js, /sendBeacon/);
  assert.match(js, /seenPct/);
  assert.match(js, /push\('link'/, 'нет учёта кликов по ссылкам/скачиваниям');
  assert.match(js, /utm_source/, 'нет UTM-полей');
  assert.match(js, /hasInteracted/);
  assert.match(js, /isHeadless/);
});

if (!process.exitCode) console.log('\nПроверки логирования посещений пройдены: ' + passed);
