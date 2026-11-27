# Логирование посещений (отдельный документ)

Этот функционал описан отдельно от основной документации: в `PROJECT.md` есть только
короткая ссылка на этот файл. Новым сессиям читать **этот** документ и `AGENTS.md`
пункт 67 и `docs/ENERGO_VISITS_PLUGIN.md` перед любыми изменениями трекера.

## Архитектура (с 26.11.2026): WordPress на reg.ru

```
GitHub Pages: https://alexsmy.github.io/energo/index.html
   │  js/visits.js — фоновый сбор (только продакшн-домен)
   │  POST https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit
   ▼
WordPress на nppuast.com — плагин Energo Visits (PHP + MySQL)
   ├─ EV_CORS: строгий Origin https://alexsmy.github.io + OPTIONS
   ├─ EV_Inbox: схема energo-visits-v1, ≤64 КБ, префикс page, rate-limit по IP
   ├─ EV_Store: wp_energo_ev_events / _devices / _daily, дедуп по event_id (eid)
   ├─ EV_Geo: страна/город/провайдер по REMOTE_ADDR (ip-api.com, кэш 7 дней)
   ├─ EV_Cron: суточные агрегаты, чистка старых событий, Telegram-дайджест
   └─ Страница «Энерго · статистика» в wp-admin, только manage_options
```

**Почему так:** старый путь `браузер → Cloudflare Worker → Render` зависел от двух
внешних доменов. В РФ они заблокированы/нестабильны (Render отдаёт `216.24.57.16/.18`,
`*.workers.dev` часто недоступен в мобильных сетях), поэтому работа была возможна
только через VPN. WordPress на reg.ru находится в той же стране и доступен напрямую:
один same-origin-подобный канал, без прокси, токенов и внешних задержек.

Старые каналы (`worker/`, `.github/workflows/visits-forward.yml`, прямой Render,
GitHub dispatch с PAT в `localStorage`) **полностью удалены из репозитория 27.11.2026**
вместе с npm-скриптами и зависимостью `wrangler`. Секрет `RENDER_PROXY_TOKEN`
подлежит удалению в настройках GitHub и перевыпуску на внешних сервисах.

Локальные/IP-заходы (`127.0.0.1`, `localhost`, `file://`, любые другие домены) **не
отправляются**: трекер проверяет `location.href`. Разрешены обе формы адреса —
`/energo/index.html` и `/energo/`. Сервер дополнительно проверяет Origin и префикс
`page`.

Сессия отправляется **сразу**, не дожидаясь отпечатка; `hardId` приходит отдельным
событием `fingerprint`. Каждое событие имеет `eid` — стабильный ID для дедупликации
при повторной отправке из outbox.

## Устойчивость клиента

- один endpoint из `data/visits-config.json`;
- отправка через `FormData` (поле `payload`) — CORS-safelisted, **без preflight**:
  `OPTIONS` на `nppuast.com` блокируется nginx с 403, поэтому клиент не должен его вызывать;
- таймаут `fetch` 5 с через `AbortController`;
- чанкование пачки по ≤32 КБ (лимит PHP и `keepalive`);
- outbox в `localStorage` переживает перезагрузку, merge при concurrent flush;
- один in-flight `flush`, backoff до 60 с, `sendBeacon` только как последний шанс.

## Что собирается

| Группа | Поля |
|---|---|
| `session` | дата/время, UA, браузер (в т.ч. Яндекс), ОС, тип устройства, экран (ширина/высота, DPR, ориентация), сеть (effectiveType/downlink/rtt/saveData), язык, часовой пояс, referrer, UTM, `hardId`, `isHeadless`, `hasInteracted` |
| `tab` | какие вкладки открывались (`registry`/`tenders`/`map` и вложенные), время в каждой **без учёта фона**, `maxScroll`, `seenPct` |
| `click` | вкладки, кнопки/фильтры, **карточка организации**, **карточка закупки**, маркер карты, ссылки/скачивания |
| `search` | чипы базовых/составных слов и введённые вручную запросы (дебаунс 900 мс) |
| `link` | tel:, mailto:, скачивания CSV/JSON/PDF, внешние ссылки |
| `heartbeat` | раз в 60 с, пока вкладка активна и видима |
| Сервер | IP → страна/город/провайдер, время получения, дедуп по `event_id`, флаг VPN по провайдеру |

