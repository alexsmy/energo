/* Cloudflare Worker: прокси событий посещений energo -> bot_29 (Render).
 *
 * Зачем: браузеры пользователей без VPN не могут достучаться до
 * bot-29-nx0w.onrender.com — DNS отдаёт заблокированные IP 216.24.57.16/.18.
 * Worker живёт на *.workers.dev и пересылает события серверной стороной,
 * для пользователя это уже другой канал, не зависящий от его провайдера.
 *
 * Важно: original client IP передаётся в заголовке X-Energo-Client-IP
 * вместе с общим секретом X-Energo-Proxy. Сервер bot_29 должен доверять
 * этому заголовку только при совпадении секрета (см. патч в bot_29).
 */

const DEFAULT_UPSTREAM = 'https://bot-29-nx0w.onrender.com/api/energo/visits';
const ALLOWED_ORIGIN = 'https://alexsmy.github.io';
const ALLOWED_PAGE_PREFIXES = [
  'https://alexsmy.github.io/energo/index.html',
  'https://alexsmy.github.io/energo/',
];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS = 300;

function cors(response, request) {
  const h = response.headers;
  h.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Max-Age', '600');
  h.set('Cache-Control', 'no-store');
  h.set('Vary', 'Origin');
  // origin может отсутствовать (например, curl) — это нормально: сервер тоже
  // проверяет origin только если он есть.
  void request;
  return response;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function reject(message, status) {
  return cors(json({ ok: false, error: message }, status));
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function validPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.schema !== 'energo-visits-v1') return false;
  const page = String(payload.page || '');
  if (!ALLOWED_PAGE_PREFIXES.some((p) => page.startsWith(p))) return false;
  const events = payload.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) return false;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') return false;
    if (typeof ev.type !== 'string' || typeof ev.ts !== 'string') return false;
    if (typeof ev.sessionId !== 'string' || typeof ev.deviceId !== 'string') return false;
  }
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== 'POST') {
      return reject('method not allowed', 405);
    }

    const origin = (request.headers.get('Origin') || '').trim();
    if (origin && origin !== ALLOWED_ORIGIN) {
      return reject('origin not allowed', 403);
    }

    const body = await request.text();
    if (byteLength(body) > MAX_BODY_BYTES) {
      return reject('payload too large', 413);
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return reject('invalid json', 400);
    }
    if (!validPayload(payload)) {
      return reject('invalid payload', 400);
    }

    const upstream = env.UPSTREAM_URL || DEFAULT_UPSTREAM;
    const clientIp = (request.headers.get('CF-Connecting-IP') || '').trim();
    const proxyToken = String(env.PROXY_TOKEN || '');
    // Cloudflare уже знает страну/город/провайдера по IP запроса — гео не зависит
    // от внешнего GeoIP-сервиса, который на Render может быть недоступен.
    const cf = request.cf || {};
    const geoHint = {
      country: String(cf.country || ''),
      city: String(cf.city || ''),
      provider: String(cf.asOrganization || ''),
      ip: clientIp,
    };
    const forwarded = JSON.stringify({ ...payload, geoHint });

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          // Origin остаётся страницы GitHub Pages — сервер проверяет именно его.
          Origin: ALLOWED_ORIGIN,
          // Сервер bot_29 доверяет этим заголовкам только если PROXY_TOKEN совпал.
          'X-Energo-Proxy': proxyToken,
          'X-Energo-Client-IP': clientIp,
        },
        body: forwarded,
      });
    } catch (e) {
      return reject('upstream unavailable', 502);
    }

    const text = await upstreamResponse.text();
    const response = new Response(text || JSON.stringify({ ok: true }), {
      status: upstreamResponse.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    return cors(response);
  },
};
