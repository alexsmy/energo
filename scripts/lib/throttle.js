#!/usr/bin/env node
/* Общий HTTP-клиент: ограничение частоты, ретраи, таймаут, куки и заголовки.
 *
 * browser:true — браузерные заголовки + cookie jar. Включается точечно для
 * площадок с анти-бот защитой (ТЭК-Торг/Variti и др.). Основные API
 * (ГосПлан, GenTender) продолжают работать с существующей подписью.
 */
'use strict';

const UA = 'EnergoRegistry/1.9 (+https://github.com/alexsmy/energo)';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const net = require('net');
// Поток с площадки может быть огромным: ограничиваем тело до 16 МБ.
// Реальные ответы адаптеров — 7–640 КБ, поэтому выдача не уменьшается.
const MAX_BODY_CHARS = 16 * 1024 * 1024;

// Публичные зоны, где последние две метки — не домен второго уровня.
const PUBLIC_SUFFIXES = new Set(['gov.ru', 'com.ru', 'org.ru', 'net.ru', 'edu.ru', 'ac.ru', 'co.ru', 'pp.ru']);

function cleanHost(value) {
  return String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function baseDomain(host) {
  const h = cleanHost(host).replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return PUBLIC_SUFFIXES.has(last2) ? parts.slice(-3).join('.') : last2;
}

function isBlockedHost(host) {
  const h = cleanHost(host);
  if (!h || net.isIP(h)) return true; // любые IP-литералы: loopback/private/link-local/IMDS
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata.goog') return true;
  return false;
}

function sameSite(host, base) {
  const h = cleanHost(host).replace(/^www\./, '');
  return h === base || h.endsWith('.' + base);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class ThrottledClient {
  constructor(opts = {}) {
    this.minInterval = opts.minInterval == null ? 6500 : Math.max(0, Number(opts.minInterval) || 0);
    this.timeout = opts.timeout || 25000;
    this.retries = opts.retries || 3;
    this.backoff = opts.backoff || [35000, 70000];
    this.ua = opts.ua || UA;
    this.browser = !!opts.browser;
    this.cookies = new Map(); // hostname -> Map(name -> value)
    this.last = 0;
    // SSRF-защита: top-level URL'ы задаёт наш код (или конфиг площадок),
    // редиректы разрешаем только в рамках того же сайта либо на уже
    // использованный хост. Заданный извне redirect на внутренний или посторонний
    // хост должен быть отклонён.
    this.multiHost = !!opts.multiHost;
    this.explicitHosts = new Set();
    this.allowedBase = opts.allowedBase ? cleanHost(opts.allowedBase) : '';
  }

  _safeUrl(raw, isTop) {
    let u;
    try { u = new URL(String(raw)); }
    catch (e) { throw new Error('invalid URL: ' + String(raw)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked protocol: ' + u.protocol);
    const host = cleanHost(u.hostname);
    if (isBlockedHost(host)) throw new Error('blocked host: ' + host);
    if (isTop) {
      this.explicitHosts.add(host);
      if (!this.multiHost && !this.allowedBase) this.allowedBase = baseDomain(host);
    } else if (this.multiHost) {
      if (!this.explicitHosts.has(host)) throw new Error('redirect host not in allowlist: ' + host);
    } else if (this.allowedBase && !sameSite(host, this.allowedBase)) {
      throw new Error('redirect outside allowed site: ' + host);
    } else if (!this.allowedBase) {
      this.allowedBase = baseDomain(host);
    }
    return u.toString();
  }

  _host(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

  _cookieHeader(url) {
    const jar = this.cookies.get(this._host(url));
    return jar && jar.size ? [...jar].map(([k, v]) => k + '=' + v).join('; ') : '';
  }

  _storeCookies(url, res) {
    const host = this._host(url);
    if (!host) return;
    let values = [];
    try {
      values = res.headers.getSetCookie
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    } catch (e) { /* noop */ }
    if (!values.length) return;
    const jar = this.cookies.get(host) || new Map();
    for (const raw of values) {
      const pair = String(raw).split(';')[0];
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /^(deleted|""|null)$/i.test(value)) jar.delete(name);
      else jar.set(name, value);
    }
    this.cookies.set(host, jar);
  }

  async _fetchOnce(url, asJson, reqOpts) {
    let current = this._safeUrl(url, true);
    for (let hop = 0; hop < 6; hop++) {
      const headers = {
        'User-Agent': this.browser ? BROWSER_UA : this.ua,
        'Accept': asJson
          ? 'application/json,text/plain,*/*'
          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      };
      if (this.browser) headers['Accept-Language'] = 'ru-RU,ru;q=0.9,en;q=0.6';
      const cookie = this._cookieHeader(current);
      if (cookie) headers.Cookie = cookie;
      const init = { redirect: 'manual', headers, signal: AbortSignal.timeout(this.timeout) };
      if (reqOpts && reqOpts.method) init.method = reqOpts.method;
      if (reqOpts && reqOpts.body != null) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
        init.body = reqOpts.body;
      }
      const res = await fetch(current, init);
      this._storeCookies(current, res);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer(); // освобождаем сокет перед следующим hop
        current = this._safeUrl(String(new URL(loc, current)), false);
        continue;
      }
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      const raw = await res.text();
      if (raw.length > MAX_BODY_CHARS) throw new Error('response too large: ' + raw.length + ' chars');
      const body = asJson ? JSON.parse(raw) : raw;
      return { ok: true, status: res.status, body, hop };
    }
    const err = new Error('too many redirects');
    err.status = 0;
    throw err;
  }

  async getJson(url) { return this._get(url, true); }
  async getText(url) { return this._get(url, false); }
  async postJson(url, body) { return this._get(url, true, { method: 'POST', body: JSON.stringify(body) }); }

  async _get(url, asJson, reqOpts) {
    let lastErr = null;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const wait = this.minInterval - (Date.now() - this.last);
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        return await this._fetchOnce(url, asJson, reqOpts);
      } catch (e) {
        lastErr = e;
        if (e.status === 429) {
          const pause = this.backoff[Math.min(attempt, this.backoff.length - 1)];
          await sleep(pause);
          continue;
        }
        if (e.status && e.status !== 429) break;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') break;
        if (attempt < this.retries - 1) await sleep(2000 * (attempt + 1));
      }
    }
    return { ok: false, error: String((lastErr && lastErr.message) || lastErr || 'unknown'), status: lastErr && lastErr.status || 0 };
  }
}

module.exports = { ThrottledClient, sleep, UA, BROWSER_UA };
