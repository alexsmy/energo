# AGENTS.md — опорный файл проекта

**Реестр предприятий РФ 2026** (`alexsmy/energo`) — статическое веб-приложение на GitHub Pages:
реестр предприятий (энергетика, машиностроение, авиация, судостроение, ремонт, нефть и газ),
закупки, карта. Сайт: https://alexsmy.github.io/energo/index.html

## Жёсткие правила

- **НЕ создавать корневой `README.md`** — документация намеренно лежит в `docs/`, чтобы не
  показываться на главной странице репозитория. Не «исправлять» это и не переименовывать
  `docs/PROJECT.md` (пользовательская документация) и `docs/QUICKSTART.md` (короткая инструкция).
- Индексирование запрещено: `noindex, nofollow, noarchive, nosnippet, noimageindex` в
  `index.html` и `print.html`, `robots.txt` с `Disallow: /`, `noindex` на демонстрационных
  страницах. В `index.html` — `referrer=strict-origin-when-cross-origin` (нужно тайл-серверам),
  в остальных страницах — `no-referrer`.
- CDN Leaflet зафиксированы по версиям и подключены с SRI (`integrity` + `crossorigin`).
  Внешние шрифты не используются.
- При каждой публикации поднимать версию в `version.json` и кэш-бастер `?v=…` во всех
  подключениях CSS/JS в `index.html` и `print.html`; `node build.js` синхронизирует
  `meta.version` в `js/data.js`. Сейчас версия `2.72.202611271200`, кэш-бастер `?v=2.72`.
- Сетевые git-команды и push — только по явной просьбе; push одной командой. Статус проверять
  локально. Author/committer — служебный адрес GitHub; персональный адрес автора в историю и
  файлы не возвращать.
- Сгенерированные файлы (`js/data.js`, `js/tenders-data.js`, `registry.csv`, `registry.json`,
  `version.json`, `plants.tsv`) вручную не редактировать — изменять источники и запускать
  `node build.js`.

## Текущее состояние (27.11.2026, версия 2.72)

- **626 записей**: 38 холдингов, 258 юрлиц, 330 станций; из юрлиц — 42 ремонтных и 85 ОЕМ
  (остальные — инжиниринг, сервис, нефтетранспорт и смежные типы).
  Достоверность только `high` (626); фильтр, сортировка, столбец и индикатор удалены из UI.
- **546 закупок** в выдаче: действующие по умолчанию, завершённые — отдельный режим с глубиной
  `archiveDepthDays`. Старые записи старше глубины не показываются ни в одном режиме.
- Вкладки: **Реестр / Закупки / Карта**; 6 плашек-фильтров (всего, холдинги, юрлица,
  станции, ремонтные, ОЕМ). Фильтры сворачиваются в кнопку. Карточки и таблица с
  группировкой; на мобильных таблица — карточки. Порционная отрисовка (80/40/80).
- Живой поиск по всем полям карточки с автодополнением; цифровые реквизиты — по цифрам.
  Сортировка общая для карточек и таблицы. Избранное в `localStorage` с экспортом JSON.
- Автообновление: `version.json` проверяется при загрузке, раз в 15 минут и при возврате
  во вкладку; при смене версии плашка с обратным отсчётом **5 с**, состояние фильтров
  сохраняется в `sessionStorage`.
- Экспорт: `registry.csv` (`;`, BOM для Excel), `registry.json`, кнопка в UI.
  Печатная версия — `print.html` → `Энергореестр-РФ-2026.pdf`.
- Статусные заметки вместо активных планов: `PLAN_zakupki.md`, `PLAN_parsing.md`,
  `PLAN_security_fixes.md` (выполненные этапы в них не перечислять).

## Интерфейс и карта

- «Закупки» изолированы от реестра (`app.js` скрывает `.layout`, не трогая карту и фильтры);
  логика — `js/tenders.js`, данные — `js/tenders-data.js`. Единое поле «ключевое слово или
  заказчик» с автодополнением; словоформы и подсветку даёт `js/text-match.js`.
