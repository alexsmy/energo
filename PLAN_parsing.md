# План следующего этапа: прямой парсинг ЭТП и «только полезные данные»

Дата исследования: **24.11.2026**. Статус: **этап 2 внедрён** (`tektorg-direct`,
`etpgpb-direct`, `roseltorg-direct`), этап 1 частично закрыт пагинацией ТЭК-Торга
(4 страницы вместо 2); reader-фолбэки (этап 4) остаются опциональными. Собственные
парсеры стоят первыми в `sourcePriority` и выигрывают у API при дедупликации
(`sourceRank`: прямой = 0, ГосПлан = 1, GenTender = 3). P0 выполнен в версии
2.59: добавлены `rad-direct`, `fabrikant-direct`, `zakazrf-direct` и телеметрия
источника в `tenders-status.json` (результаты — `AGENTS.md`, п. 57).

> **EN summary.** Keep structured APIs primary. Parse embedded JSON (`__NEXT_DATA__`, `__NUXT_DATA__`) with `cheerio` and keep only whitelisted fields; treat Markdown readers as a last-mile fallback, never as the stored result. Verified locally: Tektorg SSR already exposes 20 structured lots per query and real pagination; a plain HTML→Markdown converter returns navigation junk; Jina Reader is HTTP 451 from this network.

## 0. Главный принцип (ответ на задачу)

Парсер должен быть **воронкой, а не «скачай страницу и почисти мусор»**:

```
запрос → встроенный JSON страницы → whitelist полей → нормализация → дедуп → запись
                ↓ (нет JSON)
          локальный HTML-экстрактор → снова whitelist полей
                ↓ (SPA / блок)
          reader-сервис или headless-браузер → снова whitelist полей
```

Markdown — **не результат**, а лишь промежуточный носитель. В `tenders.json` попадают только нормализованные поля: `id`, `regNumber`, `title`, `customer`, `customerInn`, `dates`, `price`, `status`, `url`, `platform`, `law`, `matchedKeywords`. Баннеры, навигация, «календарь отраслевых мероприятий», CJK-артефакты и прочий мусор отбрасываются до записи.

---

## 1. Research summary (EN)

`websearch` in this environment returns **HTTP 402**, so evidence was collected via DuckDuckGo HTML (`html.duckduckgo.com/html/?q=...`), GitHub REST API (`api.github.com/repos/...`, `/search/repositories`), raw GitHub READMEs/docs, and npm registry. `r.jina.ai` returns **HTTP 451** from this network (Cloudflare, `cf-ray …-DME`), so Jina details were taken from its GitHub README/cookbooks plus independent guides.

