#!/usr/bin/env node
/* Валидатор ручных данных реестра: ищет артефакты в полях entities.tsv.
 *   node scripts/validate-entities.js            # отчёт в data/entities-validation.json
 *   node scripts/validate-entities.js --strict   # + ненулевой код при ошибках (error)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEADER = 'id|parent|kind|name|full|type|activity|region|address|phone|email|site|procUrl|inn|kpp|ogrn|ceo|contact|method|etp|capacity|status|conf|sources|notes|chiefEngineer|chiefDesigner|procContact|procPhone|procEmail';
const FIELDS = HEADER.split('|');
const ETP_CODES = new Set('GPB TEK ROS RAD B2B FAB AST SBER RTS ZAKAZ KIM PORTAL_ROS ETP_IRAO ETP_RUSH BIDZAAR EIS'.split(' '));
const SOURCE_CODES = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
const ORG_KINDS = new Set(['holding', 'company', 'филиал']);

function parseTSV(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split('|');
  if (head.join('|') !== HEADER) throw new Error('Неожиданный заголовок entities.tsv');
  return lines.map((line, i) => {
    const parts = line.split('|');
    if (parts.length !== FIELDS.length) throw new Error(`Строка ${i + 2}: ${parts.length} полей вместо ${FIELDS.length}`);
    const row = { __line: i + 2 };
    FIELDS.forEach((f, j) => { row[f] = parts[j]; });
    return row;
  });
}

function validateRows(rows) {
  const ids = new Set(rows.map(r => r.id));
  const issues = [];
  const add = (row, field, code, severity, note) => issues.push({
    id: row.id, line: row.__line, field, value: row[field] || '', code, severity, note
  });
  const isUnconfirmed = (v) => /^(не подтверждены|данные отсутствуют|нет данных)$/i.test(String(v || '').trim());

  for (const r of rows) {
    if (!r.id) add(r, 'id', 'id-missing', 'error', 'Пустой id');
    if (!r.name) add(r, 'name', 'name-missing', 'error', 'Путое название');
    if (!['holding', 'company', 'plant', 'филиал'].includes(r.kind)) add(r, 'kind', 'kind-unknown', 'error', 'Неизвестный kind');
    if (r.parent && !ids.has(r.parent)) add(r, 'parent', 'parent-unknown', 'error', 'Родитель не найден');

    const ceo = r.ceo || '';
    if (ceo) {
      if (/закупки|контакт|тел[.:]|@|https?:\/\/|www\./i.test(ceo)) add(r, 'ceo', 'ceo-not-person', 'error', 'В ФИО руководителя попал текст о закупках/контактах');
      if (/[0-9]/.test(ceo)) add(r, 'ceo', 'ceo-has-digits', 'error', 'Цифры в ФИО');
      if (ceo.split(/\s+/).filter(Boolean).length < 2) add(r, 'ceo', 'ceo-not-fio', 'warning', 'Не похоже на ФИО');
      if (ceo.length > 60) add(r, 'ceo', 'ceo-too-long', 'error', 'Слишком длинное ФИО');
    }

    const contact = r.contact || '';
    if (/закупки\s*:/i.test(contact)) add(r, 'contact', 'contact-is-procurement', 'warning', 'Общая информация о закупках в поле контакта — вынести в отдельное поле');
    if (/https?:\/\/|www\./i.test(contact)) add(r, 'contact', 'contact-has-url', 'warning', 'URL в поле контакта');
    if (!contact) add(r, 'contact', 'contact-empty', 'info', 'Контакт не заполнен');

    if (r.phone && !isUnconfirmed(r.phone) && !/^\+?[\d\s()\-]{6,}(,\s*(доб|доп)\.?\s*\d+)?$/i.test(r.phone)) add(r, 'phone', 'phone-format', 'error', 'Некорректный формат телефона');
    if (r.email && !isUnconfirmed(r.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) add(r, 'email', 'email-format', 'error', 'Некорректный формат e-mail');

    for (const field of ['site', 'procUrl']) {
      const v = r[field] || '';
      if (!isUnconfirmed(v) && /не подтвер|отсутств|нет данных|н\/а/i.test(v)) add(r, field, 'site-unconfirmed', 'warning', 'Пометка вместо адреса');
      if (v && !isUnconfirmed(v) && !/^https?:\/\/[^\s]+$/i.test(v)) add(r, field, 'site-format', 'error', 'Некорректный URL');
      if (!v && ORG_KINDS.has(r.kind)) add(r, field, 'site-missing', 'warning', 'Адрес не заполнен у организации');
    }

    for (const field of ['chiefEngineer', 'chiefDesigner', 'procContact']) {
      const v = r[field] || '';
      if (/закупки\s*:|https?:\/\/|@/i.test(v)) add(r, field, 'extra-field-artifact', 'error', 'В поле ФИО/должности попал текст о закупках или URL');
    }

    if (r.inn && !isUnconfirmed(r.inn) && !/^\d{10}(\d{2})?$/.test(r.inn)) add(r, 'inn', 'inn-format', 'error', 'ИНН должен содержать 10 или 12 цифр');
    if (!r.inn && ORG_KINDS.has(r.kind) && r.kind !== 'филиал') add(r, 'inn', 'inn-missing', 'warning', 'ИНН не заполнен');
    if (r.kpp && !/^\d{9}$/.test(r.kpp)) add(r, 'kpp', 'kpp-format', 'error', 'КПП должен содержать 9 цифр');
    if (r.ogrn && !/^\d{13}(\d{2})?$/.test(r.ogrn)) add(r, 'ogrn', 'ogrn-format', 'error', 'ОГРН должен содержать 13 или 15 цифр');
    if (!['high', 'medium'].includes(r.conf)) add(r, 'conf', 'conf-unknown', 'error', 'Недопустимая достоверность');
    if ((r.sources || '').split(';').filter(Boolean).some(c => !SOURCE_CODES.has(c))) add(r, 'sources', 'sources-unknown', 'error', 'Неизвестный код источника');
    if ((r.etp || '').split(';').map(s => s.trim()).filter(Boolean).some(c => !isUnconfirmed(c) && !ETP_CODES.has(c))) add(r, 'etp', 'etp-unknown', 'error', 'Неизвестный код ЭТП');
    if (!r.method && r.kind !== 'plant') add(r, 'method', 'method-missing', 'warning', 'Способ закупки не заполнен');
  }

  const byField = {}, byId = {};
  for (const i of issues) {
    byField[i.field] = (byField[i.field] || 0) + 1;
    byId[i.id] = (byId[i.id] || 0) + 1;
  }
  return { rows: rows.length, issues, byField, byId, ids: Object.keys(byId) };
}

function validateFile(file) {
  return validateRows(parseTSV(file || path.join(ROOT, 'data', 'entities.tsv')));
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const report = validateFile(file);
  const out = path.join(ROOT, 'data', 'entities-validation.json');
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), ...report }, null, 2) + '\n', 'utf8');
  console.log(`Проверено записей: ${report.rows}; замечаний: ${report.issues.length}; организаций с замечаниями: ${report.ids.length}`);
  Object.entries(report.byField).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${f}: ${n}`));
  console.log(`Отчёт: ${out}`);
  if (args.includes('--strict') && report.issues.some(i => i.severity === 'error')) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { parseTSV, validateRows, validateFile, HEADER, FIELDS };
