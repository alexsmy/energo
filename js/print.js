/* Печатная версия реестра */
(function () {
  'use strict';
  const R = window.REGISTRY || { items: [], etps: [], sources: [], meta: {}, stats: {} };
  const items = R.items;
  const etpMap = Object.fromEntries((R.etps || []).map(e => [e.code, e]));
  const srcMap = Object.fromEntries((R.sources || []).map(s => [s.id, s]));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isRepair = i => i.type === 'ремонт';
  const isOem = i => i.type === 'ОЕМ' || i.type === 'инжиниринг';

  const kv = (label, value) => value ? '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>' : '';
  const link = (u) => u ? '<a href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, '')) + '</a>' : '';
  const tags = (it) => (it.etp || []).map(c => '<span class="tag">' + esc(etpMap[c] ? etpMap[c].name : c) + '</span>').join('');

  function orgBlock(it) {
    const rows = [
      kv('Полное наименование', esc(it.full)),
      kv('Деятельность', esc(it.activity)),
      kv('Регион', esc(it.region)),
      kv('Адрес', esc(it.address)),
      kv('Телефон', esc(it.phone)),
      kv('E-mail', esc(it.email)),
      kv('Сайт', link(it.site)),
      kv('Закупки', link(it.procUrl)),
      kv('ИНН / КПП', [it.inn, it.kpp].filter(Boolean).join(' / ')),
      kv('ОГРН', esc(it.ogrn)),
      kv('Руководитель', esc(it.ceo)),
      kv('Контакт по закупкам', esc(it.contact)),
      kv('Главный инженер', esc(it.chiefEngineer)),
      kv('Главный конструктор', esc(it.chiefDesigner)),
      kv('Ответственный по закупкам', esc(it.procContact)),
      kv('Телефон закупок', esc(it.procPhone)),
      kv('E-mail закупок', esc(it.procEmail)),
      kv('Способ закупки', esc(it.method)),
      kv('ЭТП', tags(it))
    ].filter(Boolean).join('');
    return '<div class="org">' +
      '<div class="org__head"><div class="org__name">' + esc(it.name) + '</div>' +
        '<div><span class="org__type">' + esc(it.type || it.kind) + '</span></div></div>' +
      (it.full && it.full !== it.name ? '<div class="org__full">' + esc(it.full) + '</div>' : '') +
      '<dl class="kv">' + rows + '</dl>' +
      (it.notes ? '<div class="note">' + esc(it.notes) + '</div>' : '') +
    '</div>';
  }

  function plantsTable(list) {
    if (!list.length) return '';
    const rows = list.map(p => {
      const turb = [p.turbines, p.units].filter(Boolean).join(' · ');
      const extra = [p.year ? 'ввод ' + p.year : '', p.repairs].filter(Boolean).join(' · ');
      return '<tr><td>' + esc(p.name) + (extra ? '<div class="plants-detail">' + esc(extra.slice(0, 260)) + '</div>' : '') +
        '</td><td class="c">' + esc(p.type) + '</td><td class="c">' + esc(p.region) + '</td>' +
        '<td class="c">' + (p.capacity ? esc(p.capacity) : '—') + '</td>' +
        '<td>' + esc(turb || '—') + '</td></tr>';
    }).join('');
    return '<table class="plants"><thead><tr><th>Станция / объект</th><th>Тип</th><th>Регион</th><th>МВт</th><th>Турбины / состав мощности</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function holdingSection(h, list, first) {
    const companies = list.filter(x => x.kind !== 'plant' && x.id !== h.id);
    const ownPlants = list.filter(x => x.kind === 'plant' && x.parent === h.id);
    let html = '<h2 class="sec' + (first ? ' sec--first' : '') + '" id="h-' + esc(h.id) + '">' + esc(h.name) + '</h2>' +
      '<div class="path">' + esc([h.region, h.inn ? 'ИНН ' + h.inn : '', (h.etp || []).map(c => etpMap[c] ? etpMap[c].name : c).join(', ')].filter(Boolean).join(' · ')) + '</div>' +
      orgBlock(h);
    if (ownPlants.length) html += plantsTable(ownPlants);
    companies.forEach(c => {
      html += '<h3>' + esc(c.name) + '</h3>';
      if (c.path && c.path !== c.name) html += '<div class="path">' + esc(c.path) + '</div>';
      html += orgBlock(c);
      html += plantsTable(list.filter(x => x.kind === 'plant' && x.parent === c.id));
    });
    return html;
  }

  function build() {
    const gen = items.filter(i => !isRepair(i) && !isOem(i));
    const rep = items.filter(isRepair);
    const oem = items.filter(isOem);
    const holdings = gen.filter(i => i.kind === 'holding').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const s = R.stats || {};

    const kpi = [
      [s.total || items.length, 'записей'],
      [s.holdings || 0, 'холдингов'],
      [s.companies || 0, 'юрлиц'],
      [s.plants || 0, 'станций'],
      [s.repair || 0, 'ремонтных'],
      [s.high || 0, 'проверено']
    ].map(([n, l]) => '<div><b>' + n + '</b><span>' + l + '</span></div>').join('');

    let html = '<section class="cover"><h1>Энергогенерирующие и энергоремонтные предприятия РФ</h1>' +
      '<p class="sub">Проверенный реестр для работы с закупками, подрядчиками и поставщиками оборудования</p>' +
      '<div class="meta"><span>Версия ' + esc(R.meta.version) + '</span><span>Дата: ' + esc(R.meta.date) + '</span><span>Формат: печатная версия / PDF</span></div>' +
      '<div class="kpi">' + kpi + '</div>' +
      '<div class="org" style="background:#f8fafb"><div class="org__name" style="font-size:9.5pt">Методика</div>' +
        '<dl class="kv" style="margin-top:5px">' +
        '<dt>Охват</dt><dd>Холдинги → ДЗО → филиалы → конкретные электростанции; изолированные энергосистемы ДФО, Норильск, Крым, Калининград; ремонтные, сервисные и машиностроительные предприятия.</dd>' +
        '<dt>Проверка</dt><dd>Структура и контакты сверены по официальным сайтам, ЕГРЮЛ/Руспрофиль и отраслевым справочникам. Уровень достоверности указан для каждой записи.</dd>' +
        '<dt>Закупки</dt><dd>Указаны применяемый режим (223-ФЗ / 44-ФЗ / коммерческие процедуры), способы заключения договоров и электронные площадки.</dd>' +
        '<dt>Ограничение</dt><dd>Контакты филиалов и станций, помеченные как «наследуется», относятся к головной организации. Перед договором проверяйте реквизиты в ЕГРЮЛ.</dd>' +
        '</dl></div><div class="cover__foot"><div>Реестр подготовлен по открытым источникам · ноябрь 2026</div><div>Документ не является официальным изданием</div></div></section>';

    html += '<section class="tocpage"><h2 class="sec" style="break-before:auto">Содержание</h2><div class="toc">' +
      holdings.map(h => '<a href="#h-' + esc(h.id) + '">' + esc(h.name) + ' <span class="n">(' + gen.filter(x => x.holdingId === h.id).length + ')</span></a>').join('') +
      '<a href="#repair">Ремонт и сервис <span class="n">(' + rep.length + ')</span></a>' +
      '<a href="#oem">ОЕМ и инжиниринг <span class="n">(' + oem.length + ')</span></a>' +
      '</div></section>';

    html += '<h2 class="sec">I. Генерация</h2>';
    holdings.forEach((h, idx) => {
      const list = gen.filter(x => x.holdingId === h.id);
      html += holdingSection(h, list, idx === 0);
    });

    html += '<h2 class="sec" id="repair">II. Ремонт и сервис</h2>';
    rep.sort((a, b) => a.name.localeCompare(b.name, 'ru')).forEach(it => { html += orgBlock(it); });

    html += '<h2 class="sec" id="oem">III. ОЕМ, инжиниринг и оборудование</h2>';
    oem.sort((a, b) => a.name.localeCompare(b.name, 'ru')).forEach(it => { html += orgBlock(it); });

    html += '<h2 class="sec">IV. Электронные торговые площадки</h2>' +
      '<table class="plants"><thead><tr><th>Площадка</th><th>Оператор</th><th>Применение</th></tr></thead><tbody>' +
      (R.etps || []).map(e => '<tr><td><b>' + esc(e.name) + '</b><br><span style="color:#7b8f9c">' + esc(e.url) + '</span></td><td>' + esc(e.operator) + '</td><td>' + esc(e.note) + '</td></tr>').join('') +
      '</tbody></table>';

    html += '<h2 class="sec">V. Источники</h2><ol style="font-size:8.8pt;color:#45606f">' +
      (R.sources || []).map(s2 => '<li>' + esc(s2.title) + (s2.url ? ' — ' + esc(s2.url) : '') + '</li>').join('') +
      '</ol>';

    html += '<footer class="end">' + esc(R.meta.disclaimer) + '<br>Документ сформирован автоматически из реестра v' + esc(R.meta.version) + ' (' + esc(R.meta.date) + '). Не является официальным изданием.</footer>';

    document.getElementById('doc').innerHTML = html;
  }

  build();
})();
