#!/usr/bin/env node
/* Общий HTTP-клиент с ограничением частоты, ретраями и таймаутом. */
'use strict';

const UA = 'EnergoRegistry/1.9 (+https://github.com/alexsmy/energo)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class ThrottledClient {
  constructor(opts = {}) {
    this.minInterval = Math.max(0, opts.minInterval || 6500);
    this.timeout = opts.timeout || 25000;
    this.retries = opts.retries || 3;
    this.backoff = opts.backoff || [35000, 70000];
    this.ua = opts.ua || UA;
    this.last = 0;
  }

  async getJson(url) {
    return this._get(url, true);
  }

  async getText(url) {
    return this._get(url, false);
  }

  async _get(url, asJson) {
    let lastErr = null;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const wait = this.minInterval - (Date.now() - this.last);
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        const res = await fetch(url, {
          redirect: 'follow',
          headers: { 'User-Agent': this.ua, 'Accept': asJson ? 'application/json' : 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(this.timeout)
        });
        if (res.status === 429) {
          const pause = this.backoff[Math.min(attempt, this.backoff.length - 1)];
          const err = new Error('HTTP 429');
          err.status = 429;
          err.retryAfter = pause;
          lastErr = err;
          await sleep(pause);
          continue;
        }
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        const body = asJson ? await res.json() : await res.text();
        return { ok: true, status: res.status, body, attempt };
      } catch (e) {
        lastErr = e;
        if (e.status && e.status !== 429) break;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') break;
        if (attempt < this.retries - 1) await sleep(2000 * (attempt + 1));
      }
    }
    return { ok: false, error: String((lastErr && lastErr.message) || lastErr || 'unknown'), status: lastErr && lastErr.status || 0 };
  }
}

module.exports = { ThrottledClient, sleep, UA };