| Solution | Repo / docs | License | Output | Self-host | JS / anti-bot | Limits / price | Verdict for `energo` |
|---|---|---|---|---|---|---|---|
| **GosPlan API + GenTender** (current) | `scripts/sources/` | own code | structured JSON | — | n/a | 410 requests/day plan | **Keep as primary.** Cheapest and already works. |
| **cheerio** | https://github.com/cheeriojs/cheerio · 30.6k★, MIT, pushed 2026-11-24 | MIT | DOM → any embedded JSON (`__NEXT_DATA__`, `__NUXT_DATA__`, JSON-LD) | yes | no JS | free | **Best primitive** for ETP embedded state; deterministic. |
| **Jina Reader** | https://github.com/jina-ai/reader · 12.3k★, Apache-2.0, re-synced 2026-04 | Apache-2.0 | Markdown, YAML frontmatter, **JSON via `Accept: application/json`**, chunks | yes: `docker run -p 3000:8081 ghcr.io/jina-ai/reader:oss` | headless Chrome + `curl-impersonate`; `x-proxy-url`, no captcha solving | keyless ~20 RPM; keyed 500–5000 RPM; hosted **451 from RU network** | Good fallback only; self-host image if geo-blocked. |
| **Firecrawl** | https://github.com/firecrawl/firecrawl · 208k★, AGPL-3.0, very active | AGPL-3.0 | Markdown, screenshots, **JSON by schema**, crawl/map/interact | heavy Docker Compose + DB, API :3002 | managed browsers, `waitFor`, `actions`, proxy, `maxAge:0` | free 1000 credits/mo, 10 req/min scrape; JSON costs +4 credits | Typed JSON for high-value pages; **not** daily bulk path. |
| **Crawl4AI** | https://github.com/unclecode/crawl4ai · 87.7k★, Apache-2.0, v0.9.x | Apache-2.0 | Markdown + JSON via `JsonCssExtractionStrategy`, chunking | `pip install crawl4ai` or Docker :11235, token required | Playwright, stealth, proxy, sessions, virtual scroll | OSS free; Cloud 1000 credits/mo, paid from $10 | Strongest open-source anti-bot story; Python runtime is the cost. |
| **trafilatura** | https://github.com/adbar/trafilatura · 7.2k★, Apache-2.0 | Apache-2.0 | TXT/MD/**JSON with metadata**, CSV | pip/CLI | **no JS**; `target_language=ru`, `--fast` | free | Best offline quality baseline, not production runtime. |
| **defuddle** | https://github.com/kepano/defuddle · 10.2k★, MIT, pushed 2026-11-21 | MIT | clean HTML **or Markdown** + 14 metadata fields | npm + linkedom | no JS; more forgiving than Readability | free | **Best local JS extractor** for messy ETP markup. |
| **mdream** | https://github.com/harlan-zw/mdream · 1031★, MIT | MIT | GFM Markdown, frontmatter, streaming, llms.txt | npm / Docker | Docker image includes Playwright | free | Fast converter; optional. |
| **Mozilla Readability + Turndown** | https://github.com/mozilla/readability · https://github.com/mixmark-io/turndown | Apache-2.0 / MIT | HTML article → Markdown | npm | no JS, no extraction of embedded JSON | free | Works only on static article pages; needs GFM plugin for tables. |
| **node-html-markdown / unfluff / goose3** | npm / GitHub | MIT / Apache | Markdown / JSON | yes | no JS | free | Simple; unfluff/goose3 are stale, avoid for Russian ETP. |
| **Browserless / ScrapingBee** | https://www.browserless.io/docs/content · https://www.scrapingbee.com/documentation/ | commercial | rendered HTML (`/content`) or `return_page_markdown=true` | cloud | real browser, stealth, RU exit IP | free 1000 units/credits, then $19–49/mo | Last resort for blocked pages; pay only after proving need. |
| **ScrapeGraphAI** | https://github.com/ScrapeGraphAI/Scrapegraph-ai · 32.9k★, MIT | MIT | Markdown + LLM-shaped JSON | yes, needs LLM keys | optional Playwright | pay per LLM tokens | Non-deterministic for exact lot fields — avoid. |
| **2026 newcomers** | https://github.com/Anakin-Inc/anakin · https://github.com/0xMassi/webclaw · https://github.com/fastcrw/crw | AGPL-3.0 | MD/JSON, Firecrawl-compatible | single binary / Docker | anti-detect browser, proxies | free self-host | Promising, but heavy for GitHub Actions; monitor only. |

Concrete API shapes:

```bash
# Jina: MD, JSON mode, card-only extraction, SPA wait, fresh content
curl -H 'Accept: application/json' \
     -H 'x-target-selector: .lot-card' \
     -H 'x-wait-for-selector: .lot-card__price' \
     -H 'x-engine: browser' -H 'x-timeout: 15' -H 'x-no-cache: true' \
     -H 'x-locale: ru-RU' 'https://r.jina.ai/https://etp.example.com/lot?id=123'

# Firecrawl: typed JSON from one lot page (Node SDK)
const r = await new Firecrawl().scrape(url, {
  formats: ['markdown', { type: 'json', schema: lotSchema }],
  waitFor: 3000, location: { country: 'RU', languages: ['ru-RU'] }, maxAge: 0
});

# Crawl4AI: CSS extraction without LLM
POST http://localhost:11235/crawl/job  { "extraction_strategy": { "type": "JsonCssExtractionStrategy", "schema": {...} } }

# trafilatura: offline quality baseline
trafilatura --json --markdown --target-language ru --fast -u URL
```

Full source list is at the end of this document.

---

## 2. Что реально проверили локально

