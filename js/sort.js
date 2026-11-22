/* Единая сортировка реестра: используется карточками и таблицей.
 * Node (тесты) и браузер подключают один и тот же модуль.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnergoSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const MODES = ['path', 'name', 'region', 'tech'];
  const TECH = (typeof require === 'function') ? require('./tech-types.js') : root.EnergoTech;

  // Ключ mini-заголовка для любого режима сортировки.
  // path   — холдинг, name — первая буква, region — регион, tech — основной тип.
  function groupKey(it, mode) {
    switch (mode) {
      case 'name': {
        const ch = String((it && it.name) || '').trim().charAt(0).toUpperCase();
        if (!ch) return '#';
        if (/[0-9]/.test(ch)) return '0-9';
        return /[А-ЯЁA-Z]/.test(ch) ? ch : '#';
      }
      case 'region':
        return String((it && it.region) || '').trim() || 'Без региона';
      case 'tech': {
        const code = TECH ? TECH.primary(it && it.tech) : '';
        const type = code && TECH.BY_CODE[code];
        return type ? type.label : 'Без типа';
      }
      case 'path':
      default:
        return (it && it.holdingName) || 'Прочее';
    }
  }

  function groupLabel(key, mode) {
    if (mode === 'name') {
      if (key === '0-9') return '0–9';
      if (key === '#') return 'Прочее';
      return key;
    }
    if (mode === 'tech' && key !== 'Без типа') return key.charAt(0).toUpperCase() + key.slice(1);
    return key;
  }

  function groupByHolding(list) {
    const groups = new Map();
    for (const it of list) {
      const key = it.holdingName || it.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const out = [];
    for (const arr of groups.values()) out.push(...arr);
    return out;
  }

  function sortItems(list, mode) {
    const arr = list.slice();
    switch (mode) {
      case 'name':
        arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
        break;
      case 'region':
        arr.sort((a, b) =>
          String(a.region || 'я').localeCompare(String(b.region || 'я'), 'ru') ||
          String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
        break;
      case 'tech':
        arr.sort((a, b) => TECH ? TECH.compare(a, b) : 0);
        break;
      case 'path':
      default:
        // Иерархия как в исходных данных: холдинг → его ДЗО → филиалы → станции.
        // Записи одного холдинга идут подряд, в порядке появления в entities.tsv/plants.tsv.
        return groupByHolding(arr);
    }
    return arr;
  }

  return { sortItems, groupKey, groupLabel, MODES };
});