- Карточка закупки: статус, срок, нормализованная цена, кликабельные заказчик/ИНН, причина
  попадания в выборку; подробная модалка с копированием номера и переходом на площадку.
  Переход «закупка ↔ организация» идёт в той же вкладке с плашкой возврата.
- Карта: Leaflet + кластеры, подложки «Карта» (OSM.org → OSM.de → Esri), «Спутник» и
  «Гибрид» (Esri), эмодзи-иконки, 11 кодов оборудования, popup → полная карточка.
  Интерфейс локализован; фильтры открываются кнопкой рядом со счётчиком.
- Модальные окна: тёмная шапка, плашка возврата, копирование реквизитов, подвал из трёх
  кнопок. Escape и клик по фону закрывают модалку и чистят плашку возврата.

## Сбор закупок

- Источники: шесть прямых парсеров (`tektorg-direct`, `etpgpb-direct`, `roseltorg-direct`,
  `rad-direct`, `fabrikant-direct`, `zakazrf-direct`), ГосПлан API (ЕИС 44/223/615),
  GenTender (обход по ИНН), `eis-html` — резерв. Старые SSR — для A/B через `--source=…`.
- `--dry-run` печатает план без сети: **590 запросов/день**, по понедельникам ещё 294,
  недельный максимум 884. Бюджеты — `data/tender-settings.json`, паузы — `throttle.js`.
- Охват: 294 ИНН организаций и 207 предприятий из `data/tender-enterprises.json`;
  keyword-поиск с пагинацией до `total` приоритетнее обхода по ИНН.
- Ключевые слова: 8 базовых и 4 составных в `data/tender-keywords.json`; редактируются
  `node scripts/keywords.js` (флаги `--search=`, `--must=`, `--kind=base|composite`).
  В API уходит опорное слово, фраза проверяется локально (`must`: И между группами,
  ИЛИ внутри группы); сетевые запросы дедуплицируются по `search`.
- Инкремент: `publish_from` от последнего успешного прогона минус `archiveOverlapDays`;
  при `partial: true` окно расширяется. Архивация `active → archive` локальная;
  глубокий архив по ИНН — только по понедельникам (`--deep-archive`).
- Дедупликация: номер ЕИС → «площадка + внешний ID» → название + заказчик + цена + дата.
  Непустые поля уже собранной записи (`prev`) не перезаписываются данными из сети.
- Гейт идемпотентности: `ran`, `date` (МСК) и `attempts`; успешный день закрывается без
  единого сетевого запроса; `partial` не закрывает день, но всего **2 попытки**.
  Расписание `tenders-update.yml`: каждые 15 минут 05:00–15:45 МСК плюс 19:00,
  `workflow_dispatch`; контролёр `ensure-daily.yml` dispatch'ит сбор, если за день его не было.
  Частые окна нужны из-за задержек GitHub cron; пропущенные запуски ничего не стоят.
- Журнал запросов — `data/collect-log.json` (`log.html`): адрес, код, время, размер,
  найдено/взято, фаза, бюджет, ошибка. Состояние — `data/tender-inn-state.json`
  и `data/tender-coverage.json`; при ошибке старые записи не удаляются.
- Архив снимков `data/archive/` не в git (`scripts/archive.js restore|snapshot|prune`,
  `archive.html`); «новое» — сравнением с последним снимком (`isNew`, `firstSeen`).
  Pages разворачивается артефактом через `deploy-pages`.

## Карта файлов