**Важно:** просмотр мини-карточек, таблицы и сам скролл **не являются событиями**.
Скролл — только метрика вкладки. Это сознательное решение пользователя.

IP в админке по умолчанию маскируется (`EV_Geo::mask_ip()`), полный IP включается
настройкой; в Telegram-уведомлении IP показывается полностью. `deviceId` хранится в
`localStorage`, `sessionId` — в `sessionStorage`.

## Формат события

```json
{
  "schema": "energo-visits-v1",
  "page": "https://alexsmy.github.io/energo/index.html",
  "sentAt": "...",
  "events": [
    {"eid":"...", "type":"session","ts":"...","sessionId":"...","deviceId":"...",
     "device":"десктоп","os":"Windows 10/11","browser":"Chrome",
     "screen":{...},"network":{...},"utm":{...},
     "hardId":"...","isHeadless":false,"hasInteracted":true},
    {"eid":"...","type":"tab","action":"close","tab":"registry","seconds":39.0,"maxScroll":72,"seenPct":88},
    {"eid":"...","type":"click","kind":"org_card","id":"O-1234","tab":"registry"},
    {"eid":"...","type":"search","source":"chip","query":"лопатки","kind":"base"}
  ]
}
```

## Настройка

`data/visits-config.json`:

```json
{
  "enabled": true,
  "endpoint": "https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit",
  "timeoutMs": 5000
}
```

Секретов в репозитории нет. Настройки приёма (разрешённый Origin, префикс страницы,
лимит запросов, срок хранения, Telegram) — в закрытом `<details>` внизу меню
«Энерго · статистика» в wp-admin. Код плагина лежит в репозитории:
`wp-plugin/energo-visits/`.

## Страница со статистикой

**https://nppuast.com/wp-admin/admin.php?page=energo-visits**. Публичной ссылки нет;
доступ только у пользователей с `manage_options`. По решению пользователя главная
содержит только KPI, карточки устройств и сессии. График, общие блоки «что смотрели»
и «последние события», кнопки сравнения/копирования/экспорта удалены. Вся детализация
(вкладки, поиски, клики, открытые карточки, история событий) — внутри карточки устройства.
Есть экспорт CSV/JSON, сортируемые таблицы, тёмная тема и живое обновление раз в 15 с
без перезагрузки. Подробности — `docs/ENERGO_VISITS_PLUGIN.md`.

## Telegram и cron

- новое устройство — разовое уведомление (включается в настройках);
- ежедневная сводка — после агрегации вчерашнего дня (включается там же);
- суточный cron `ev_daily` агрегирует данные и удаляет события старше `retention_days`;
- замена старого механизма sync в bot_29 больше не требуется.

## Как тестировать и дорабатывать

1. `node build.js` в `energo` — `scripts/test-visits.js` входит в `ci-checks.js`.
2. PHP-плагин: `node lint-php.js` (парсер `php-parser`) локально; на сервере —
   `php -l` по всем файлам. Затем curl-тест из `wp-plugin/energo-visits/README.md`.
3. Для локального E2E: поднять копию трекера, временно разрешить в `js/visits.js`
   `http://127.0.0.1:8765/index.html` и направить **локальную копию**
   `data/visits-config.json` на локальный relay. Query-оверрайд `?visitsEndpoint=`
   удалён и тестами запрещён; **обязательно вернуть продакшн-проверку и endpoint**.
4. Изменения логики править в двух местах: `js/visits.js` (клиент) и
   `EV_Inbox`/`EV_Store` (плагин), плюс оба документа.
