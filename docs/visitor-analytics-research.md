# Исследование: расширенное логирование посетителей для GitHub Pages (JSON в GitHub + Telegram)

Дата: 25.11.2026. Исполнитель: исследовательский субагент.
Репозиторий проекта: `alexsmy/energo` (Pages: `alexsmy.github.io/energo/index.html`).
**Каталог `enegro-work` не изменялся, сборка и push не выполнялись** — создан только этот отчёт.

## 0. Методика и важные оговорки по сети

- Требовалось загрузить skill `browser` и вызвать `tools.browser.tabs.open(...)`. **В этой сессии skill `browser` недоступен** (`permission.rejected`), а инструмента `browser.tabs` нет в каталоге.tools (проверено через `search("browser")` → 0 результатов). Вместо него использован **`webfetch` с теми же URL** (`https://html.duckduckgo.com/html/?q=...` и `https://api.github.com/...`) — результаты зафиксированы ниже. Это единственное отклонение от инструкции.
- `websearch` в этой сети, как и описано в `AGENTS.md` (п. 55), отдаёт 402 — не использовался.
- **GitHub Search API (`/search/repositories`) через прокси этой сети возвращает испорченные данные** (в поле `description` одного «репозитория» оказался целый HTML профиля `chikitang/A`, а остальные запросы дали 0 результатов). Поэтому все звёзды/лицензии/языки ниже получены **прямыми вызовами `GET /api.github.com/repos/{owner}/{repo}`**, которые работают корректно. DDG HTML работал нормально.
- Звёзды — на 25.11.2026, живые значения. Для малоизвестных репозиториев они малы (0–4) — это сигнал «смотри код, не репутацию», а не ошибка.

### Зафиксированные результаты DDG (первый обязательный вызов)
- `https://html.duckduckgo.com/html/?q=github+pages+visitor+analytics+json+github+actions` → GeeksforGeeks «How To Add Google Analytics To GitHub Pages», cristianpb.github.io/blog/analytics-google, junsu-a.github.io posts/adopt-viewer-analytics-tool-on-blog, Stack Overflow «Log visitors on Github page?» (43880617), docs.github.com «Using custom workflows with GitHub Pages».
- `...q=github+pages+visitor+counter+json+github+actions+commit+hits` → **gjbae1212/hit-counter**, hitcount.dev, hitscounter.dev, Stats4U, dwyl/hits, gist akinsho.
- `...q=cloudflare+worker+pageview+counter+github+api+commit+json+telegram` → **tmclo/view-counter** (CF Workers + KV), gist cvzi (Telegram Bot на Worker), **manzoorwanijk/telegram-bot-api-worker**, mrinalcs.github.io (CF Workers + D1 counter).
- `...q=privacy+friendly+analytics+self+hosted+...` → **plausible/analytics**, ackee (electerious/Ackee), selfhost.directory.
- `...q=github+actions+commit+json+file+telegram+notification+action` → appleboy/telegram-action, RizkyRajitha/github_actions_notify_telegram, gist fragaLY, dev.to-гайды.
- `...q=static+site+analytics+store+data+in+github+...` → **chaoticsponge/analytics_worker** (CF Worker + D1), ianlewis.org «Building APIs with Static Files» (данные в git + Actions), dev.to «Creating a Free Static API using a GitHub Repository».
- `...q=github+visitor+badge+hits+counter+repo+README` → asrvd/visitor-counter-badge, visitorbadge.io, liveflagcounter.com, vinnacodes/visitor-badge.

---

## 1. Таблица найденных репозиториев

Значения `★` — живые, получены прямым API 25.11.2026. «Может писать в GitHub» = есть готовый механизм записи файла/коммита; «Telegram» = встроенная отправка.