```
index.html             интерфейс: шапка, фильтры, реестр, закупки, карта, модалки
print.html             печатная версия;  log.html  журнал;  archive.html  снимки
css/styles.css         экранные стили;    css/print.css  A4
js/data.js             АВТО: window.REGISTRY (не редактировать)
js/tenders-data.js     АВТО: window.TENDER_DATA (не редактировать)
js/app.js              фильтры, поиск, карточки, таблица, модалка, карта, CSV
js/tenders.js          вкладка «Закупки»: фильтры, карточки, таблица, аудит ЭТП
js/text-match.js       словоформы и составные запросы (Node + браузер)
js/tech-types.js       11 кодов оборудования;  js/sort.js  сортировка и загруппы
js/favorites.js        избранное;  js/log.js  журнал;  js/print.js  печать
js/visits.js           клиент аналитики (только главная страница)
data/entities.tsv      РУЧНОЙ источник organizations, 31 поле, разделитель `|`
data/plants.tsv        АВТО из plants.gen.js;  data/geo.js  координаты
data/plants-detail.json курация: турбины, оборудование, ремонты, год ввода
data/tender-*.json     ключевые слова, предприятия, настройки, состояние, выдача
data/etp-audit.json    аудит 16 ЭТП (поле `browser` приоритетнее http/ms/ok)
data/visits-config.json endpoint аналитики;  data/archive/  снимки (не в git)
scripts/collect-tenders.js оркестратор: источники → нормализация → дедуп → лог
scripts/sources/       gosplan, gentender, eis-html, 6 direct + 3 legacy SSR
scripts/lib/           throttle, normalize, match-org, platforms, plan, logger,
                       inn-state, schedule, mask-phones
scripts/{keywords,keyword-stats,archive,compare-direct,mask-phones}.js  утилиты
scripts/{test-collect,test-direct,test-security,test-visits,test-theme,
         test-ui-layout,validate-entities}.js  офлайн-проверки
scripts/check-release.js, scripts/ci-checks.js  проверки перед сборкой
build.js               сборка JS/CSV/JSON + version.json + валидация
.github/workflows/     tenders-update.yml, ensure-daily.yml, site-deploy.yml,
                       probe.yml
wp-plugin/energo-visits/  плагин WordPress «Energo Visits» 2.2.2
docs/                  PROJECT.md, QUICKSTART.md, VISITOR_ANALYTICS.md,
                       ENERGO_VISITS_PLUGIN.md (README корневой не создавать)
PLAN_zakupki.md, PLAN_parsing.md, PLAN_security_fixes.md  статусные заметки
version.json           манифест версии;  registry.csv/json  выгрузки
```

## Команды

```bash
node build.js                        # пересобрать данные, CSV, JSON, version.json
node scripts/collect-tenders.js      # аудит ЭТП + живой сбор (сеть)
node scripts/collect-tenders.js --dry-run   # точный план запросов без сети
node scripts/collect-tenders.js --refilter --force  # пересопоставление без сети
node scripts/mask-phones.js --check  # проверить маскировку мобильных
npm run test:collect                 # офлайн-тесты оркестратора
npm run test:direct                  # тесты прямых парсеров на фикстурах
node scripts/test-security.js        # регрессии безопасности
node scripts/test-visits.js          # тесты клиента аналитики
npm run validate                     # валидатор entities.tsv
npm run check:release                # строгие проверки релиза без сети
python -m http.server 8765 --bind 127.0.0.1   # http://127.0.0.1:8765/index.html
```

PDF: `chrome --headless=new --no-pdf-header-footer --virtual-time-budget=9000
--print-to-pdf=Энергореестр-РФ-2026.pdf http://127.0.0.1:8765/print.html`

## Формат данных

`entities.tsv`, разделитель `|`, 31 поле:
`id|parent|kind|name|full|type|activity|region|address|phone|email|site|procUrl|inn|kpp|ogrn|ceo|contact|method|etp|capacity|status|conf|sources|notes|chiefEngineer|chiefDesigner|procContact|procPhone|procEmail|tech`

- `kind`: `holding` | `company` | `plant` | `филиал`; `parent` — id родителя, пустые поля
  наследуются в `build.js` (для станций `ceo` не наследуется).
- `etp`: коды через `;` (GPB, TEK, ROS, RAD, B2B, FAB, AST, SBER, RTS, ZAKAZ, KIM, …);
  `conf`: только `high`; `sources`: S1, S3–S6 (код S2 больше не используется), расшифровка в `build.js`.
- `plants.tsv`: `id|parent|name|type|region|capacity|conf|sources|tech`.

## Ключевые решения и причины (по одной строке)

