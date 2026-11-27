# Energo Visits — плагин WordPress (полная спецификация)

Версия плагина на 26.11.2026: **2.2.2**. Исходники в репозитории:
`wp-plugin/energo-visits/`. Архив для wp-admin собирается из этой папки как
`energo-visits-plugin.zip` и в git не хранится. Локальные абсолютные пути
разработки из документации удалены (27.11.2026).

Документ для продолжения работы в другой сессии: здесь зафиксированы архитектура,
принятые решения, история правок, текущее состояние и что сознательно НЕ делалось.

---

## 1. Зачем и почему

Исходная схема сбора посещений (`js/visits.js` → Cloudflare Worker → FastAPI bot_29
на Render) зависела от двух внешних доменов. В РФ Render отдаёт заблокированные IP
`216.24.57.16/.18`, `*.workers.dev` часто недоступен в мобильных сетях, поэтому
стабильная работа достигалась только через VPN/прокси. Сегодняшние коммиты 2.68–2.70
пытались лечить симптом (Worker, GitHub dispatch с PAT в `localStorage`, 3 канала,
таймаут 15 с × 3), но не устраняли причину.

Решение пользователя (26.11.2026): сайт остаётся на GitHub Pages, приём событий
и вся статистика переносятся на WordPress `https://nppuast.com` (reg.ru).
Начали с чистого листа, историю bot_29 не импортировали.

## 2. Архитектура

```
GitHub Pages: https://alexsmy.github.io/energo/index.html
   │  js/visits.js — только продакшн-домен, один канал
   │  POST .../wp-admin/admin-ajax.php?action=energo_visit
   │  FormData{ payload: JSON energo-visits-v1 }, keepalive, outbox, eid
   ▼
WordPress nppuast.com / wp-content/plugins/energo-visits
   ├─ EV_CORS          init@1: точный Origin, OPTIONS, CORS-заголовки
   ├─ EV_Inbox         валидация, ≤64 КБ, rate-limit, дедуп по event_id
   ├─ EV_Store         wp_energo_ev_events / _devices / _sessions / _daily / _refs
   ├─ EV_Geo           ip-api.com → страна/город/провайдер, кэш 7 дней
   ├─ EV_Range         единый период: МСК (wp_timezone) → UTC для SQL
   ├─ EV_Dashboard     SQL-агрегаты, KPI, device_stats, sessions, export
   ├─ EV_Telegram      новое устройство + ежедневная сводка
   ├─ EV_Cron          ev_daily, чистка по retention_days
   └─ EV_Admin         страница «Энерго · статистика», manage_options
```

### Формат события

```json
{
  "schema": "energo-visits-v1",
  "page": "https://alexsmy.github.io/energo/index.html",
  "sentAt": "...",
  "events": [
    {"eid":"...", "type":"session", "ts":"...", "sessionId":"...", "deviceId":"...",
     "device":"десктоп", "os":"Windows 10/11", "browser":"Chrome",
     "screen":{...}, "network":{...}, "utm":{...},
     "hardId":"...", "isHeadless":false, "hasInteracted":true},
    {"eid":"...", "type":"tab", "action":"close", "tab":"registry", "seconds":39.0,
     "maxScroll":72, "seenPct":88},
    {"eid":"...", "type":"click", "kind":"org_card", "id":"O-1234"},
    {"eid":"...", "type":"search", "source":"chip", "query":"лопатки", "kind":"base"}
  ]
}
```

Типы: `session`, `fingerprint`, `tab`, `click`, `search`, `link`, `heartbeat`.
Просмотр мини-карточек и скролл сознательно **не** являются событиями (скролл —
только метрика вкладки).

### Клиент

- `data/visits-config.json`: один endpoint, `timeoutMs: 5000`, никаких токенов.
- `js/visits.js`: AbortController, чанки ≤32 КБ, outbox в `localStorage` с merge,
  один in-flight `flush`, backoff до 60 с, `sendBeacon` только как последний шанс.