1. **GitHub REST API** — живые метаданные по 10 репозиториям (звёзды/лицензии/язык/дата пуша): таблица выше. GitHub API доступен; `websearch` — нет (402).
2. **DDG HTML** — рабочий поиск; запросы про reader/firecrawl/crawl4ai и про API ТЭК-Торга вернулись с релевантными ссылками.
3. **Jina Reader** — `r.jina.ai/http://example.com` и `r.jina.ai/https://github.com/jina-ai/reader` → **451** из текущей сети. Документация прочитана из `raw.githubusercontent.com/jina-ai/reader/main/README.md`; там же подтверждены заголовки `x-target-selector`, `x-wait-for-selector`, `x-engine`, `x-no-cache`, `x-timeout`, `x-respond-with: frontmatter`, JSON через `Accept: application/json`.
4. **Firecrawl / Crawl4AI docs** — прочитаны напрямую; подтверждены `/v2/scrape` (`formats`, `waitFor`, `location`, `maxAge`, JSON-схема), `/v2/crawl`, self-host и лимиты.
5. **Настольный тест «лёгкого» конвертера** (`linkedom` + `@mozilla/readability` + `node-html-markdown`, без браузера):
   - `example.com`: HTML 577 байт → Markdown 156 символов — работает.
   - `https://www.tektorg.ru/procedures`: HTML **534 039 байт** → Markdown **3847 символов**, и это «Календарь отраслевых мероприятий», а не тендеры. **Вывод: статический конвертер бесполезен для SPA; сначала нужен встроенный JSON.**
6. **Ключевое открытие по ТЭК-Торгу** — earlier-диагноз «`listingProcedures.data: []`, данные грузятся XHR» **оказался неверным**: правильный путь — `props.pageProps.initialReduxState.listingProcedures`. Проверено:
   - `/procedures` → `status: success`, `data: 20 записей`, `total: 1 484 873`;
   - `/procedures?name=турбина` → 20 записей, `total: 1060`;
   - `/procedures?name=напыление` → 20 записей, `total: 55`.
   Наш `scripts/sources/tektorg.js#parse()` уже читает именно этот путь и вернул 20 структурированных строк с `id`, `registryNumber`, `title`, `organizerName`, `inn`, `dates`, `sumPrice`. Проверена пагинация: `page=1/2/3` возвращает разные записи (первый id 20091599 / 20057874 / 19833899). То есть **прямой парсинг ТЭК-Торга уже работает**, ранний вывод был из‑за неверного пути. Это не требует браузера и стоит 0 лишних запросов.
7. **Прямые JSON‑эндпоинты площадок** — найдены и проверены вживую (Node `fetch` + браузерный UA, 24.11.2026):
   - ТЭК-Торг: `POST https://www.tektorg.ru/api/getProcedures` телом `{"params":{"name":"напыление","page":1,"limit":50}}` → `{total, totalPages, data:[…]}`, те же поля, что и в SSR. GET игнорирует параметры — нужен POST. Ответ 7–43 КБ против ~640 КБ HTML. `params.name` — рабочий фильтр; `search` игнорируется. `currentPage` в ответе всегда 1, для пагинации его использовать нельзя.
   - ЭТП ГПБ: `GET https://etpgpb.ru/api/v2/procedures/?search=турбина&page=1` → JSON:API `{data:[{attributes:{…}}], included, meta:{total_pages,total_count}}`, 30 записей/страница, ~42 КБ. Параметр должен быть `search` верхнего уровня; `procedure[search]` и `page[number]` не работают.
   - Росэлторг: `GET https://www.roseltorg.ru/procedures/search_ajax?query_field=<kw>&sale=1&status[]=5&status[]=0&status[]=1&page=1` → HTML‑фрагмент с 10 карточками; `page` **с нуля**. JSON API нет, но разметка стабильна (`search-results__item`).
   - ЕИС: анонимный Wicket‑replay нестабилен (сессия, `JSESSIONID`, токены страницы); официальный SOAP `getDocsIP` требует персонального токена Госуслуг. Оставляем ГосПлан как основной JSON‑источник и `eis-html.js` как резерв на фикстуре.
   - `robots.txt`: у ТЭК-Торга `?name*` и `?page*` **разрешены**; у ГПБ query‑строки закрыты, API явно не запрещён — держать малый объём; у Росэлторга `/procedures/search_ajax` не запрещён. CAPTCHA/обходы не применяем.

---

## 3. Архитектура «воронки» для нашего проекта

```
L0  Structured APIs     ГосПлан + GenTender                 410 запросов/день, без изменений
L1  Embedded state      cheerio: __NEXT_DATA__ / __NUXT_DATA__ / JSON-LD / __INITIAL_STATE__
                        → whitelist полей → makeRecord()     0 лишних запросов
L2  XHR replay          один раз перехватить запросы браузера, сохранить шаблоны
                        в data/etp-xhr-map.json, затем дёргать напрямую из Node
L3  Local HTML extract  defuddle/Readability + node-html-markdown → ТОЛЬКО извлечь поля,
                        не сохранять Markdown в tenders.json
L4  Reader fallback     Jina OSS (свой Docker) или hosted при доступности; Firecrawl free
                        кап 5–10 запросов/прогон, feature-flag, 3 с между запросами
L5  Headless browser    Playwright в Actions только для 2–3 «тяжёлых» страниц;
                        платный ScrapingBee/Browserless — только если FREE не хватит
```

