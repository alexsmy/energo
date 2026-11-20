/* Энергореестр РФ — общая логика текстового поиска.
 * Работает и в браузере (window.EnergoTextMatch), и в Node (module.exports).
 * Учитывает русские словоформы: турбина / турбины / турбине / турбин / турбиной.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnergoTextMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* Лёгкий стеммер для русских существительных/прилагательных.
   * Задача — не морфология целиком, а устойчивое совпадение словоформ
   * в названиях закупок: турбина/турбины/турбине/турбиной/турбинная. */
  const ENDINGS = [
    'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
    'ией', 'иям', 'ием', 'иях', 'ых', 'их', 'ым', 'им', 'ую', 'юю',
    'ия', 'ью', 'ья', 'ие', 'ье', 'ей', 'ой', 'ый', 'ий', 'ая', 'яя',
    'ое', 'ее', 'ые', 'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем',
    'ка', 'ки', 'ке', 'ку', 'ок', 'ек', 'ец', 'ы', 'и', 'а', 'я', 'о',
    'е', 'у', 'ю', 'ь'
  ].sort((a, b) => b.length - a.length);

  function stemRu(word) {
    let w = norm(word).replace(/\s+/g, '');
    if (!w || w.length < 4 || !/[а-я]/.test(w)) return w;
    for (const end of ENDINGS) {
      if (w.length - end.length >= 4 && w.endsWith(end)) return w.slice(0, -end.length);
    }
    return w;
  }

  function stems(text) {
    return norm(text).split(' ').filter(Boolean).map(stemRu).filter((s) => s.length >= 3);
  }

  /* Составные слова: гидроуплотнение, газотурбинный, котлотурбинный.
   * Без этого после склейки разбитого заголовка закупка теряет ключевое слово. */
  const COMPOUND_PREFIXES = [
    'газо', 'гидро', 'турбо', 'котло', 'тепло', 'электро', 'паро', 'водо',
    'нефте', 'угле', 'авто', 'моно', 'мульти', 'сверх', 'меж', 'поли'
  ];

  /* Сравнение основ: допускаем разницу в 1–2 буквы на конце,
   * чтобы «лопат» и «лопатк», «турбин» и «турбинн» считались одним словом. */
  function sameStem(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const min = 4;
    if (a.length < min || b.length < min) return false;
    if (a.startsWith(b) || b.startsWith(a)) return Math.abs(a.length - b.length) <= 2;
    const longer = a.length >= b.length ? a : b;
    const shorter = longer === a ? b : a;
    for (const p of COMPOUND_PREFIXES) {
      if (!longer.startsWith(p)) continue;
      const rest = longer.slice(p.length);
      if (rest === shorter) return true;
      if (rest.startsWith(shorter) || shorter.startsWith(rest)) {
        if (Math.abs(rest.length - shorter.length) <= 2) return true;
      }
    }
    return false;
  }

  function keywordStems(keyword) {
    return stems(keyword);
  }

  /* Совпадает ли ключевое слово с текстом (учитывая словоформы).
   * Для фразы требуются все значимые слова. */
  function matchesKeyword(text, keyword) {
    const kw = keywordStems(keyword);
    if (!kw.length) return false;
    const ts = stems(text);
    return kw.every((k) => ts.some((t) => sameStem(k, t)));
  }

  function matchKeywords(text, keywords) {
    return (keywords || []).filter((k) => matchesKeyword(text, k));
  }

  function tokenizeQuery(q) {
    return norm(q).split(' ').filter((t) => t.length >= 2);
  }

  /* Поиск по свободному запросу: каждое слово запроса должно найтись
   * либо в названии/ключевых словах, либо в заказчике/предприятии. */
  function queryMatches(query, title, keywords, customer, orgNames) {
    const tokens = tokenizeQuery(query);
    if (!tokens.length) return true;
    const titleStems = stems([title, ...(keywords || [])].join(' '));
    const orgStems = stems([customer, ...(orgNames || [])].join(' '));
    return tokens.every((tok) => {
      const s = stemRu(tok);
      return titleStems.some((x) => sameStem(s, x)) || orgStems.some((x) => sameStem(s, x));
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* Ключевое слово может быть строкой («турбина») или объектом:
   * { label, search, must: [[синоним, ...], ...] }.
   * search — что отправляем в API, must — что обязано найтись в названии. */
  function entryOf(k) {
    if (k && typeof k === 'object') {
      const search = String(k.search || k.label || '').trim();
      const must = Array.isArray(k.must) && k.must.length
        ? k.must.map((g) => (Array.isArray(g) ? g : [g])).map((g) => g.filter(Boolean))
        : [[search]];
      return { label: String(k.label || search), search, must: must.filter((g) => g.length) };
    }
    const s = String(k || '').trim();
    return { label: s, search: s, must: s ? [[s]] : [] };
  }

  /* Все группы должны совпасть (И), внутри группы достаточно одного синонима (ИЛИ). */
  function matchesEntry(text, entry) {
    const e = entryOf(entry);
    if (!e.must.length) return false;
    return e.must.every((group) => group.some((syn) => matchesKeyword(text, syn)));
  }

  function matchEntries(text, entries) {
    return (entries || []).map(entryOf).filter((e) => matchesEntry(text, e));
  }

  /* Подсветка только слов ключевой фразы в названии. Заказчика не трогаем. */
  function highlightEntryHtml(raw, entries, esc) {
    const escape = esc || escapeHtml;
    const text = String(raw == null ? '' : raw);
    const list = (entries || []).map(entryOf).filter((e) => matchesEntry(text, e));
    if (!list.length) return escape(text);
    const targets = [];
    list.forEach((e) => e.must.forEach((g) => g.forEach((s) => keywordStems(s).forEach((st) => targets.push(st)))));
    if (!targets.length) return escape(text);
    const parts = text.split(/(\s+|[^\wа-яёА-ЯЁ0-9]+)/u);
    return parts.map((part) => {
      if (!part || /^\s+$/.test(part) || !/[a-zа-яё0-9]/i.test(part)) return escape(part);
      const st = stemRu(part);
      const hit = targets.some((t) => sameStem(st, t));
      return hit ? '<mark>' + escape(part) + '</mark>' : escape(part);
    }).join('');
  }

  /* Старое имя оставлено для совместимости. */
  function highlightHtml(raw, keywords, esc) {
    return highlightEntryHtml(raw, keywords, esc);
  }

  return {
    norm, stemRu, stems, sameStem, keywordStems, matchesKeyword,
    matchKeywords, tokenizeQuery, queryMatches, highlightHtml, escapeHtml,
    entryOf, matchesEntry, matchEntries, highlightEntryHtml
  };
});