- Все события получили `eid` — стабильный ID для дедупликации при повторной отправке.
- `FormData` выбран сознательно: `text/plain;charset=UTF-8` теоретически safelisted,
  но OPTIONS на `nppuast.com` блокируется nginx (403), поэтому преflight недопустим.

## 3. База данных

| Таблица | Назначение |
|---|---|
| `wp_energo_ev_events` | `event_id` UNIQUE, `session_id`, `device_id`, `type`, `event_ts/received_at` UTC, `page`, `payload`, `ip/country/city/isp/is_vpn`, производные `tab/act/seconds/max_scroll/seen_pct/is_headless`. Индексы: `uniq_event`, `idx_ts`, `idx_device`, `idx_type`, `idx_tab_act`. |
| `wp_energo_ev_devices` | `device_id` PK, `hard_id`, `first_seen/last_seen`, `first_payload`, гео, ОС/браузер/тип, `events_count`. `last_seen` обновляется через `GREATEST`. |
| `wp_energo_ev_sessions` | `session_id` PK, `device_id`, `first_ts/last_ts`, счётчики `events/tabs/clicks/searches`, браузер/ОС/тип/гео. Заполняется в `EV_Store::upsert_session()`, пересобирается `rebuild_sessions()`. |
| `wp_energo_ev_daily` | суточные агрегаты, `day` PK. Используются daily-дайджестом и чисткой. |
| `wp_energo_ev_refs` | справочник `ref_id + kind → title, url` из `registry.json` и `data/tenders.json`; обновляется кнопкой в настройках. De-dup N+1: один `LEFT JOIN`. |

`EV_Activator::maybe_upgrade()` при версиях < 2.0.0 делает `backfill_columns()`,
при < 2.2.0 — `rebuild_sessions()`. `dbDelta()` создаёт таблицы без потери данных.

## 4. Время и periods

- `EV_Range::from_request()`: `from/to` из `$_GET`, presets `today/yesterday/7d/30d/all`;
  `wp_date()` + `wp_timezone()` → `DateTimeImmutable` → UTC-строки `from_utc/to_utc`,
  `prev_from_utc/prev_to_utc`, `days`.
- Все SQL-запросы используют UTC-границы. Все подписи идут через
  `wp_date(format, strtotime($utc.' UTC'), wp_timezone())` — МСК.
- `EV_Dashboard::daily()` группирует по `DATE(CONVERT_TZ(event_ts,'+00:00','+03:00'))`.
- Проверено на экспорте: `16:19 UTC` → `19:19 МСК`.

## 5. Дашборд

**Главная (строго по решению пользователя):**
1. компактная шапка: заголовок, «обновлено», 5 presets периода;
2. 6 KPI: Онлайн, Заходы, Устройства, События, Действия, Поиски;
3. карточки устройств;
4. сессии;
5. настройки/обслуживание в закрытом `<details>`.

Сознательно удалено с главной: график динамики, «Что смотрели», «Последние события»,
кнопки «Сравнить / Копировать ссылку / Экспорт CSV», глобальные KPI в детальном просмотре,
липкая шапка, колонка «Устройство / IP» в истории устройства.

**Карточка устройства** (основной рабочий экран): 4 показателя устройства, чипы
(IP по умолчанию маска, гео, провайдер, экран, сеть, язык, пояс, referrer, UTM),
«Искал», «Нажимал» (названия из refs + русские подписи кнопок), «Вкладки этого
устройства», «Открывал карточки и закупки», «Сессии» этого устройства, «История
событий устройства» (Время / Событие / Подробности / Сессия).

Технические решения:
- стиль вынесен в `assets/ev-admin.css` (токены, светлая/тёмная темы, контраст ≥4.5,
  sticky-шапки таблиц, табулярные цифры, focus-visible, reduced-motion);
- `assets/ev-admin.js`: AJAX-poll `ev_live_poll` раз в 15 с, точечный `textContent`,
  клиентская сортировка таблиц, keyboard-доступность, тосты;
- KPI/счётчики показывают «Показано N из M»; экспорт CSV (BOM) и JSON через
  `admin_post_ev_export` (до 100 000 строк);