- Фильтры на карте скрыты по умолчанию, чтобы карта занимала всю ширину; кнопка открывает панель.
- Поиск дебаунсится на 130 мс; маркеры обновляются через `setTimeout(…, 0)` (фоновые вкладки),
  за размерами следит `ResizeObserver`. Колонка «Холдинг» — в липкой строке группы; на мобильных
  таблица становится карточками через `data-label`.
- Модальное окно: `min(80vw, 1120px)` на десктопе, полноэкранное на мобильных.
- Основная подложка — OSM.org (русские подписи), запасной OSM.de, Esri — крайний резерв;
  CARTO не использовать (отдаёт «API KEY REQUIRED»).
- Порционная отрисовка и `content-visibility` держат DOM ~4 тыс. элементов вместо ~20 тыс.
- Явные цвета `option` и полей прямого поиска; контраст проверяет `scripts/test-theme.js`.
- Сортировка и mini-заголовки групп едины для карточек и таблицы (`js/sort.js`).
- Свежие JSON закупок перечитываются при открытии вкладки; при ошибке старые данные остаются.
- Неподтверждённые контакты помечаются «не подтверждены»; данные не выдумываются.

## Аналитика

- Один канал: WordPress-плагин **Energo Visits** 2.2.2 на `https://nppuast.com`, код —
  в `wp-plugin/energo-visits/`, спецификация — `docs/ENERGO_VISITS_PLUGIN.md`,
  кратко — `docs/VISITOR_ANALYTICS.md`. Старый контур удалён из репозитория.
- Клиент `js/visits.js` работает только на главной странице сайта; локальные и IP-заходы
  игнорируются. Endpoint берётся из `data/visits-config.json`, секретов в репозитории нет.
- События: `session`, `tab`, `click`, `search`, `link`. Просмотр мини-карточек и скролл
  событиями не являются. Плашка согласия сознательно не используется по решению пользователя.
- `FormData` без предварительного запроса, таймаут 5 с, чанки ≤32 КБ, `eid`,
  очередь исходящих событий, одна активная отправка, задержка с нарастанием до 60 с.
- Статистика — в wp-admin (`manage_options`), без публичной ссылки и без PAT.
- При изменении логики править клиент, плагин, оба документа и оба набора тестов.

## Безопасность и маскировка

- Задержка с нарастанием и ограничение частоты в `throttle.js`; редиректы проверяются
  по схеме и хосту, приватные и link-local адреса запрещены, размер ответа ограничен.
- `safeUrl` / `safeHttpUrl` отсекают `javascript:` и `data:` во всех клиентских модулях;
  `check-release` блокирует опасные схемы URL.
- CSP и антифрейминг (`window.top !== window.self`) в `index.html`; CSV-экспорты
  экранируют формулы; actions в workflow зафиксированы по SHA, токен не попадает в argv.
- GitHub Actions не публикуют `data/research-2026/` и `entities.tsv` на Pages.
- Мобильные телефоны маскируются автоматически: `scripts/lib/mask-phones.js` в коллекторе,
  логере и `build.js`; CLI `node scripts/mask-phones.js` и `--check`.
- Подстрочное совпадение заказчика удалено: организации сопоставляются по ИНН и целым словам.

## Что осталось вручную

- Включить в GitHub галку «Block command line pushes that expose my email».
- Перевыпустить внешний секрет старого контура и удалить его в настройках GitHub.
- Переклонировать сторонние копии репозитория, чтобы убрать старые данные из истории.
- Проверять доступность ЭТП и ссылки (аудит 22.11.2026): у B2B/RTS/AST публичного API нет.
  Часть сайтов отдаёт 403/000 из-за локального TLS-прокси — проверять в обычном браузере.
- ГосПлан отвечает 429 при частых запросах: обход по ИНН делает GenTender. В API уходит
  опорное слово, фраза проверяется локально; 0 записей после смены параметра — смотреть лог.

## GitHub

- Репозиторий `alexsmy/energo`, ветка `main`; GitHub Pages разворачивается артефактом
  из Actions. Push — только по явной просьбе, одной командой.
