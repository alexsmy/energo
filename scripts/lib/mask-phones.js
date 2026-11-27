#!/usr/bin/env node
/* Единая маскировка мобильных телефонов: последние 4 цифры → **-**.
 * Используется и CLI, и сборкой, и коллектором: новые данные из любого
 * источника не должны попадать в сайт с полными личными номерами. */
'use strict';
const fs = require('fs');
const path = require('path');

// +7 (906) 572-83-19 / +7 916 992-39-88 / 8 (919) 491-40-35.
// Городские (+7 495/812/…), toll-free 8 800 и ИНН вида 8905000428 не трогаем:
// после «8» обязателен пробел или скобка, а после +7 — код оператора 9xx.
const MOBILE_RE = /(?<!\d)(?<prefix>(?:\+7[\s(]*|8[\s(]+)9\d{2}[)\s-]*\d{3}[\s-]*)(?<a>\d{2})(?<sep>[\s-]?)(?<b>\d{2})(?!\d)/g;

function hasMobile(text) {
  MOBILE_RE.lastIndex = 0;
  return MOBILE_RE.test(String(text || ''));
}

function maskPhone(value) {
  if (typeof value !== 'string' || !hasMobile(value)) return value;
  return value.replace(MOBILE_RE, '$<prefix>**-**');
}

/* Рекурсивная маскировка любых значений (объекты, массивы, строки).
 * Даты и числа оставляем как есть, чтобы не сломать JSON. */
function maskValue(value, depth) {
  const level = depth || 0;
  if (level > 20 || value == null) return value;
  if (typeof value === 'string') return maskPhone(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((x) => maskValue(x, level + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = maskValue(value[key], level + 1);
    return out;
  }
  return value;
}

const TEXT_EXT = /\.(json|tsv|md|txt|js|css|html)$/i;

/* Маскирует все текстовые файлы в data/ (включая research-2026 и архив). */
function maskDataTree(root) {
  let changed = 0;
  if (!fs.existsSync(root)) return changed;
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    let stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (stat.isDirectory()) {
      changed += maskDataTree(full);
    } else if (TEXT_EXT.test(name) && stat.size <= 64 * 1024 * 1024) {
      const before = fs.readFileSync(full, 'utf8');
      const after = maskPhone(before);
      if (after !== before) {
        fs.writeFileSync(full, after);
        changed++;
      }
    }
  }
  return changed;
}

/* Список файлов, которые проверяет --check. */
function checkTargets(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) walk(full);
      else if (TEXT_EXT.test(name) && stat.size <= 64 * 1024 * 1024) out.push(full);
    }
  };
  walk(path.join(root, 'data'));
  for (const f of ['js/data.js', 'js/tenders-data.js']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

module.exports = { MOBILE_RE, hasMobile, maskPhone, maskValue, maskDataTree, checkTargets };
