# AGENTS.md — опорный файл проекта (для продолжения в новой сессии)

Проект: **Энергореестр РФ 2026** (`alexsmy/energo`) — веб-приложение с реестром
энергогенерирующих и энергоремонтных предприятий России.

## Текущее состояние (на 20.11.2026, версия 2.0)

- **339 записей**: 19 холдингов, 61 юрлицо, 259 станций/объектов.
- **Достоверность**: 330 high / 9 medium / **0 low**. Уровень «низкая» удалён из данных и UI.
- **Автообновление**: `version.json` + проверка раз в 15 минут / при возврате во вкладку;
  при смене версии показывается плашка с обратным отсчётом 15 с, состояние фильтров сохраняется
  в `sessionStorage`.
- Вкладки: «Все», «Генерация», «Ремонт и сервис», «ОЕМ и инжиниринг», «Закупки», «Карта».
- Вкладка «Закупки»: аудит 16 ЭТП + сбор публичных тендеров из ЕИС по ключевым словам и
  предприятиям реестра. По умолчанию — действующие закупки, отдельный режим — завершённые
  с глубиной `archiveDepthDays`. Фильтры по дате/названию/предприятию/источнику, карточки
  и таблица, кнопка «Найти» перечитывает свежие JSON с сервера, прямые ссылки на поиск
  площадок. Текущие слова: `турбины`, `уплотнений`, `лопаток`. Общий список —
  `data/tender-keywords.json` (на сервере, не в браузере), редактируется
  `node scripts/keywords.js add|remove`. Режимы/источники/глубина — `data/tender-settings.json`.
  По умолчанию сбор через бесплатный **ГосПлан API** (JSON, ЕИС 44/223/615, без ключа,
  10 запросов/мин); HTML-парсер ЕИС **не удалён**, работает как резерв. Журнал каждого
  запроса — `data/collect-log.json`, просмотр через `log.html` (ссылка внизу вкладки).
  Сбор раз в сутки в **06:00 МСК** через `.github/workflows/tenders-update.yml`
  (cron `0 3 * * *` + `workflow_dispatch`). План: `PLAN_zakupki.md`.
- Виды: карточки (с группировкой по холдингам) и таблица (липкие шапки групп, адаптив в мобильные карточки).
- Карта: Leaflet + OSM / Esri satellite / hybrid, кластеры, 5 слоёв, эмодзи-иконки по типам,
 popup → полная карточка.
- Печатная версия: `print.html` → `Энергореестр-РФ-2026.pdf` (титул, содержание, разделы, ЭТП, источники).
- Экспорт: `registry.csv` (Excel, `;`, BOM), `registry.json`, кнопка «Экспорт CSV» в UI.
- GitHub: https://github.com/alexsmy/energo · GitHub Pages: https://alexsmy.github.io/energo/index.html

## Карта файлов

```
app/                       # корень репозитория (GitHub Pages serving root)
├── index.html             # интерфейс: шапка, фильтры, карточки/таблица/карта/закупки, модалка
├── log.html               # просмотр журнала сбора закупок
├── PLAN_zakupki.md        # детальный план: источники, failover, лог, тесты
├── print.html             # печатная версия
├── css/
│   ├── styles.css         # экранные стили + вкладка «Закупки» + log.html
│   └── print.css          # A4, page-break между разделами/холдингами
├── js/
│   ├── data.js            # АВТО: window.REGISTRY (не редактировать)
│   ├── tenders-data.js    # АВТО: window.TENDER_DATA (не редактировать)
│   ├── tenders.js         # вкладка «Закупки»: фильтры, карточки, таблица, аудит ЭТП
│   ├── log.js             # рендер data/collect-log.json на log.html
│   ├── app.js             # фильтры, поиск, карточки, таблица, модалка, карта, CSV
│   └── print.js           # генерация печатного HTML
├── data/
│   ├── entities.tsv       # РУЧНОЙ ИСТОЧНИК: 81 организация, 25 полей, разделитель `|`
│   ├── plants.tsv         # АВТО из plants.gen.js: 259 станций
│   ├── plants.gen.js      # генератор станций
│   ├── geo.js             # города, привязка станций, точные координаты
│   ├── tender-keywords.json    # РУЧНОЙ общий список слов для поиска закупок
│   ├── tender-enterprises.json # ручной список предприятий и псевдонимов для поиска
│   ├── tender-settings.json # sourcePriority, active/archive, глубина, лимиты, throttle
│   ├── etp-audit.json     # аудит 16 ЭТП + шаблоны ссылок; http/ms/ok обновляются скриптом
│   ├── tenders.json       # АВТО: собранные объявления
│   ├── tenders-status.json # АВТО: статус последнего сбора
│   └── collect-log.json   # АВТО: журнал запросов (последние 30 запусков)
├── scripts/
│   ├── collect-tenders.js # оркестратор: источники → нормализация → дедуп → лог
│   ├── keywords.js        # add/remove/list для tender-keywords.json
│   ├── sources/
│   │   ├── gosplan.js     # ОСНОВНОЙ: бесплатный JSON API ЕИС (44/223/615)
│   │   └── eis-html.js    # РЕЗЕРВ: старый HTML-парсер ЕИС (НЕ удалён)
│   └── lib/               # throttle, match-org, normalize, logger
├── prototype/             # изолированные тесты API (не участвуют в проде)
├── .github/workflows/
│   └── tenders-update.yml # cron `0 3 * * *` (06:00 МСК) + workflow_dispatch
├── build.js               # сборка data.js + tenders-data.js + CSV + JSON + version.json, валидация
├── registry.csv           # выгрузка для Excel
├── registry.json          # машиночитаемый реестр
├── version.json           # манифест версии для автообновления (генерируется build.js)
├── package.json
├── README.md              # пользовательская документация
├── AGENTS.md              # этот файл
└── Энергореестр-РФ-2026.pdf
```

