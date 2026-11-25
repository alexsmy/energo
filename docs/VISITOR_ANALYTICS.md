# Логирование посещений (отдельный документ)

Этот функционал **не описан в основной документации** проекта — здесь собрано всё, что
касается сбора статистики посещений, страницы отчёта и уведомлений в Telegram.

## Архитектура

Два репозитория на разных серверах:

```
GitHub Pages (alexsmy/energo/index.html)
  │  js/visits.js — события
  │  POST https://bot-29-nx0w.onrender.com/api/energo/visits
  ▼
bot_29 (FastAPI, Render)
  ├─ Origin/страница-вайтлист → только alexsmy.github.io/energo/index.html
  ├─ GeoIP по IP запроса (страна, город, провайдер)
  ├─ JSON: data/energo-visits/events-YYYY-MM.json
  ├─ Агрегат: GET /api/energo/visits/summary
  ├─ Страница: https://bot-29-nx0w.onrender.com/energo-visits (плашка есть и в дашборде bot_29)
  ├─ Backup: через уже существующий sync-воркер bot_29 (2 раза в сутки) в GitHub
  └─ Telegram: новое устройство (разово) + сводка по утрам через тот же sync
```

Отдельных таймеров в боте нет: события и сводка едут на уже настроенном расписании
синхронизации; после рестарта Render данные восстанавливаются штатным restore.

Локальные заходы (`127.0.0.1`, `localhost`, file://, любые другие домены) **не
отправляются**: трекер проверяет `location.href` и выходит сразу, если это не
`https://alexsmy.github.io/energo/index.html`. Сервер дополнительно проверяет
`Origin` и поле `page`.

## Что собирается

| Группа | Поля |
|---|---|
| Сессия | дата/время, UA, браузер (в т.ч. Яндекс), ОС, тип устройства, экран (ширина/высота, DPR, ориентация), сеть (effectiveType/downlink/rtt/saveData), язык, часовой пояс, referrer |
| Вкладки | какие открывались (`registry`, `tenders`, `map`, вложенные pane/view), время в каждой, максимальный процент скролла |
| Карточки | ID просмотренных карточек реестра, закупок, ЭТП и маркеров карты (через IntersectionObserver и клики) |
| Поиск | нажатия на чипы базовых/составных слов и введённые вручную запросы (с дебаунсом 900 мс) |
| Сервер | IP → страна/город/провайдер (бесплатный GeoIP), время получения, дедуп событий |

IP-адрес в JSON **не сохраняется** — только геолокация, определённая сервером.
Постоянный `deviceId` хранится в `localStorage` браузера, `sessionId` — в `sessionStorage`.

## Формат события

```json
{
  "schema": "energo-visits-v1",
  "page": "https://alexsmy.github.io/energo/index.html",
  "sentAt": "...",
  "events": [
    {"type": "session", "ts": "...", "sessionId": "...", "deviceId": "...",
     "device": "десктоп", "os": "Windows 10/11", "browser": "Chrome",
     "screen": {...}, "network": {...}},
    {"type": "tab", "action": "close", "tab": "registry", "seconds": 39.0, "maxScroll": 72},
    {"type": "card", "id": "O-1234", "area": "registry"},
    {"type": "search", "source": "chip|typed", "query": "лопатки", "kind": "base|composite"}
  ]
}
```

## Настройка

В `data/visits-config.json` рабочей копии:

```json
{ "enabled": true, "endpoint": "https://bot-29-nx0w.onrender.com/api/energo/visits" }
```

Endpoint хранится в конфиге, **не в коде**. Секреты Telegram и GitHub остаются
только в переменных окружения Render:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — уже используются bot_29;
- `SYNC_GITHUB_TOKEN` — для публикации агрегата в GitHub;
- `ENERGO_VISITS_GITHUB_REPO` / `ENERGO_VISITS_GITHUB_BRANCH` — куда писать сводку
  (по умолчанию `alexsmy/bot_29`, ветка `stat_energo`).

## Страница со статистикой

**https://bot-29-nx0w.onrender.com/energo-visits**

Показывает KPI (сессии, устройства, события, средний скролл), время по вкладкам,
географию, устройства/браузеры, поисковые слова, события по дням и последние события.
Страница защищена тем же API-ключом bot_29 (после входа в `/auth/login` доступна по
прямой ссылке).

## Уведомления

- **Разовое** — при первом заходе нового `deviceId`: форматированное HTML-сообщение
  с гео, устройством, экраном, сетью и кнопкой «Открыть статистику».
- **Ежедневное** — в 09:00 МСК: сводка по сессиям, вкладкам, географии, поиску,
  скроллу и просмотренным карточкам, плюс кнопка на страницу отчёта.

## Проверки

`scripts/test-visits.js` входит в общий прогон `ci-checks.js` и проверяет:
только продакшн-домен, пустой endpoint в репозитории, отсутствие секретов в коде,
наличие всех типов событий и отправку через `sendBeacon`.
