#!/usr/bin/env node
/* Календарь сбора: день в Москве и гейт нерабочих дней.
 * cron 03:00 UTC = 06:00 МСК — календарный день совпадает, но проверка
 * всё равно делается через Intl, чтобы не завидеть от TZ хоста.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HOLIDAYS = path.join(__dirname, '..', '..', 'data', 'holidays-2026.json');

function mskDate(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function nonWorking(now) {
  const day = mskDate(now);
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) return { day, reason: 'выходной' };
  let fixed = [];
  try { fixed = (JSON.parse(fs.readFileSync(HOLIDAYS, 'utf8')).fixed) || []; } catch (e) { /* noop */ }
  if (fixed.includes(day.slice(5))) return { day, reason: 'праздник' };
  return { day, reason: '' };
}

module.exports = { mskDate, nonWorking };