## Сборка и запуск

```bash
cd app
node build.js                       # пересобрать data.js / tenders-data.js / CSV / JSON
node scripts/collect-tenders.js     # аудит ЭТП + сбор закупок из ЕИС
python -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/index.html
```

PDF:

```bash
chrome --headless=new --no-pdf-header-footer --virtual-time-budget=9000 \
  --print-to-pdf=Энергореестр-РФ-2026.pdf http://127.0.0.1:8765/print.html
```

## Формат данных

`entities.tsv` (25 колонок):
`id|parent|kind|name|full|type|activity|region|address|phone|email|site|procUrl|inn|kpp|ogrn|ceo|contact|method|etp|capacity|status|conf|sources|notes`

- `kind`: `holding` | `company` | `plant` | `филиал`
- `parent`: id родителя; пустые поля наследуются в `build.js` (поле `inherited` есть в данных, но в UI больше не показывается)
- `etp`: коды через `;` (GPB, TEK, ROS, RAD, B2B, FAB, AST, SBER, RTS, ZAKAZ, KIM, PORTAL_ROS, ETP_IRAO, ETP_RUSH, BIDZAAR, EIS)
- `conf`: `high` | `medium` (low не используется)
- `sources`: S1–S6, расшифровка в `build.js`

`plants.tsv`: `id|parent|name|type|region|capacity|conf|sources`

## Важные решения и причины

1. Фильтры на карте скрыты по умолчанию (`body.is-map .layout` становится одноколоночной),
   чтобы карта занимала всю ширину. Кнопка «Фильтры» открывает панель поверх карты.
2. Поиск дебаунсится на 130 мс; обновление маркеров карты отложено через `setTimeout(…, 0)`
   (на `requestAnimationFrame` нельзя полагаться в фоновых вкладках); `ResizeObserver` вместо
   таймеров; маркеры пересоздаются только при изменении видимого набора. Локальные CSS/JS
   подключены с `?v=1.9` для инвалидации кэша на GitHub Pages; при каждой публикации версию
   нужно увеличивать в `index.html` и `print.html`.
3. В таблице removed колонка «Холдинг» — она вынесена в липкую строку группы; на мобильных
   таблица превращается в карточки через `data-label`.
4. Модальное окно на десктопе — `min(80vw, 1120px)`; на мобильных — полноэкранное.
5. Типы станций на карте получили эмодзи-иконки; кластеры — круглые фиксированного размера 38/42 px.
6. Подложки: OSM (`tile.openstreetmap.org`), спутник и гибрид (`server.arcgisonline.com`, Esri).
   CDN Leaflet подключены с SRI (`integrity` + `crossorigin`); внешние Google Fonts удалены —
   шрифт берётся из системного стека (`system-ui`, `Segoe UI`, локальный Inter).
7. «наследуется» убрано из карточек; примечания очищены от неинформативных фраз.
8. ИНН/реквизиты 9 организаций остаются «средними»: O-ORGRES, O-TKZ, O-ZIO, O-AEM,
   O-ZTL, O-ELSIB, R-PROMER, R-ESE, R-IRAO-SERVICE.
9. Автообновление: `version.json` (создаётся `build.js`) проверяется при загрузке, раз в 15 минут
   и при возврате во вкладку. При смене версии снизу справа плавно появляется компактное уведомление
   с иконкой `i`, текстом «Обновление данных, страница будет перезагружена · 10 с» и маленьким
   крестиком (крестик только скрывает уведомление, перезагрузка всё равно происходит через 10 с).
   Общий механизм — `createNotice(kind, icon)` в `app.js`, стили `.notice` — для будущих типов
   уведомлений. Перед перезагрузкой состояние фильтров/вида/вкладки сохраняется и восстанавливается.
