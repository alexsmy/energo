/* Избранное в localStorage: организации реестра и закупки по стабильным ID. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnergoFavorites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'energo-favorites-v1';
  const EMPTY = { orgs: [], tenders: [] };
  const store = (typeof localStorage !== 'undefined') ? localStorage : null;

  function load() {
    if (!store) return { ...EMPTY };
    try {
      const raw = JSON.parse(store.getItem(KEY) || 'null');
      const clean = { orgs: [], tenders: [] };
      for (const kind of ['orgs', 'tenders']) {
        if (Array.isArray(raw && raw[kind])) clean[kind] = [...new Set(raw[kind].filter(x => typeof x === 'string' && x))];
      }
      return clean;
    } catch (e) { return { ...EMPTY }; }
  }
  function save(data) {
    if (!store) return data;
    try { store.setItem(KEY, JSON.stringify(data)); } catch (e) { /* приватный режим */ }
    return data;
  }
  function has(kind, id) {
    return load()[kind === 'tender' ? 'tenders' : 'orgs'].includes(String(id || ''));
  }
  function toggle(kind, id) {
    const data = load();
    const key = kind === 'tender' ? 'tenders' : 'orgs';
    const value = String(id || '');
    if (!value) return data;
    const i = data[key].indexOf(value);
    if (i < 0) data[key].unshift(value); else data[key].splice(i, 1);
    return save(data);
  }
  function count() {
    const data = load();
    return data.orgs.length + data.tenders.length;
  }
  function exportJSON() {
    return JSON.stringify({ format: 'energo-favorites', version: 1, savedAt: new Date().toISOString(), ...load() }, null, 2);
  }
  function importJSON(text) {
    const raw = JSON.parse(String(text || ''));
    if (!raw || raw.format !== 'energo-favorites') throw new Error('Не тот формат файла');
    const data = { orgs: [], tenders: [] };
    for (const kind of ['orgs', 'tenders']) {
      if (Array.isArray(raw[kind])) data[kind] = [...new Set(raw[kind].filter(x => typeof x === 'string' && x))];
    }
    return save(data);
  }
  return { load, save, has, toggle, count, exportJSON, importJSON, KEY };
});
