# Energo Visits — плагин WordPress статистики посещений

Версия **2.2.2**. Единственный канал: браузер на GitHub Pages отправляет события
на `https://nppuast.com`; данные и отчёт живут на одном сервере. Публичной страницы
нет — доступ только в wp-admin для `manage_options`.

Код: `wp-plugin/energo-visits/`. Подробности: `docs/ENERGO_VISITS_PLUGIN.md`
и `docs/VISITOR_ANALYTICS.md` репозитория `energo`.

## Установка

1. Скопировать папку `energo-visits` в `wp-content/plugins/`.
2. Активировать плагин — таблицы создаются при активации, данные сохраняются.
3. В меню «Энерго · статистика» проверить Origin и префикс страницы; при
   необходимости указать токен и chat_id Telegram (пустое поле токена = оставить
   сохранённый).

Endpoint приёма:

```
https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit
```

## Поток данных

- `js/visits.js` шлёт `FormData` с полем `payload`:
  `{schema:'energo-visits-v1', page, sentAt, events[]}`. У каждого события есть `eid`.
  `FormData` не вызывает предварительный запрос — nginx блокирует `OPTIONS`.
- `EV_CORS` допускает точный Origin; `EV_Inbox` проверяет схему, размер ≤64 КБ,
  префикс страницы, ограничивает частоту и дедуплицирует по `event_id`.
- `EV_Store` пишет в `wp_energo_ev_events`, `_devices`, `_sessions`, `_daily`, `_refs`;
  производные колонки `tab/act/seconds/max_scroll/seen_pct/is_headless` заполняются
  при вставке.
- `EV_Geo` определяет страну, город и провайдера по `REMOTE_ADDR` (кэш 7 дней);
  `X-Forwarded-For` учитывается только при включённом `trust_proxy`.
- `EV_Range` переводит даты из МСК в UTC для SQL; `EV_Cron` агрегирует данные
  и удаляет старые записи.

Просмотр мини-карточек и скролл событиями не являются.

## Дашборд

Главная: KPI → карточки устройств → сессии; настройки свёрнуты в `<details>`.
График и общие блоки удалены по решению пользователя. В карточке устройства —
показатели, гео и сеть, поиски, клики, вкладки, сессии и история событий.
Обновление раз в 15 с через AJAX `ev_live_poll` без перезагрузки страницы.
Есть экспорт CSV/JSON и сортируемые таблицы.

Telegram: уведомление о новом устройстве и ежедневная сводка включаются
в настройках. Токен в админке не выводится; IP в уведомлении показывается
полностью, в админке по умолчанию маскируется.

## Проверка

```bash
php -l energo-visits.php
php -l includes/class-ev-inbox.php   # и остальные файлы includes/
node scripts/test-visits.js          # в репозитории energo
```

Отправка тестового события (ожидаемый ответ `{"ok":true,"stored":1,...}`,
повтор с тем же `eid` даёт `duplicates:1`):

```bash
curl -sS -X POST 'https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit' \
  -H 'Origin: https://alexsmy.github.io' \
  -F 'payload=<energo-test-payload.json'
```

Дополнительно: отсутствие `Warning:` на странице, ответ `ev_live_poll` = 200,
экспорт CSV = 200.

Плагин можно деактивировать без потери данных. Возврат к прежним внешним
каналам не поддерживается.
