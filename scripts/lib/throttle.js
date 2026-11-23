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

  async _fetchOnce(url, asJson) {
    let current = url;
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

      const res = await fetch(current, { redirect: 'manual', headers, signal: AbortSignal.timeout(this.timeout) });
      this._storeCookies(current, res);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer(); // освобождаем сокет перед следующим hop
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      const body = asJson ? await res.json() : await res.text();
      return { ok: true, status: res.status, body, hop };
    }
    const err = new Error('too many redirects');
    err.status = 0;
    throw err;
  }

  async getJson(url) { return this._get(url, true); }
  async getText(url) { return this._get(url, false); }

  async _get(url, asJson) {
    let lastErr = null;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const wait = this.minInterval - (Date.now() - this.last);
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        return await this._fetchOnce(url, asJson);
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