Каждый слой пишет в `data/collect-log.json` метки `source`, `phase`, `budget`, `records`, `error`. Инвариант **«при ошибке старые записи не удаляются»** сохраняется.

### Правила «только полезные данные»

1. Сначала всегда искать встроенный JSON; парсить whitelist полей, игнорировать остальное.
2. Для HTML‑фолбэка: `defuddle(document, url, { markdown: true })` → регулярки/схема → поля. Не хранить сырой Markdown.
3. Для ЕИС сохранить `repairTitle()`/`splitWordScore()` — reader не склеит разбитые тегами слова.
4. Оставлять запись только если есть совпадение с ключевым словом (`requireKeyword`) и заказчик сопоставлен с реестром по ИНН/названию.
5. Сырой HTML хранить только во временной папке и в 1–2 фикстурах `prototype/` для тестов; в git/community-бандл не класть.

---

## 4. План внедрения по этапам

### Этап 1 — быстрый выигрыш, проверенный локально (без новых зависимостей)
- ТЭК-Торг: `tektorgMaxPages` 2 → 4; план 12 → 24 запроса при бюджете 40. Ни частота, ни окна сбора не меняются.
- Добавить фикстуру сохранённой страницы `/procedures?name=турбина` и регрессионный тест `parse()` → 20 строк.
- Проверить на офлайн‑фикстуре, затем один живой прогон `--source=tektorg --force`, сравнить прирост.
- Обновить `AGENTS.md`: исправить устаревшее утверждение про «пустой `listingProcedures`».

### Этап 2 — перейти с SSR/деvalue на открытые JSON‑эндпоинты ✅ ВНЕДРЕНО (2.58)
Реализовано в `tektorg-direct.js`, `etpgpb-direct.js`, `roseltorg-direct.js`,
подключено в `sourcePriority` и `--dry-run`. Результаты живых тестов и сверки —
в `AGENTS.md`, п. 56. Ниже — исходная спецификация этапа:
- `tektorg.js`: добавить в `ThrottledClient` метод `postJson()` (аналог `_fetchOnce`, `method:'POST'`) и читать `/api/getProcedures` с `{params:{name,page,limit:20}}`. Маппинг `makeRecord()` не меняется — поля те же. Убрать регулярку по 640 КБ HTML.
- `etpgpb.js`: заменить декод `__NUXT_DATA__` на `GET https://etpgpb.ru/api/v2/procedures/?search=<kw>&page=<N>`, маппить `data[].attributes` (адаптер уже ждёт `attributes`).
- `roseltorg.js`: оставить `search_ajax`, но заменить регулярки на `cheerio`‑селекторы `search-results__item` / `search-results__link--description` и явно логировать «разметка изменилась» вместо тихого нуля.
- Общее: `data/etp-xhr-map.json` с шаблонами эндпоинтов; один универсальный `scripts/sources/xhr-replay.js`; все запросы идут через существующий `ThrottledClient` и `requestBudget`.
- Наблюдаемость: различать в `collect-log.json` «0 записей», `status=loading/challenge` и отсутствие `__NEXT_DATA__` — сейчас всё это выглядит одинаково пусто. `currentPage` у ТЭК-Торга не отражает страницу — игнорируем.
- Только после этого, если какая-то площадка начнёт отдавать challenge, использовать Playwright **один раз** для перехвата сети (см. ниже) и записать шаблон в карту; ежедневный прогон остаётся без браузера.

Перехват сети один раз (только для discovery, не в ежедневном прогоне):

```js
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: 'ru-RU' });
page.on('response', async (r) => {
  if (/\/(api|api\/v2)\//.test(r.url()))
    console.log(r.request().method(), r.url(), 'POST=', r.request().postData(),
      '→', (await r.text()).slice(0, 500));
});
await page.goto('https://www.tektorg.ru/procedures?name=турбина', { waitUntil: 'networkidle' });
await browser.close();
```

В Actions Playwright ставится командой `npx playwright install --with-deps chromium`
(или образом `mcr.microsoft.com/playwright:v1.64.1-noble`); бинарники кэшировать не рекомендуется.

