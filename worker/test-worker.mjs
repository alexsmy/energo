/* Локальные тесты Worker без Cloudflare-аккаунта: node worker/test-worker.mjs */
import assert from 'node:assert/strict';
import http from 'node:http';
import worker from './src/index.mjs';

const ALLOWED = 'https://alexsmy.github.io';
const seen = {};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    seen.body = JSON.parse(body);
    seen.origin = req.headers.origin || '';
    seen.proxy = req.headers['x-energo-proxy'] || '';
    seen.clientIp = req.headers['x-energo-client-ip'] || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, accepted: seen.body.events.length, newDevice: false }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.startsWith('http://mock-upstream')) {
    return realFetch(`http://127.0.0.1:${port}${new URL(u).pathname}`, options);
  }
  return realFetch(url, options);
};

const env = { UPSTREAM_URL: 'http://mock-upstream/api/energo/visits', PROXY_TOKEN: 'test-secret' };
const url = 'https://energo-visits.example.workers.dev/api/energo/visits';
const payload = {
  schema: 'energo-visits-v1',
  page: 'https://alexsmy.github.io/energo/index.html',
  sentAt: '2026-11-26T05:00:00.000Z',
  events: [{ type: 'session', ts: '2026-11-26T05:00:00.000Z', sessionId: 's1', deviceId: 'd1' }],
};
const make = (method, headers, body) => new Request(url, { method, headers, body });

try {
  let r = await worker.fetch(make('OPTIONS', { Origin: ALLOWED }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), ALLOWED);
  assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');

  r = await worker.fetch(make('POST', { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, JSON.stringify(payload)), env);
  assert.equal(r.status, 403);

  r = await worker.fetch(make('POST', { Origin: ALLOWED, 'Content-Type': 'text/plain' }, JSON.stringify({ ...payload, schema: 'bad' })), env);
  assert.equal(r.status, 400);

  r = await worker.fetch(make('POST', {
    Origin: ALLOWED,
    'Content-Type': 'text/plain;charset=UTF-8',
    'CF-Connecting-IP': '8.8.8.8',
  }, JSON.stringify(payload)), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(seen.origin, ALLOWED);
  assert.equal(seen.proxy, 'test-secret');
  assert.equal(seen.clientIp, '8.8.8.8');
  assert.equal(seen.body.events.length, 1);

  console.log('OK: Worker — 5 проверок пройдено');
} finally {
  globalThis.fetch = realFetch;
  server.close();
}