| Репозиторий | ★ / лицензия / язык | Подход: где хранит, backend | Пишет в GitHub | Telegram | Что можно взять |
|---|---|---|---|---|---|
| [chaoticsponge/analytics_worker](https://github.com/chaoticsponge/analytics_worker) | 1 / без лицензии / JavaScript | **Cloudflare Worker + D1**; клиентский JS в репо (`SAMPLE_ANALYTICS.js`). Backend — Worker, без БД-сервера | Нет (D1) | Нет | **Главный референс**: готовая схема событий `active_ms`, `scroll_pct`, `device_type/os/browser`, `viewport_class`, `utm_*`, `visitor_id/session_id`, `country` из `request.cf`; уважение DNT/GPC; вайтлист путей; лимит тела 4 КБ; ротация visitor_id; ретенция и `ip = NULL` через `scheduled()`. Почти «наш» трекер — меняется только приёмник (D1 → JSON в GitHub) |
| [tmclo/view-counter](https://github.com/tmclo/view-counter) | 0 / без лицензии / TypeScript | **CF Worker + Workers KV**, ключ `pageviews:<path>`; минимальный счётчик | Нет | Нет | 20-строчный [`src/index.ts`](https://raw.githubusercontent.com/tmclo/view-counter/main/src/index.ts) — основа минимального эндпоинта; идея KV как буфера событий до сброса в GitHub |
| [gr2m/cloudflare-worker-github-app-example](https://github.com/gr2m/cloudflare-worker-github-app-example) | 44 / ISC / JavaScript | CF Worker + **GitHub App** (авторизованные вызовы GitHub API из Worker) | **Да** (через GitHub App/JWT) | Нет | Готовый паттерн аутентификации Worker → GitHub API. Для записи JSON в приватный репо без PAT в браузере |
| [octokit/octokit.js](https://github.com/octokit/octokit.js) | 7881 / MIT / TypeScript | Библиотека, работает в Workers через `fetch` | **Да** (`repos.createOrUpdateFileContents`, Git Data API) | Нет | Каноничный вызов `PUT /repos/{o}/{r}/contents/{path}` с `content` (base64), `message`, `sha`, `branch` |
| [appleboy/telegram-action](https://github.com/appleboy/telegram-action) | 1019 / MIT / Dockerfile | GitHub Action, `to`/`token`/`message`, Markdown | Нет | **Да** | Готовый шаг workflow для ежедневного дайджеста в Telegram; [`action.yml`](https://raw.githubusercontent.com/appleboy/telegram-action/master/action.yml) |
| [manzoorwanijk/telegram-bot-api-worker](https://github.com/manzoorwanijk/telegram-bot-api-worker) | 131 / без лицензии / JavaScript | CF Worker — прокси к Telegram Bot API | Нет | **Да** | `sendMessage` прямо из Worker (без Actions). Альтернатива: [gist cvzi](https://gist.githubusercontent.com/cvzi/19167581a023a2c1c51461aecc15c497/raw) — полный worker с вебхуком |
| [stefanzweifel/git-auto-commit-action](https://github.com/stefanzweifel/git-auto-commit-action) | 2585 / MIT / Shell | GitHub Action: коммит и push изменённых файлов | **Да** | Нет | Самый простой способ «сбросить» собранный JSON в репо раз в час/день |
| [actions/github-script](https://github.com/actions/github-script) | 5065 / MIT / TypeScript | GitHub Action, доступ к REST/GraphQL API из JS | **Да** | Нет | Альтернатива коммиту через API, если нужно readonly-сogenicity PAT или кастомная логика слияния |
| [umami-software/umami](https://github.com/umami-software/umami) | 40341 / MIT / TypeScript | Саморазвёртываемый или облако; Postgres/MySQL, свой сервер | Нет | Нет (есть webhooks) | Богатая модель событий и безкуки-подход; **нельзя использовать напрямую** — нужен сервер и БД, нет записи в GitHub |
| [plausible/analytics](https://github.com/plausible/analytics) | 29935 / AGPL-3.0 / Elixir | Self-hosted: Postgres + ClickHouse | Нет | Нет | Эталон приватности (no cookies), но слишком тяжёлый стек и AGPL |
| [electerious/Ackee](https://github.com/electerious/Ackee) | 4737 / MIT / JavaScript | Node.js + MongoDB | Нет | Нет | Идея обезличивания: не хранить IP и не делать пользователей идентифицируемыми |
| [milesmcc/shynet](https://github.com/milesmcc/shynet) | 3156 / Apache-2.0 / Python | Django + Postgres + Redis | Нет | Нет | Аналитика без cookie и без JS; полезно как идея «не хранить user agent целиком» |
| [arp242/goatcounter](https://github.com/arp242/goatcounter) | 6189 / лицензия GitHub = NOASSERTION / Go | SQLite/Postgres, один бинарник | Нет | Нет | Лёгкая модель событий; экспорт данных, но **нативного «коммита в GitHub» нет** |
| [matomo-org/matomo](https://github.com/matomo-org/matomo) | 22051 / GPL-3.0 / PHP | PHP + MySQL,-full аналитика | Нет | Нет | Только если нужна полноценная панель; для наших целей избыточен |
| [PostHog/posthog](https://github.com/PostHog/posthog) | 41102 / NOASSERTION / Python | Тяжёлый стек: Kafka/ClickHouse/Postgres | Нет | Нет | Session replay — **прямой конфликт с приватностью**; не рекомендуется |
| [gjbae1212/hit-counter](https://github.com/gjbae1212/hit-counter) | 1132 / GPL-3.0 / Go | Внешний сервис-счётчик (Go), хранит счётчики сам; **archived 19.11.2026** | Нет | Нет | Идея анти-абьюза: хеширование части запроса с TTL в локальном кэше; код не использовать (архив, GPL) |
| [dwyl/hits](https://github.com/dwyl/hits) | 451 / GPL-2.0 / Elixir | Общий счётчик хит-ов, свой сервер | Нет | Нет | Архитектура badge-счётчика (shields.io) |
| [asrvd/visitor-counter-badge](https://github.com/asrvd/visitor-counter-badge) | 4 / MIT / JavaScript | API → shields.io badge | Нет | Нет | Формат бейджа, если захотим показывать счётчик на странице |
| [vinnacodes/visitor-badge](https://github.com/vinnacodes/visitor-badge) | 1 / без лицензии / — | Workflow раз в 5 минут обновляет badge | Частично (workflow) | Нет | Идея фонового Actions-агрегатора, но код без лицензии брать нельзя |

**Вывод по таблице:** готового «из коробки» решения, которое одновременно (а) принимает события с GitHub Pages, (б) пишет JSON в GitHub и (в) шлёт в Telegram, **нет**. Есть три отдельные детали, которые собираются в нужную цепочку: `chaoticsponge/analytics_worker` (события) + `gr2m/...`/Octokit (запись в GitHub) + `appleboy/telegram-action` или `manzoorwanijk/...` (уведомления).

---

## 2. Рекомендуемая архитектура для `alexsmy/energo`

### Схема потока

```
Браузер (index.html + js/visits.js)
   │ POST /analytics  (keepalive, credentials:'omit', Origin проверяется)
   ▼
Cloudflare Worker (workers.dev или свой домен)
   ├─ валидация JSON, лимит размера, DNT/GPC, whitelist Origin
   ├─ обогащение: request.cf.{country,region,city,asOrganization,asn,colo}
   ├─ буфер: KV / D1 (ключ по дню), дедуп по event_id
   └─ Telegram: мгновенно для «важных» событий ИЛИ дайджест по cron
   │
   ├─ вариант A (проще): Worker сам пишет JSON в приватный репо через GitHub App API
   └─ вариант B (рекомендую для MVP): actions/visits-sync.yml раз в час/день
        забирает буфер → сливает в data/visits-YYYY-MM.json → коммит → Telegram
   ▼
Файл JSON в GitHub (приватный репо для сырых событий;
в публичном energo — только агрегаты/счётчики в data/visits-summary.json)
```

### Оценка вариантов

| Вариант | Вердикт | Почему |
|---|---|---|
| **Только GitHub Actions** | ❌ непригодно для приёма событий | У Actions нет публичного HTTP-эндпоинта. `workflow_dispatch` требует токен; держать токен в JS браузера = утечка. Actions хорош **только** как плановый агрегатор/committer/нотификатор (роль «→ JSON → Telegram»), но не как «браузер → ?». |
| **Cloudflare Worker (+ KV/D1 + GitHub API)** | ✅ **рекомендую** | Бесплатный слой,global edge, **`request.cf` даёт страну/регион/город/ASN/AS-организацию бесплатно** — ровно поля «IP→country/city/isp» без внешнего GeoIP и без хранения IP. Worker может и в GitHub писать (GitHub App/Octokit), и в Telegram (fetch к Bot API). Единственный минус — нужен аккаунт CF и домен/workers.dev. |
| **Vercel / Netlify Functions** | ⚠️ рабочая альтернатива | Сделают ту же роль, проще DX, но геоданных нет/слабее (Netlify Geo headers есть, Vercel — частично), и это ещё один вендор поверх GitHub. Выбирать, если CF недоступен. |
| **Supabase / Firebase** | ⚠️ избыточно | Дают БД + realtime, но задача — «JSON в GitHub», а не интерактивная панель. Добавляют аккаунт, ключи, схему, auth. Оправдано только если появится живой дашборд. |
| **Внешний SaaS (Plausible / Umami / GoatCounter) + экспорт в GitHub** | ❌ не для наших полей | У них нет нативного коммита JSON в GitHub; экспорт придётся дёргать API из Actions. Плюс кастомные поля (time on tab, scroll %, просмотренные карточки, поисковые запросы) туда не влезют. Двойная зависимость. |

**Итог:** браузер → **Cloudflare Worker** → KV/D1-буфер → **GitHub Actions (или сам Worker)** → JSON в GitHub → **Telegram**. Actions остаётся в роли планового «слива» и дайджеста — это хорошо ложится на уже существующий в проекте паттерн `tenders-update.yml` (частые окна + гейт идемпотентности).

### Критическое замечание про публичность репозитория

`alexsmy/energo` — **публичный**. Любой коммит с сырыми событиями (IP, точные координаты, поисковые фразы, постоянный visitor_id) становится общедоступным **навсегда** (git-история не удаляется при `DELETE` из файла). Поэтому:

- сырые события — в **приватном** репозитории (`energo-visits`), доступном только владельцу;
- в публичном `data/visits-summary.json` — только агрегаты (счётчики по дню/странице, топ стран, топ слов), без IP и без персональных идентификаторов;
- worker держит GitHub App private key / PAT и Telegram token в **Secrets**, никогда в клиентском JS.

---

## 3. Схема данных событий

Основа — схема из `chaoticsponge/analytics_worker` (проверена по исходнику), расширена под наши задачи.

```json
{
  "v": 2,
  "event_id": "5a1e3c18-...",              // UUID, дедуп при повторной отправке
  "visitor_id": "b7f2...",                 // случайный UUID в localStorage, 90 дней, rotates
  "session_id": "a1b2c3d4e5f6a7b8",        // 16..64 hex, сессия
  "ts": "2026-11-25T08:41:12.345Z",        // ISO, время события (серверное — надёжнее)
  "tab": "tenders",                        // reestr | tenders | map | print | log
  "path": "/energo/index.html",            // только вайтлист; иначе "/[unlisted]"
  "active_ms": 42000,                      // время вкладки в фокусе с активностью (не «открыто»)
  "scroll_pct": 78,                        // максимальная глубина просмотра 0..100
  "viewed_cards": ["O-1234", "O-9876"],    // ID карточек/закупок из реестра (не названия)
  "search_terms": ["лопатки", "турбина"], // нормализованные слова; НЕ сырой ввод
  "device": { "type": "desktop", "os": "Windows", "browser": "Chrome",
              "viewport": "large" },       // из UA + Client Hints, грубые категории
  "network": { "asn": 12345, "asn_org": "Rostelecom", "colo": "SVO" },
  "geo": { "country": "RU", "region": "MOS", "city": "Moscow" }, // из request.cf, не от клиента
  "referrer_host": "yandex.ru",           // только hostname из вайтлиста
  "utm": { "source": null, "campaign": null },
  "bot": false,
  "consent": "granted"                     // granted | denied | gpc
}
```

**Поля, которые НЕ следует писать в GitHub:** `CF-Connecting-IP` / `X-Forwarded-For`, полный `User-Agent`, точные `latitude/longitude`, сырые строки поиска (могут содержать ФИО/телефон), постоянные cookie-идентификаторы между сайтами. `ip` допустим только как **солевой хеш** и только в приватном репо с TTL 7 дней (как в `analytics_worker`: `ip = NULL` через 7 дней).

**Почему `active_ms`, а не «time on tab» naive:** клиентский скрипт из referenced репозитория считает время только когда `visibilityState === 'visible'` и была недавняя активность (`idleLimit = 60000`), ограничивает тик 15 с (защита от усыплённых таймеров) и шлёт на `pagehide` + `visibilitychange` + каждые 15 с. Это даёт правдоподобное «время на вкладке» без jQuery/навесных слушателей на весь DOM.

---

## 4. Юридические и приватностные риски

1. **IP = персональные данные** (GDPR Art. 4(1), российский 152-ФЗ). Хранение IP даже в приватном репо требует уведомления/политики; публикация в `alexsmy/energo` — прямое нарушение. Минимизируем: страна/регион/ASN вместо IP; IP-хеш с TTL ≤7 дней и только в приватном репо.
2. **localStorage-идентификатор visit** — это «устройство/идентификатор» по ePrivacy. До согласия его нельзя ставить. Проверять `navigator.globalPrivacyControl === true`, `navigator.doNotTrack === '1'`, `window.doNotTrack === '1'` и не отправлять ничего (это уже делает референсный клиент).
3. **Consent-баннер** — рекомендую лёгкий, без внешних Cookiebot/Usercentrics:
   - плашка внизу: «Сайт собирает анонимную статистику · Подробнее», кнопки **«Принять» / «Отклонить»**; выбор в `localStorage` (`energo-analytics-consent`);
   - до выбора — вообще никаких запросов к Worker; при «Отклонить» — отправлять только обезличенный «счётчик страницы» без visitor_id и без geo, или не отправлять ничего;
   - блок «Подробнее» → короткая страница/модалка с политикой: какие поля, зачем, срок хранения (90 дней), что данные в приватном GitHub, что IP не хранится, контакт владельца.
   - Для 152-ФЗ: отдельное согласие на обработку ПДн не требуется, если данные обезличены (нет IP и постоянного ID) — но **уведомление** о сборе статистики всё равно лучше оставить видимым.
4. **Поисковые запросы** — самая рискованная часть: пользователь может ввести ФИО/телефон. Хранить только нормализованные ключевые слова из нашего же `tender-keywords.json` и/или топ-N частотных слов, не сырой ввод, не autocomplete-историю.
5. **Git-история.** Удаление строки из JSON не удаляет её из коммитов. Публичный репо ⇒ данные нельзя «отозвать». Отсюда приватный репо для сырых событий и агрегаты в публичном.
6. **CORS/фрейд:** Worker обязан проверять `Origin` по вайтлисту (`https://alexsmy.github.io`) и отвечать `Access-Control-Allow-Origin` только ему, плюс `Vary: Origin`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Иначе эндпоинт можно использовать как открытый канал для спама в Telegram/GitHub.
7. **Секреты:** GitHub PAT / GitHub App key / Telegram token — только в Workers Secrets и GitHub Secrets; в JS — только публичный URL эндпоинта.Не логировать токены в `collect-log`-подобных файлах.
8. **Anti-abuse:** лимит тела (4 КБ), дедуп `event_id`, rate-limit по `CF-Connecting-IP` в KV с TTL (идея `hit-counter`), игнор ботов по `request.cf`/UA, троттлинг Telegram-сообщений (дайджест, не «на каждый чих»).

---

## 5. Минимальный MVP-план (2 файла + workflow)

**Цель:** за 1–2 файла получить «посещения → JSON в GitHub → Telegram», без БД и без тяжёлых фреймворков.

### Файл 1 — `js/visits.js` (клиент, ~90 строк)
Адаптировать [`SAMPLE_ANALYTICS.js`](https://raw.githubusercontent.com/chaoticsponge/analytics_worker/main/SAMPLE_ANALYTICS.js):
- проверка consent (`localStorage['energo-analytics-consent']`), GPC/DNT → выход;
- `event_id`/`visitor_id` через `crypto.randomUUID()`, `session_id` из sessionStorage;
- `startPage()` с `tab` из `location.hash` / активной вкладки (`#tab=tenders|map`);
- сбор `active_ms` (видимость + активность), `scroll_pct`, `viewed_cards` (ID карточек через `data-id`), `search_terms` (только из совпадений с `tender-keywords.json`);
- device/os/browser — грубые regex, **сырой UA не отправлять**;
- отправка `fetch(endpoint, {method:'POST', body: JSON.stringify(payload), keepalive:true, credentials:'omit', referrerPolicy:'no-referrer'})`;
- подключить в `index.html`: `<script src="js/visits.js?v=2.66" data-endpoint="https://<worker>.workers.dev/analytics" defer></script>` (версию кэш-бастера поднять по правилу `AGENTS.md`, п. 2).

### Файл 2 — `worker.js` (Cloudflare Worker, ~80 строк)
Паттерн из [`tmclo/view-counter/src/index.ts`](https://raw.githubusercontent.com/tmclo/view-counter/main/src/index.ts) + [`chaoticsponge/analytics_worker/src/index.js`](https://raw.githubusercontent.com/chaoticsponge/analytics_worker/main/src/index.js) + [`gr2m/cloudflare-worker-github-app-example`](https://github.com/gr2m/cloudflare-worker-github-app-example):
- `Origin` whitelist, `OPTIONS` → 204, POST-only, `Content-Type: text/plain|application/json`;
- DNT/GPC → 204; валидация полей и `event_id` (UUID), `active_ms` 0..86400000, `scroll_pct` 0..100;
- обогащение `request.cf` → `geo`, `network`; **IP не сохранять**;
- буфер в KV: `ANALYTICS.put("events:"+YYYYMMDD, JSON.stringify([...events, event]))` (KV eventual-consistency допустима для счётчика);
- опционально мгновенный `sendMessage` в Telegram через fetch (только для «новый визит за день»), остальное — дайджестом;
- запись в GitHub (вариант A): `PUT https://api.github.com/repos/<owner>/<private-repo>/contents/data/visits-YYYY-MM-DD.json` с base64-телом, `sha` из предыдущего `GET`, JWT GitHub App из Secrets. Библиотеку Octokit можно не подключать — хватит `fetch` + `btoa`.

### Файл 3 — `.github/workflows/visits-sync.yml` (вариант B, если не пишем из Worker)
По образцу уже существующего `tenders-update.yml` (частые окна + гейт идемпотентности):
```yaml
on:
  schedule: [{cron: '7 * * * *'}, {cron: '0 19 * * *'}]
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch buffer
        run: curl -fsS "$URL/buffer?date=$(date -u +%F)" -o data/visits-today.json
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'visits: {{date}}'
          file_pattern: 'data/visits-*.json data/visits-summary.json'
      - uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_TO }}
          token: ${{ secrets.TELEGRAM_TOKEN }}
          message: 'Посещения {{date}}: ...'
```
Workers Secrets / GitHub Secrets: `GH_APP_ID`, `GH_APP_KEY`, `VISITS_REPO`, `TELEGRAM_TOKEN`, `TELEGRAM_TO`, `ANALYTICS_URL`.

### Что НЕ делать в MVP
- Не ставить Umami/Plausible/Matomo (сервер + БД, нет записи в GitHub).
- Не хранить IP и сырой UA в публичном репо.
- Не делать session replay и не логировать сырые поисковые строки.
- Не дергать GitHub API из браузера (CORS + утечка токена).

### Критерий готовности
1. `POST /analytics` с тестовым payload → 204; невалидный `Origin` → 403; DNT → 204.
2. Через час в приватном репо появился `data/visits-YYYY-MM-DD.json` с валидным JSON и без IP.
3. В публичном `data/visits-summary.json` — только счётчики; в Telegram — один дайджест в день, без спама.
4. Consent «Отклонить» → сетевых запросов к Worker нет.

---

## 6. Готовые исходники для адаптации (raw URL, проверены 25.11.2026 → HTTP 200)

| Что | URL |
|---|---|
| Клиентский трекер (события, DNT/GPC, active_ms, scroll %, visitor_id) | https://raw.githubusercontent.com/chaoticsponge/analytics_worker/main/SAMPLE_ANALYTICS.js |
| Worker-приёмник (валидация, whitelist, deviceInfo, request.cf, ретенция) | https://raw.githubusercontent.com/chaoticsponge/analytics_worker/main/src/index.js |
| Минимальный CF Worker + KV счётчик | https://raw.githubusercontent.com/tmclo/view-counter/main/src/index.ts |
| CF Worker + GitHub App (авторизация GitHub API из Worker) | https://github.com/gr2m/cloudflare-worker-github-app-example |
| Официальный пример обновления файла через REST/Octokit | https://stackoverflow.com/questions/71054940/update-github-files-through-the-rest-api |
| Telegram Bot API из CF Worker (полный код) | https://gist.githubusercontent.com/cvzi/19167581a023a2c1c51461aecc15c497/raw |
| CF Worker — прокси Telegram Bot API | https://github.com/manzoorwanijk/telegram-bot-api-worker |
| GitHub Action → Telegram (action.yml) | https://raw.githubusercontent.com/appleboy/telegram-action/master/action.yml |
| GitHub Action автокоммит JSON | https://github.com/stefanzweifel/git-auto-commit-action |
| Справочник `request.cf` (country/city/region/asn/asOrganization/colo) | https://developers.cloudflare.com/workers/runtime-apis/request/#the-cf-property-requestcf |
| Идея «данные в git + Actions по расписанию» | https://www.ianlewis.org/en/building-apis-with-static-files |

---

## 7. Короткий ответ запрашивающему

**5 лучших находок:**
1. `chaoticsponge/analytics_worker` — почти готовый трекер под наши поля (но D1, без лицензии).
2. `gr2m/cloudflare-worker-github-app-example` + `octokit/octokit.js` — как безопасно писать JSON в GitHub из Worker.
3. `appleboy/telegram-action` — готовый шаг уведомления в уже существующий workflow.
4. `manzoorwanijk/telegram-bot-api-worker` / gist cvzi — мгновенный Telegram из Worker без Actions.
5. `tmclo/view-counter` — минимальный счётчик на CF Worker + KV как буфер.
(Из «больших»: Umami/Plausible — эталон приватности и схем событий, но не подходят как хранилище в GitHub.)

**Рекомендованная архитектура:** браузер → Cloudflare Worker (валидация, обезличивание, гео из `request.cf`, буфер KV) → GitHub Actions (или сам Worker через GitHub App) → JSON в **приватном** репо; в публичном — только агрегаты; Telegram — дайджестом через `appleboy/telegram-action`.

**Главные риски:** (1) публичность репозитория → IP/поисковые фразы в публичном JSON недопустимы; (2) согласие (GDPR/ePrivacy, 152-ФЗ) — до consent не отправляем ничего, GPC/DNT учитываем; (3) отсутствие готового «всё в одном» решения — придётся собрать 2 файла + workflow из трёх референсов; (4) GitHub Search API в этой сети испорчен (использован прямой API + DDG), skill `browser` недоступен.
