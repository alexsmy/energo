#!/usr/bin/env node
/* Подробный журнал сбора: что, откуда, когда, успешно/нет. */
'use strict';
const fs = require('fs');
const path = require('path');
const { maskPhone } = require('./mask-phones');

const FILE = path.join(__dirname, '..', '..', 'data', 'collect-log.json');
const KEEP_RUNS = 30;

class CollectLogger {
  constructor(mode) {
    this.run = { started: new Date().toISOString(), mode: mode || 'manual', entries: [], summary: {} };
  }

  entry(source, query, info) {
    const e = Object.assign({
      ts: new Date().toISOString(), source, query
    }, info || {});
    // Счётчик запросов источника на текущий прогон (использовано/лимит).
    if (this.budgetState && !e.budget) e.budget = this.budgetState(source) || '';
    this.run.entries.push(e);
  }

  finish(summary) {
    this.run.finished = new Date().toISOString();
    this.run.summary = summary || {};
    let all = [];
    try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(all)) all = []; } catch (e) { /* noop */ }
    all.unshift(this.run);
    fs.writeFileSync(FILE, maskPhone(JSON.stringify(all.slice(0, KEEP_RUNS), null, 2)) + '\n', 'utf8');
    return this.run;
  }
}

/* Сведения об одном сетевом запросе для журнала. */
function requestInfo(res, url, startedAt, extra) {
  const body = res && res.body;
  const bytes = body
    ? Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
    : 0;
  return Object.assign({
    ok: !!(res && res.ok),
    http: (res && res.status) || 0,
    ms: startedAt ? Date.now() - startedAt : undefined,
    bytes,
    url: url || '',
    error: (res && res.error) || ''
  }, extra || {});
}

module.exports = { CollectLogger, FILE, requestInfo };
