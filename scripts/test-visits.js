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

test('endpoint берётся из конфига, а не захардкожен', () => {
  assert.equal(cfg.endpoint, 'https://bot-29-nx0w.onrender.com/api/energo/visits', 'должен быть публичный endpoint bot_29');
  assert.match(js, /data\/visits-config\.json/);
  assert.match(js, /c\.endpoint/);
});

test('в клиентском коде нет токенов Telegram и GitHub', () => {
  assert.ok(!/TELEGRAM_BOT_TOKEN|bot[0-9]{6,}:|ghp_|github_pat_/i.test(js), 'найден секрет в js/visits.js');
  assert.ok(!/TELEGRAM_BOT_TOKEN|bot[0-9]{6,}:|ghp_|github_pat_/i.test(JSON.stringify(cfg)), 'найден секрет в конфиге');
});

test('собираются все нужные группы событий', () => {
  for (const type of ['session', 'tab', 'card', 'search']) {
    assert.ok(js.includes("push('" + type + "'"), 'нет события ' + type);
  }
  assert.match(js, /browserOf|osOf|deviceOf/);
  assert.match(js, /navigator\.connection/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /data-kw/);
  assert.match(js, /sendBeacon/);
  assert.match(js, /seenPct/);
  assert.match(js, /push\('link'/, 'нет учёта кликов по ссылкам/скачиваниям');
  assert.match(js, /utm_source/, 'нет UTM-полей');
  assert.match(js, /hasInteracted/);
  assert.match(js, /isHeadless/);
});

if (!process.exitCode) console.log('\nПроверки логирования посещений пройдены: ' + passed);
