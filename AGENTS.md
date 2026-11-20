# AGENTS.md — опорный файл проекта (для продолжения в новой сессии)

Проект: **Энергореестр РФ 2026** (`alexsmy/energo`) — веб-приложение с реестром
энергогенерирующих и энергоремонтных предприятий России.

## Текущее состояние (на 20.11.2026, версия 1.3)

- **339 записей**: 19 холдингов, 61 юрлицо, 259 станций/объектов.
- **Достоверность**: 330 high / 9 medium / **0 low**. Уровень «низкая» удалён из данных и UI.
- **Автообновление**: `version.json` + проверка раз в 15 минут / при возврате во вкладку;
  при смене версии показывается плашка с обратным отсчётом 15 с, состояние фильтров сохраняется
  в `sessionStorage`.
- Вкладки: «Все», «Генерация», «Ремонт и сервис», «ОЕМ и инжиниринг», «Карта».
- Виды: карточки (с группировкой по холдингам) и таблица (липкие шапки групп, адаптив в мобильные карточки).
- Карта: Leaflet + OSM / Esri satellite / hybrid, кластеры, 5 слоёв, эмодзи-иконки по типам,
 popup → полная карточка.
- Печатная версия: `print.html` → `Энергореестр-РФ-2026.pdf` (титул, содержание, разделы, ЭТП, источники).
- Экспорт: `registry.csv` (Excel, `;`, BOM), `registry.json`, кнопка «Экспорт CSV» в UI.
- GitHub: https://github.com/alexsmy/energo · GitHub Pages: https://alexsmy.github.io/energo/index.html

## Карта файлов

```
app/                       # корень репозитория (GitHub Pages serving root)
├── index.html             # интерфейс: шапка, укороченный hero, фильтры, карточки/таблица/карта, модалка
├── print.html             # печатная версия
├── css/
│   ├── styles.css         # экранные стили: контрастная тема, compact-сетка, адаптив 320px+, карта
│   └── print.css          # A4, page-break между разделами/холдингами
├── js/
│   ├── data.js            # АВТО: window.REGISTRY (не редактировать)
│   ├── app.js             # фильтры, поиск (debounce), карточки, таблица, модалка, карта, CSV
│   └── print.js           # генерация печатного HTML
├── data/
│   ├── entities.tsv       # РУЧНОЙ ИСТОЧНИК: 81 организация, 25 полей, разделитель `|`
│   ├── plants.tsv         # АВТО из plants.gen.js: 259 станций
│   ├── plants.gen.js      # генератор станций
│   └── geo.js             # города, привязка станций, точные координаты крупных stations
├── build.js               # сборка data.js + CSV + JSON + version.json, валидация
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
node build.js                       # пересобрать data.js / CSV / JSON
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
   подключены с `?v=1.5` для инвалидации кэша на GitHub Pages; при каждой публикации версию
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
   и при возврате во вкладку. При смене версии показывается плашка с обратным отсчётом 15 с;
   «Позже» запрещает повтор только на текущую версию через `sessionStorage`. Перед перезагрузкой
   состояние фильтров/вида/вкладки сохраняется и восстанавливается.
10. Безопасность: CDN Leaflet зафиксированы по версиям и защищены SRI; Google Fonts удалены;
   нет трекинга, форм и запросов к GitHub из браузера. Автор коммита — `noreply@users.noreply.github.com`,
   персональный e-mail убран из истории (`git commit --amend --reset-author` + force-push).
11. Индексирование запрещено: `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet,
   noimageindex">` в `index.html` и `print.html`, `referrer=no-referrer`, плюс `robots.txt` с
   `Disallow: /` для всех и основных ботов.

## Что осталось / риски

- Часть официальных сайтов отвечает 403/000 из-за локального TLS-прокси и Anti-DDoS
  (rosenergoatom.ru 418, gazprom/tatenergo/mosenergo 403, gpte/boges/enplus 000).
  Проверять из обычного браузера; при подтверждении обновить `site`/`procUrl` в `entities.tsv`.
- `zakupki.gov.ru` корень отдаёт 404; в данных используется рабочий путь
  `/epz/main/public/home.html`.
- Ссылки на ЭТП и e-mail нужно периодически перепроверять (срок — 20.11.2026).
- Google AI Mode и Yandex во время правок отдавали капчу/пустоту; поиск через websearch недоступен (402).

## GitHub

- Репозиторий создан: `alexsmy/energo` (main).
- Push выполнять **только по явной просьбе**, одной командой `git push`.
- GitHub Pages включается через API или в настройках репозитория: Source = Deploy from a branch,
  Branch = `main`, folder = `/ (root)`.
