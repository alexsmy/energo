#!/usr/bin/env node
/* Архив ежедневных снимков закупок — по образцу cam-ufa.
 *
 * Папка data/archive/ НЕ хранится в git (она большая). Перед каждым деплоем
 * workflow скачивает предыдущую публикацию GitHub Pages и восстанавливает
 * архив оттуда; после сбора добавляет снимок за сегодня и удаляет старые.
 * Так архив живёт в интернете и не зависит от телефона/компьютера.
 *
 *   node scripts/archive.js restore   — восстановить из прошлой публикации
 *   node scripts/archive.js snapshot  — добавить снимок за сегодня
 *   node scripts/archive.js prune     — удалить старые снимки
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARCHIVE = path.join(DATA, 'archive');
const INDEX = path.join(ARCHIVE, 'index.json');
const KEEP_DAYS = 30;
const JQ = '[.artifacts[] | select(.expired == false and .workflow_run.head_branch == "main")] | sort_by(.created_at) | if length > 0 then .[-1].id else "" end';

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function mskDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function run(cmd, args, env, input) {
  return execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...(env || {}) }, ...(input != null ? { input } : {}) });
}

function restore() {
  const token = process.env.GH_TOKEN;
  if (!token) { console.log('archive: GH_TOKEN не задан (локальный запуск) — архив не восстанавливаем'); return; }
  const repo = process.env.GITHUB_REPOSITORY || 'alexsmy/energo';
  let id = '';
  try { id = run('gh', ['api', `repos/${repo}/actions/artifacts?name=github-pages&per_page=100`, '--jq', JQ], { GH_TOKEN: token }).trim(); }
  catch (e) { console.log('archive: не удалось получить артефакты — ' + e.message); return; }
  if (!id) { console.log('archive: прошлой публикации main нет — архив начнётся с этого запуска'); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'energo-pages-'));
  try {
    const zip = tmp + '.zip';
    // Заголовки через --config - (stdin): токен не светится в argv/ps.
    run('curl', ['-sSL', '--fail', '--retry', '3', '--config', '-',
      `https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`, '-o', zip],
    null,
    'header = "Authorization: Bearer ' + token + '"\nheader = "Accept: application/vnd.github+json"\n');
    fs.mkdirSync(tmp, { recursive: true });
    run('unzip', ['-q', zip, '-d', tmp]);
    // upload-pages-artifact может класть сайт в artifact.tar
    const tar = path.join(tmp, 'artifact.tar');
    if (fs.existsSync(tar)) run('tar', ['-xf', tar, '-C', tmp]);
    const prev = [path.join(tmp, 'data', 'archive'), path.join(tmp, 'archive')].find(p => fs.existsSync(p));
    if (prev) {
      fs.rmSync(ARCHIVE, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(ARCHIVE), { recursive: true });
      fs.cpSync(prev, ARCHIVE, { recursive: true });
      const n = fs.readdirSync(ARCHIVE).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;
      console.log('archive: восстановлено снимков — ' + n + ' (артефакт ' + id + ')');
    } else {
      console.log('archive: в прошлой публикации архива не было — начинаем с этого запуска');
    }
  } catch (e) {
    console.log('archive: не удалось восстановить архив — ' + e.message);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tmp + '.zip', { force: true });
  }
}

function snapshot() {
  const status = readJson('tenders-status.json', {});
  const coverage = readJson('tender-coverage.json', {});
  const version = readJson('version.json', {});
  const tenders = readJson('tenders.json', { records: [] });
  const date = mskDay(new Date());
  const file = path.join(ARCHIVE, date + '.json');
  writeJson(file, {
    date,
    updated: status.lastRun || new Date().toISOString(),
    version: version.version || '',
    count: tenders.records.length,
    active: status.active || 0,
    archive: status.archive || 0,
    corroboratedPct: status.corroboratedPct || 0,
    partial: !!status.partial,
    coverage: coverage.inns || {},
    records: tenders.records
  });
  reindex();
  console.log('archive: снимок ' + date + ' (' + tenders.records.length + ' записей)');
}

function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  let removed = 0;
  if (fs.existsSync(ARCHIVE)) {
    for (const f of fs.readdirSync(ARCHIVE)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && m[1] < cutoff) { fs.rmSync(path.join(ARCHIVE, f)); removed++; }
    }
  }
  reindex();
  console.log('archive: удалено старых снимков — ' + removed + ' (храним ' + KEEP_DAYS + ' дней)');
}

function reindex() {
  const snapshots = [];
  if (fs.existsSync(ARCHIVE)) {
    for (const f of fs.readdirSync(ARCHIVE).sort()) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (!m) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), 'utf8')); } catch (e) { /* noop */ }
      snapshots.push({
        date: m[1], file: f, count: meta.count || 0, active: meta.active || 0,
        archive: meta.archive || 0, corroboratedPct: meta.corroboratedPct || 0, partial: !!meta.partial
      });
    }
  }
  writeJson(INDEX, { updated: new Date().toISOString(), keepDays: KEEP_DAYS, snapshots });
}

const cmd = process.argv[2];
if (cmd === 'restore') restore();
else if (cmd === 'snapshot') snapshot();
else if (cmd === 'prune') prune();
else if (cmd === 'reindex') { reindex(); console.log('archive: индекс пересобран'); }
else { console.error('Использование: node scripts/archive.js restore|snapshot|prune|reindex'); process.exitCode = 1; }

module.exports = { restore, snapshot, prune, reindex, ARCHIVE, INDEX };
