#!/usr/bin/env node
/* Подробный журнал сбора: что, откуда, когда, успешно/нет. */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'collect-log.json');
const KEEP_RUNS = 30;

class CollectLogger {
  constructor(mode) {
    this.run = { started: new Date().toISOString(), mode: mode || 'manual', entries: [], summary: {} };
  }

  entry(source, query, info) {
    this.run.entries.push(Object.assign({
      ts: new Date().toISOString(), source, query
    }, info || {}));
  }

  finish(summary) {
    this.run.finished = new Date().toISOString();
    this.run.summary = summary || {};
    let all = [];
    try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(all)) all = []; } catch (e) { /* noop */ }
    all.unshift(this.run);
    fs.writeFileSync(FILE, JSON.stringify(all.slice(0, KEEP_RUNS), null, 2) + '\n', 'utf8');
    return this.run;
  }
}

module.exports = { CollectLogger, FILE };