uPlot был исследован и скачан, но **не используется** — график удалён по решению
пользователя; файлы uPlot убраны из репозитория.

## 6. Безопасность и приватность

- Токен Telegram: `type=password`, значение не выводится в HTML; пустое поле = оставить
  сохранённый; nonce раздельные на каждое `admin_post_*` действие.
- `sslverify` по умолчанию выключен (совместимость с действующим плагином `tvs-stats`),
  включается настройкой «Проверять TLS Telegram».
- IP в админке маскируется через `EV_Geo::mask_ip()`; полный IP — явная настройка.
  В Telegram IP показывается полностью (по требованию пользователя).
- `X-Forwarded-For` не доверяется без настройки `trust_proxy`.
- Поисковый запрос ограничен 100 символами; все SQL — через `$wpdb->prepare`.
- Ответ Telegram перед сохранением в `ev_tg_last_error` очищается от токена.
- Endpoint приёма событий защищён Origin + page + size + rate-limit + дедупом;
  это фильтр от случайных запросов, не аутентификация (публичный endpoint).
- Откат на старый канал больше не поддерживается: `worker/` и
  `visits-forward.yml` удалены из репозитория 27.11.2026. При необходимости
  восстановить их из архивной ветки, заново выпустив секреты.

## 7. История версий

| Версия | Что сделано |
|---|---|
| 1.0.0 | Приём событий, 3 таблицы, CORS, гео, cron, Telegram, базовая страница (три копии плагина → фатал `Cannot redeclare`; исправлено защитой `ENERGO_VISITS_LOADED`). |
| 1.1.0 | Точный формат уведомления о новом устройстве; токен/chat взяты из рабочего `tvs-stats`. |
| 1.2.0 | Проверка TLS/журнал ошибок, полный IP и доверие X-Forwarded-For по настройкам. |
| 1.3.0 | Первый «дашборд»: KPI, устройства, сессии, «что смотрели», гео, лог; имел ошибки и неверную семантику периодов. |
| 2.0.0 | `EV_Range`, единый период МСК→UTC, живой poll вместо reload, дизайн-система, экспорт, тёмная тема, SQL-агрегаты, таблица sessions. |
| 2.1.0–2.1.1 | Переосмысление IA по пользователю: главная = KPI + устройства + сессии; удалены график, общие «что смотрели»/«последние события», кнопки сравнения/копирования/экспорта; деталь устройства стала главным экраном. |
| 2.2.0–2.2.2 | Исправления по скриншоту: корректный вывод поисковых слов (json_decode вместо SQL-строки), читаемые названия кликов, пустой UTM скрывается, гео без дублей, счётчик сессий с фильтром устройства, браузер/ОС в сессиях вместо ID, полоса фиксированной ширины, шапка не перекрывает содержимое, нет Warning. |

## 8. Что<NЕ делалось сознательно

Следующее относилось к «премиум» (P3), но **не реализовано** и не заявлялось как
готовое: SSE/htmx вместо polling, heatmap «час × день недели», сохранённые представления,
command palette (Ctrl+K), AI-сводка, воронки/retention, comparisons «аналогичный день
недели», read-only share-link с отдельным capability. Если продолжать — начинать именно
с этих пунктов, но только после явного согласования с пользователем.

## 9. Тестирование

- `php -l` по всем 11 PHP-файлам (локально — парсером `php-parser`, `node lint-php.js`).
- `node scripts/test-visits.js` и `node build.js` в репозитории `energo` (клиентская часть).
- curl-тест приёма события (см. README плагина): первый вызов `stored:1`, повтор `duplicates:1`.
- END-to-END на сайте: Нет `Warning:`/`Fatal error:`, `ev_live_poll` → 200, экспорт → 200,
  уведомление Telegram приходит, на главной/KPI/устройстве отображается ожидаемое.
- Локальный E2E: временно разрешить в `js/visits.js` `http://127.0.0.1:8765/index.html`
  и направить конфиг на локальный endpoint; обязательно вернуть продакшн-проверку обратно.
