# Energo Visits — плагин WordPress (спецификация)

Версия **2.2.2**. Код: `wp-plugin/energo-visits/`. Кратко: `docs/VISITOR_ANALYTICS.md`.

Плагин принимает события с сайта и показывает отчёт в wp-admin. Это единственный
канал сбора; старые внешние сервисы удалены из репозитория.

## Архитектура

```
index.html → js/visits.js → POST https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit
           → EV_CORS → EV_Inbox → EV_Store → EV_Dashboard
                                      ├─ EV_Geo      гео по REMOTE_ADDR
                                      ├─ EV_Range    МСК → UTC для SQL
                                      ├─ EV_Telegram уведомления
                                      └─ EV_Cron     ev_daily, чистка данных
```

- `EV_CORS` — точный Origin; `EV_Inbox` — схема `energo-visits-v1`, размер ≤64 КБ,
  префикс страницы, ограничение частоты, дедуп по `event_id`.
- `EV_Store` пишет в `wp_energo_ev_events`, `_devices`, `_sessions`, `_daily`, `_refs`,
  обновляет колонки `tab`, `act`, `seconds`, `max_scroll`, `seen_pct`.
  `EV_Activator::maybe_upgrade()` создаёт таблицы через `dbDelta()` без потери данных.
- `EV_Range::from_request()` превращает периоды `today/yesterday/7d/30d/all` в
  UTC-границы; SQL работает в UTC, подписи — через `wp_date()` в МСК.
- `EV_Dashboard` — агрегаты и экспорт; `EV_Admin` — страница для `manage_options`.

## Формат события

```json
{
  "schema": "energo-visits-v1",
  "page": "https://alexsmy.github.io/energo/index.html",
  "sentAt": "...",
  "events": [
    {"eid":"...", "type":"session","ts":"...","sessionId":"...","deviceId":"..."},
    {"eid":"...", "type":"tab","action":"close","tab":"registry","seconds":39,"seenPct":88},
    {"eid":"...", "type":"click","kind":"org_card","id":"O-1234"},
    {"eid":"...", "type":"search","source":"chip","query":"лопатки","kind":"base"}
  ]
}
```

Типы: `session`, `fingerprint`, `tab`, `click`, `search`, `link`, `heartbeat`.
Просмотр мини-карточек и скролл событиями не являются.

Клиент `js/visits.js` работает только на главной странице сайта: `FormData` без
предварительного запроса, таймаут 5 с, пачки ≤32 КБ, `eid`, очередь исходящих
событий в `localStorage`, одна активная отправка, задержка с нарастанием до 60 с.
Endpoint и таймаут — в `data/visits-config.json`, секретов в репозитории нет.

## Дашборд

Главная страница содержит только KPI, карточки устройств и сессии — по решению
пользователя. График и общие блоки удалены; детализация (вкладки, поиски, клики,
история событий) — внутри карточки устройства. Живое обновление — AJAX
`ev_live_poll` раз в 15 с. Экспорт CSV (BOM) и JSON — в настройках; стили и
скрипт — `assets/ev-admin.css` и `assets/ev-admin.js`.

## Безопасность

- Токен Telegram хранится в `type=password` и не выводится в HTML; пустое поле
  означает «оставить сохранённый». Раздельные nonce на каждое `admin_post_*`.
- IP в админке маскируется (`EV_Geo::mask_ip()`), полный IP включается настройкой;
  в Telegram показывается полностью. `X-Forwarded-For` не доверяется без `trust_proxy`.
- SQL — только через `$wpdb->prepare`; поисковый запрос ≤100 символов; ответ Telegram
  очищается от токена перед сохранением ошибки.
- Endpoint публичный: защита построена на Origin, префиксе страницы, лимите размера,
  ограничении частоты и дедупе — это фильтр от случайных запросов, не аутентификация.
- CSV-экспорт экранирует формулы; проверки зафиксированы в тестах.

## Установка и проверки

Собрать архив из `wp-plugin/energo-visits/` и установить через wp-admin
«Плагины → Добавить новый». Активация создаёт таблицы; настройки — в меню
«Энерго · статистика». Архив в git не хранится.

```bash
php -l energo-visits.php               # и по всем файлам includes/
node scripts/test-visits.js            # клиент в репозитории energo
node build.js                          # включает ci-checks.js
curl -X POST 'https://nppuast.com/wp-admin/admin-ajax.php?action=energo_visit' ...  # проверка дедупа
```

Сквозной тест: локальная копия клиента направляется на тестовый приёмник.
При изменении логики править клиент, плагин, документы и тесты.

Сознательно не реализовано: SSE/htmx вместо периодического опроса, тепловая карта,
сохранённые представления, палитра команд, AI-сводка, воронки, ссылка только
для чтения — только после отдельного согласования.
