#!/usr/bin/env node
/* Накопленное состояние обхода по ИНН организаций реестра.
 * Хранится в data/tender-inn-state.json (в git), маленькое. Позволяет:
 *  - не задавать один и тот же вопрос повторно без изменений (total/lastPublished);
 *  - считать инкрементальное окно архива вместо 30 дней каждый раз;
 *  - видеть, какие ИНН давно не опрашивались.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'tender-inn-state.json');

function load() {
  try { const s = JSON.parse(fs.readFileSync(FILE, 'utf8')); return s && s.items ? s : { items: {} }; }
  catch (e) { return { items: {} }; }
}
function save(state) { fs.writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n', 'utf8'); }
function entry(state, inn) {
  return state.items[inn] || (state.items[inn] = { queries: 0, lastOk: '', lastArchive: '', total: null, lastPublished: '', emptyStreak: 0 });
}

/* Дата, с которой просим архив: последний успешный прогон минус overlap.
 * overlap страхует от задержки публикации данных в агрегаторах. */
function incrementalFrom(lastRun, overlapDays) {
  if (!lastRun) return '';
  const overlap = Math.max(0, parseInt(overlapDays, 10) || 0);
  const d = new Date(lastRun);
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - overlap);
  return d.toISOString().slice(0, 10);
}

module.exports = { FILE, load, save, entry, incrementalFrom };
