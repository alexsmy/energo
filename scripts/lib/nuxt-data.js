#!/usr/bin/env node
/* Декодер Nuxt 3 / devalue payload (window.__NUXT_DATA__).
 * Нужен для площадок на Nuxt (например, ЭТП ГПБ), где данные приходят
 * не отдельным API, а в JSON-снимке страницы. */
'use strict';

const SPECIAL = new Set([
  'ShallowReactive', 'Reactive', 'ShallowRef', 'Ref', 'Set', 'Map',
  'Date', 'RegExp', 'BigInt', 'null', 'undefined'
]);

function decode(data) {
  const arr = Array.isArray(data) ? data : [];
  const cache = new Map();
  const resolving = new Set();

  function resolve(index, depth) {
    if (depth > 100) return null;
    if (cache.has(index)) return cache.get(index);
    if (resolving.has(index)) return null;
    const v = arr[index];
    if (v === null || typeof v !== 'object') {
      cache.set(index, v);
      return v;
    }
    resolving.add(index);
    let out;
    if (Array.isArray(v)) {
      const tag = v[0];
      if (typeof tag === 'string' && SPECIAL.has(tag)) {
        if (tag === 'Set') out = new Set(v.slice(1).map((x) => resolve(x, depth + 1)));
        else if (tag === 'Map') {
          out = new Map();
          for (let i = 1; i < v.length; i += 2) out.set(resolve(v[i], depth + 1), resolve(v[i + 1], depth + 1));
        } else if (tag === 'Date') out = new Date(resolve(v[1], depth + 1));
        else if (tag === 'RegExp') out = new RegExp(String(resolve(v[1], depth + 1)), resolve(v[2], depth + 1) || '');
        else if (tag === 'BigInt') out = String(resolve(v[1], depth + 1));
        else if (tag === 'null') out = null;
        else if (tag === 'undefined') out = undefined;
        else out = resolve(v[1], depth + 1);
      } else {
        out = v.map((x) => (typeof x === 'number' ? resolve(x, depth + 1) : x));
      }
    } else {
      out = {};
      for (const k of Object.keys(v)) out[k] = resolve(v[k], depth + 1);
    }
    resolving.delete(index);
    cache.set(index, out);
    return out;
  }

  return resolve(0, 0);
}

function fromHtml(html) {
  const m = String(html || '').match(/id="__NUXT_DATA__">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return decode(JSON.parse(m[1])); } catch (e) { return null; }
}

module.exports = { decode, fromHtml };
