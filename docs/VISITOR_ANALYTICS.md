# Логирование посещений (отдельный документ)

Этот функционал описан отдельно от основной документации: в `PROJECT.md` есть только
короткая ссылка на этот файл. Новым сессиям читать **этот** документ и `AGENTS.md`
пункт 65 перед любыми изменениями трекера.

## Архитектура: два репозитория

```
GitHub Pages: https://alexsmy.github.io/energo/index.html
  │  js/visits.js — фоновый сбор (только продакшн-домен)
  │  POST https://bot-29-nx0w.onrender.com/api/energo/visits
  ▼
bot_29 / ветка stat_energo (FastAPI на Render)
  ├─ проверка Origin + поля page (только страница energo)
  ├─ GeoIP по IP запроса через ipwho.is → страна/город/провайдер/IP
  ├─ data/energo-visits/events-YYYY-MM.json + known_devices.json
  ├─ GET /api/energo/visits/summary (агрегаты + deviceCards)
  ├─ страница /energo-visits + плашка в дашборде bot_29
  ├─ Telegram: новое устройство (сразу) + сводка (после утреннего sync)
  └─ sync: событие energo-visit — сразу; полный набор — по общему расписанию
```

**Отдельных таймеров в боте нет.** Полный backup едет по уже существующему расписанию
синхронизации bot_29; принятый заход дополнительно ставит событие `energo-visit` в
очередь sync и обрабатывается сразу даже при выключенной опции «Синхронизация по
событию». После рестарта Render данные восстанавливаются штатным `restore`.
Файлы backup плоские: `energo-visits-events-YYYY-MM.json`,
`energo-visits-known_devices.json`, `energo-visits-summary.json`.

Локальные/IP-заходы (`127.0.0.1`, `localhost`, `file://`, любые другие домены) **не
отправляются**: трекер проверяет `location.href`. Разрешены обе формы адреса —
`/energo/index.html` и `/energo/` (мобильные браузеры часто открывают каталог без
`index.html`). Сервер дополнительно проверяет `Origin` и `page`.

Сессия отправляется **сразу**, не дожидаясь вычисления отпечатка: новый `hardId`
приходит отдельным событием `fingerprint`. Это важно для мобильных браузеров, где
вычисление отпечатка может занять больше времени.

## Что собирается

| Группа | Поля |
|---|---|
| `session` | дата/время, UA, браузер (в т.ч. Яндекс), ОС, тип устройства, экран (ширина/высота, DPR, ориентация), сеть (effectiveType/downlink/rtt/saveData), язык, часовой пояс, referrer, UTM, `hardId`, `isHeadless`, `hasInteracted` |
| `tab` | какие вкладки открывались (`registry`/`tenders`/`map` и вложенные), время в каждой **без учёта фона**, `maxScroll`, `seenPct` |
| `click` | вкладки, кнопки/фильтры, **карточка организации** (открытие подробной), **карточка закупки**, маркер карты, ссылки/скачивания |
| `search` | чипы базовых/составных слов и введённые вручную запросы (дебаунс 900 мс) |
| `link` | tel:, mailto:, скачивания CSV/JSON/PDF, внешние ссылки |
| `heartbeat` | раз в 60 с, пока вкладка активна и видима; используется для индикатора «на сайте» |
| Сервер | IP → страна/город/провайдер, время получения, дедуп по `sessionId+ts+type`, флаг `isBot` только по `navigator.webdriver`, `online` если последняя активность < 3 мин |

Отправка событий идёт через `fetch(keepalive)` с подтверждением: при ошибке events
возвращаются в очередь и отправляются повторно. `sendBeacon` используется только как
последний шанс при закрытии страницы (он не даёт подтверждения доставки).

**Важно:** просмотр мини-карточек, таблицы и сам скролл **не являются событиями**.
Скролл — только метрика вкладки. Это сознательное решение пользователя.

IP **присутствует** в уведомлении и в полях устройства на странице; в JSON он пишется
внутри `geo.ip`. `deviceId` хранится в `localStorage`, `sessionId` — в `sessionStorage`.

## Формат события

```json
{
  "schema": "energo-visits-v1",
  "page": "https://alexsmy.github.io/energo/index.html",
  "sentAt": "...",
  "events": [
    {"type":"session","ts":"...","sessionId":"...","deviceId":"...",
     "device":"десктоп","os":"Windows 10/11","browser":"Chrome",
     "screen":{...},"network":{...},"utm":{...},
     "hardId":"...","isHeadless":false,"hasInteracted":true},
    {"type":"tab","action":"close","tab":"registry","seconds":39.0,"maxScroll":72,"seenPct":88},
    {"type":"click","kind":"org_card","id":"O-1234","tab":"registry"},
    {"type":"click","kind":"tender_card","id":"...","tab":"tenders"},
    {"type":"search","source":"chip","query":"лопатки","kind":"base"}
  ]
}
```

## Настройка

`data/visits-config.json` в рабочей копии:

```json
{ "enabled": true, "endpoint": "https://bot-29-nx0w.onrender.com/api/energo/visits" }
```

Endpoint в конфиге, не в коде. Секреты только в окружении Render:
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SYNC_GITHUB_TOKEN`. Отдельных env для
репозитория статистики нет — backup идёт в репозиторий/ветку из
`config/sync_settings.json` бота (как и остальные данные).

## Страница со статистикой

**https://bot-29-nx0w.onrender.com/energo-visits** (есть плашка и в дашборде bot_29).
Весь интерфейс на русском, адаптивный. Приоритет — карточки устройств: клик открывает
детализацию с IP/гео/экраном/сетью/языком/часовым поясом/ referrer/UTM, таблицей
времени по вкладкам «Реестр/Закупки/Карты» со скроллом, кликами и поисковыми словами.
«Последние события» показываются русскими подписями, а не сырыми `tab`/`click`.
Доступ — по API-ключу bot_29 (после `/auth/login` прямая ссылка работает).

## Telegram и sync

- **Новое устройство** — разовое форматированное HTML-уведомление с IP/гео/устройством/экраном/сетью и кнопкой на страницу.
- **Сводка** — после утреннего scheduled push, один раз в сутки.
- `/api/sync/status` → `last_push_reason`, `last_push_manifest`, `last_push_errors`, `sync_scope.sections.sync_energo`.

## Очистка данных

Управление на странице `/energo-visits` (раздел «Обслуживание данных») или API bot_29
с ключом: `DELETE /api/energo/visits/events?all=true`, `...?before=YYYY-MM-DD`,
`DELETE /api/energo/visits/device/<deviceId>`. Любая очистка ставит `energo-cleanup`
в очередь sync, чтобы изменения не откатились при рестарте Render. Подробности —
в `docs/energo_visits.md` репозитория bot_29.

## Как тестировать и дорабатывать

1. `node build.js` в `energo` — `scripts/test-visits.js` входит в `ci-checks.js`.
2. `python -m pytest tests/test_energo_visits.py -q` в `bot_29` (ветка `stat_energo`).
3. Для локального E2E: поднять копию роутера, временно разрешить в `js/visits.js`
   `http://127.0.0.1:8765/index.html` и направить `visits-config.json` на локальный
   endpoint; **обязательно вернуть продакшн-проверку и endpoint обратно**.
4. Запросы к Render делать через `C:\Users\alexs\Downloads\Telegram Desktop\open_render`
   (`render-api.ps1`, `curl --resolve`) — прямой доступ из этой сети заблокирован.
5. Изменения логики править в обоих репозиториях и обновлять оба документа
   (`VISITOR_ANALYTICS.md` здесь и `docs/energo_visits.md` в bot_29).
