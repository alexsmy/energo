# Worker-прокси для посещений energo

Прокси принимает события с `https://alexsmy.github.io/energo/index.html` и
пересылает их на `https://bot-29-nx0w.onrender.com/api/energo/visits`.

Зачем: у пользователей без VPN DNS `bot-29-nx0w.onrender.com` резолвится в
заблокированные адреса `216.24.57.16/.18`, и браузерный POST висит без ответа.
Worker живёт на `*.workers.dev` и обращается к Render **с серверной стороны**,
минуя сетевые ограничения пользователя.

## Развёртывание

Самый простой путь — вообще не создавать API Token вручную. Из корня репозитория:

```powershell
npx wrangler login
```

Откроется браузер с страницей авторизации Cloudflare — нажмите **Allow**.
После этого токен сохранится в конфиге wrangler, и достаточно одной команды:

```powershell
npm run deploy:worker
```

Альтернатива с API Token: положить в корень `.env` (уже в `.gitignore`):

```text
CLOUDFLARE_API_TOKEN=…токен из Cloudflare…
CLOUDFLARE_ACCOUNT_ID=…account id…
```

и тоже запустить `npm run deploy:worker`.

Скрипт сам задеплоит Worker, создаст секрет `PROXY_TOKEN`, найдёт выведенный
адрес `*.workers.dev` и запишет его в `data/visits-config.json`. Секрет сохранится
в `worker/.proxy-token.txt` — его нужно один раз задать в Render как
`ENERGO_VISITS_PROXY_TOKEN`.

Ручной вариант (если хотите контролировать каждый шаг):

```powershell
npx wrangler deploy --config worker/wrangler.toml
npx wrangler secret put PROXY_TOKEN --config worker/wrangler.toml
```

Wrangler напечатает адрес вида `https://energo-visits.<subdomain>.workers.dev`.
Его нужно записать в `data/visits-config.json` (поле `endpoint` и первый элемент
`endpoints`), а в Render задать env-переменную `ENERGO_VISITS_PROXY_TOKEN`
с тем же значением, что и `PROXY_TOKEN` Worker.

## Локальная проверка без Cloudflare

```powershell
node worker/test-worker.mjs
```

Тест поднимает мок-апстрим, проверяет CORS, отказ чужого origin, валидацию
payload и передачу `CF-Connecting-IP` в заголовке `X-Energo-Client-IP`.

## Безопасность

- `Origin` проверяется и в Worker, и на Render.
- `X-Energo-Client-IP` принимается сервером только при совпадении `X-Energo-Proxy`
  с `ENERGO_VISITS_PROXY_TOKEN` — подделать гео снаружи нельзя.
- Размер тела ≤ 64 КБ, число событий ≤ 300, только ожидаемые поля события.
- Токенов и секретов в репозитории нет.