10. Безопасность: CDN Leaflet зафиксированы по версиям и защищены SRI; Google Fonts удалены;
   нет трекинга, форм и запросов к GitHub из браузера. Автор коммита — `noreply@users.noreply.github.com`,
   персональный e-mail убран из истории (`git commit --amend --reset-author` + force-push).
11. Индексирование запрещено: `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet,
   noimageindex">` в `index.html` и `print.html`, `referrer=no-referrer`, плюс `robots.txt` с
   `Disallow: /` для всех и основных ботов.
12. Вкладка «Закупки» изолирована от основного реестра: `app.js` в `render()` скрывает `.layout`
    и показывает `#tendersView`, не трогая состояние карты и фильтров. Логика вкладки целиком в
    `js/tenders.js`, данные — в `js/tenders-data.js` (генерируется `build.js` из JSON в `data/`).
    Список слов хранится в `data/tender-keywords.json` и правится скриптом `scripts/keywords.js`,
    а не в браузере (Pages статический). Сбор переведён на бесплатный ГосПлан API по умолчанию
    (`scripts/sources/gosplan.js`), старый HTML-парсер перенесён в `scripts/sources/eis-html.js`
    как резерв и НЕ удалён. Прямой публичный поиск остальных ЭТП недоступен из браузера
    (CORS/авторизация), поэтому для них даются ссылки-шаблоны из `data/etp-audit.json`.
    При ошибке сбора предыдущие записи не удаляются. Каждый запрос логируется в
    `data/collect-log.json` и показывается на `log.html`. Сбор идёт постранично
    (до `maxPages` страниц на запрос), режим `active` отбирает действующие по дедлайну/статусу,
    режим `archive` — завершённые с `publishDateFrom` на `archiveDepthDays`. ЕИС отвечает 429 при
    частых запросах: между страницами пауза `DELAY_MS`, при 429 — повтор и остановка с фиксацией
    в статусе. Кнопка «Найти» во вкладке читает свежие `data/tenders.json` и `tenders-status.json`.
    В выдачу попадают только заказчики, совпадающие с 339 организациями реестра: сверка по
    organizationCode/ИНН и по названию (станции → родительское юрлицо), поэтому медицинские
    и сторонние организации отсекаются. `--refilter` пересопоставляет уже собранные записи без
    сети. В UI автодополнение предприятия строится по всем 339 записям (`TENDER_DATA.allEntities`),
    совпадающие слова подсвечиваются функцией `highlight()` в `js/tenders.js`.

## Что осталось / риски

- Часть официальных сайтов отвечает 403/000 из-за локального TLS-прокси и Anti-DDoS
  (rosenergoatom.ru 418, gazprom/tatenergo/mosenergo 403, gpte/boges/enplus 000).
  Проверять из обычного браузера; при подтверждении обновить `site`/`procUrl` в `entities.tsv`.
- `zakupki.gov.ru` корень отдаёт 404; в данных используется рабочий путь
  `/epz/main/public/home.html`. Локальный прокси Termux дополнительно отдаёт 404 на любые
  query-строки ЕИС, поэтому парсер проверен на сохранённой выдаче (`--fixture`), а живой сбор
  должен выполняться в GitHub Actions; при ответе 404/капче старые данные сохраняются.
- Поиск закупок: B2B-Center (403), РТС-тендер (503), zakupki.rushydro.ru (403), KIM и ЭТП Интер РАО
  (нет ответа) требуют проверки из обычного браузера; шаблоны ссылок в `etp-audit.json` уточнять.
- Ссылки на ЭТП и e-mail нужно периодически перепроверять (срок — 20.11.2026).
- Google AI Mode и Yandex во время правок отдавали капчу/пустоту; поиск через websearch недоступен (402).

## GitHub

- Репозиторий создан: `alexsmy/energo` (main).
- Push выполнять **только по явной просьбе**, одной командой `git push`.
- GitHub Pages включается через API или в настройках репозитория: Source = Deploy from a branch,
  Branch = `main`, folder = `/ (root)`.
- Workflow `.github/workflows/tenders-update.yml` (cron `0 3 * * *` = 06:00 МСК, `workflow_dispatch`)
  запускает `scripts/collect-tenders.js`, `build.js`, обновляет `version.json` до
  `2.0.< timestamp >` и коммитит изменения от `github-actions[bot]`. Цепочку `ticker.yml`
  с 24-минутным sleep не используем: достаточно одного запуска в сутки (и публичный репозиторий
  не ограничен платными минутами Actions). Если cron начнёт пропускать запуски — добавить
  цепочку по образцу cam-ufa.