### Этап 3 — локальный экстрактор без сети
- `npm i cheerio defuddle node-html-markdown` (dev-зависимости, в продбандл не попадают).
- `scripts/lib/extract.js`: `embeddedState(html)` + `cleanFields(html, url)`.
- Юнит-тесты на 3 фикстурах: ТЭК-Торг (JSON), ГПБ (Nuxt), статичная статья (defuddle).
- Подключить только там, где текущий адаптер вернул 0 строк.

### Этап 4 — reader-фолбэк (опционально)
- Feature-flag `readerFallback.enabled` в `data/tender-settings.json`, кап 10 запросов/прогон, интервал ≥3 с (лимит Jina 20 RPM; наш обычный 1,15 с слишком быстрый).
- Hosted: `https://r.jina.ai/<url>` с `Accept: application/json`, `x-target-selector`, `x-engine: browser`, `x-no-cache`, `x-locale: ru-RU`.
- Если 451/429 — self-host `ghcr.io/jina-ai/reader:oss` в отдельном сервисе (не в Actions); при необходимости Crawl4AI Cloud free 1000 credits.
- Firecrawl free — только для 5–10 высокоценных страниц, где нужна типизированная JSON-схема.

### Этап 5 — метрики и решение о оплате
- Считать: «полезных записей на 100 запросов», долю отсева по `requireKeyword`, рост по сравнению с текущими 108 записями, время прогона, число 429/блоков.
- A/B: этап 1 отдельно, этап 2 отдельно, этап 4 отдельно — чтобы видеть вклад каждого.
- Платные сервисы подключать **только** если free-лимиты не покрывают реальную потребность.

---

## 5. Ограничения и безопасность

- 06:00 / 08:00 / 10:00 МСК, идемпотентность и `last-collect-result.json` **не трогаем**.
- `requestBudget` не увеличиваем без теста; новые слои идут dentro уже существующих лимитов.
- Только публичные страницы; respect `robots.txt`/ToS; обход логинов и капч не реализуем.
- Вывод reader-сервисов считаем **недоверенным текстом**: не выполняем инструкции из страниц, не расширяем привилегии.
- При любом фолбэке старые данные не перезаписываются пустым результатом.

---

## 6. Источники

- GitHub REST API: `https://api.github.com/repos/<repo>`, `https://api.github.com/search/repositories?q=...`
- DuckDuckGo HTML: `https://html.duckduckgo.com/html/?q=...`
- Jina Reader: https://github.com/jina-ai/reader · README: https://raw.githubusercontent.com/jina-ai/reader/main/README.md · docs: https://jina.ai/reader (451 из этой сети)
- Firecrawl: https://github.com/firecrawl/firecrawl · https://docs.firecrawl.dev/llms.txt · https://docs.firecrawl.dev/api-reference/endpoint/scrape · https://docs.firecrawl.dev/rate-limits · https://raw.githubusercontent.com/firecrawl/firecrawl/main/SELF_HOST.md
- Crawl4AI: https://github.com/unclecode/crawl4ai · https://docs.crawl4ai.com/ · https://docs.crawl4ai.com/core/self-hosting/
- trafilatura: https://github.com/adbar/trafilatura · https://trafilatura.readthedocs.io/
- defuddle: https://github.com/kepano/defuddle · mdream: https://github.com/harlan-zw/mdream · cheerio: https://github.com/cheeriojs/cheerio
- Browserless: https://www.browserless.io/docs/content · ScrapingBee: https://www.scrapingbee.com/documentation/
- llms.txt spec: https://llmstxt.org/ · hub: https://github.com/thedaviddias/llms-txt-hub
- ТЭК-Торг: https://www.tektorg.ru/procedures · `POST /api/getProcedures` · чанк `_app-79a1414481027cf5.js` · robots: https://www.tektorg.ru/robots.txt
- ЭТП ГПБ: `GET /api/v2/procedures/?search=…&page=…` · чанк `DQ8ymLuL.js` · robots: https://etpgpb.ru/robots.txt
- Росэлторг: `GET /procedures/search_ajax` · robots: https://www.roseltorg.ru/robots.txt
- Playwright CI/network: https://playwright.dev/docs/ci · https://playwright.dev/docs/network · https://github.com/microsoft/playwright
- ЕИС SOAP: https://vc.ru/dev/1730048-poluchaem-dannye-s-zakupkigovru-cherez-python-poshagovoe-rukovodstvo · портал: https://zakupki.gov.ru/epz/main/public/home.html
