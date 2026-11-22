/* Единая типизация турбин и энергооборудования: Node (тесты) и браузер.
 * Коды хранятся в entities.tsv / plants.tsv в поле tech через ';'.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnergoTech = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TYPES = [
    { code: 'steam',     label: 'паровые',           family: 'thermal',   order: 10 },
    { code: 'gas',       label: 'газовые',           family: 'thermal',   order: 20 },
    { code: 'nuclear',   label: 'атомные',           family: 'thermal',   order: 30 },
    { code: 'hydro',     label: 'гидравлические',    family: 'renewable', order: 40 },
    { code: 'wind',      label: 'ветро',             family: 'renewable', order: 50 },
    { code: 'aviation',  label: 'авиа/вертолёты',    family: 'transport', order: 60 },
    { code: 'marine',    label: 'судовые',           family: 'transport', order: 70 },
    { code: 'gear',      label: 'редукторы',         family: 'transport', order: 80 },
    { code: 'generator', label: 'генераторы',        family: 'equipment', order: 90 },
    { code: 'boiler',    label: 'котлы/теплообмен',  family: 'equipment', order: 100 }
  ];

  const BY_CODE = Object.fromEntries(TYPES.map(t => [t.code, t]));
  const FAMILIES = { thermal: 0, renewable: 1, transport: 2, equipment: 3, other: 4 };

  function parse(value) {
    return String(value || '').split(';').map(s => s.trim()).filter(c => BY_CODE[c]);
  }
  function labels(value) {
    return parse(value).map(c => BY_CODE[c].label);
  }
  function primary(value) {
    return parse(value)[0] || '';
  }
  function familyOf(value) {
    const p = primary(value);
    return p ? BY_CODE[p].family : 'other';
  }
  function rank(value) {
    const p = primary(value);
    if (!p) return 99999;
    return FAMILIES[BY_CODE[p].family] * 1000 + BY_CODE[p].order;
  }
  // Сравнение для сортировки «по типу турбин»: family → порядок типа → название.
  function compare(a, b) {
    const ra = rank(a.tech), rb = rank(b.tech);
    if (ra !== rb) return ra - rb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  }

  return { TYPES, BY_CODE, FAMILIES, parse, labels, primary, familyOf, rank, compare };
});
