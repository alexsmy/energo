/* Реестр РФ — клиентский сбор событий посещений.
 * Работает ТОЛЬКО на https://alexsmy.github.io/energo/index.html.
 * IP, страну, город и провайдера определяет сервер: браузер их не знает.
 *
 * Канал один: WordPress на nppuast.com (admin-ajax.php?action=energo_visit).
 * Никаких токенов в коде и в localStorage._endpoint берётся из data/visits-config.json.
 * Устойчивость: таймаут, чанкование ≤32 КБ, backoff и outbox в localStorage. */
(function () {
  'use strict';

  var PROD = /^https:\/\/alexsmy\.github\.io\/energo\/(?:index\.html)?(?:[?#]|$)/.test(location.href);
  if (!PROD) return;

  var endpoint = '';
  var timeoutMs = 5000;
  var enabled = false;
  var queue = [];
  var flushTimer = null;
  var retryDelay = 2000;
  var started = false;
  var flushing = false;
  var flushAgain = false;
  var outboxKey = 'energo-visit-outbox';
  var MAX_CHUNK_BYTES = 32 * 1024;
  var sessionId = readStore(sessionStorage, 'energo-visit-session') || uuid();
  var deviceId = readStore(localStorage, 'energo-visit-device') || uuid();
  try { sessionStorage.setItem('energo-visit-session', sessionId); localStorage.setItem('energo-visit-device', deviceId); } catch (e) {}
  var activeTab = null;
  var tabStart = 0;
  var maxScroll = {};
  var maxSeen = {};
  var searches = Object.create(null);
  var searchTimer = null;
  var hasInteracted = false;
  var isHeadless = !!(navigator.webdriver || document.documentElement.getAttribute('webdriver'));
  ['mousemove', 'touchstart', 'keydown', 'scroll', 'click'].forEach(function (evt) {
    window.addEventListener(evt, function () { hasInteracted = true; }, { passive: true, once: true });
  });

  /* Устойчивый аппаратный отпечаток: только стабильные признаки, без UA и размера экрана. */
  function fingerprint() {
    try {
      var parts = [];
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('energo', 2, 15);
        parts.push(canvas.toDataURL().slice(-120));
      }
      var gl = canvas.getContext('webgl');
      if (gl) {
        var info = gl.getExtension('WEBGL_debug_renderer_info');
        parts.push(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      }
      parts.push(navigator.hardwareConcurrency || '', navigator.deviceMemory || '',
        navigator.platform || '', (navigator.language || '').slice(0, 2), new Date().getTimezoneOffset());
      var raw = parts.join('|||');
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 32);
        }).catch(function () { return raw.length + '-' + raw.slice(0, 16); });
      }
      return Promise.resolve(raw.length + '-' + raw.slice(0, 16));
    } catch (e) { return Promise.resolve('fp-error'); }
  }

  function readStore(store, key) { try { return store.getItem(key) || ''; } catch (e) { return ''; } }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function now() { return new Date().toISOString(); }
  function bytes(str) {
    if (window.Blob) return new Blob([str]).size;
    return unescape(encodeURIComponent(str)).length;
  }

  /* Outbox переживает перезагрузку: сервер дедуплицирует по event_id (eid). */
  function loadOutbox() {
    try {
      var raw = localStorage.getItem(outboxKey);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.length) queue = saved.concat(queue).slice(-300);
      localStorage.removeItem(outboxKey);
    } catch (e) { try { localStorage.removeItem(outboxKey); } catch (e2) {} }
  }
  function saveOutbox(events) {
    try { localStorage.setItem(outboxKey, JSON.stringify((events || queue).slice(-300))); } catch (e) {}
  }

  function push(type, data) {
    if (!enabled) return;
    var ev = data || {};
    ev.type = type;
    ev.ts = now();
    ev.eid = uuid();
    ev.sessionId = sessionId;
    ev.deviceId = deviceId;
    queue.push(ev);
    if (queue.length >= 40) flush();
  }

  /* Разбиваем пачку так, чтобы каждое тело было <32 КБ (keepalive и лимит PHP). */
  function chunk(events) {
    var out = [];
    var cur = [];
    var size = 2;
    for (var i = 0; i < events.length; i++) {
      var s = bytes(JSON.stringify(events[i])) + 1;
      if (cur.length && size + s > MAX_CHUNK_BYTES) {
        out.push(cur); cur = []; size = 2;
      }
      cur.push(events[i]);
      size += s;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function sendOnce(url, body) {
    return new Promise(function (resolve, reject) {
      var controller = window.AbortController ? new AbortController() : null;
      var timer = null;
      var done = false;
      function finish(err) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err); else resolve();
      }
      // FormData (multipart/form-data) is always CORS-safelisted: no preflight.
      // Preflight OPTIONS on nppuast.com is blocked by nginx, so we must never trigger it.
      var form = new FormData();
      form.append('payload', body);
      var opts = {
        method: 'POST',
        body: form,
        keepalive: bytes(body) <= MAX_CHUNK_BYTES,
        mode: 'cors'
      };
      if (controller) {
        opts.signal = controller.signal;
        timer = setTimeout(function () { controller.abort(); finish(new Error('timeout')); }, timeoutMs);
      }
      fetch(url, opts).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        finish();
      }).catch(function (e) { finish(e); });
    });
  }

  function flush(unload) {
    if (!enabled || !endpoint || !queue.length) return;
    if (flushing) { flushAgain = true; return; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

    var all = queue.splice(0);
    var chunks = chunk(all);
    var remaining = all.slice();

    if (unload) {
      // confirmation нет — events остаются в outbox и уйдут при следующем заходе
      saveOutbox(remaining.concat(queue));
      for (var b = 0; b < chunks.length; b++) {
        try {
          var fd = new FormData();
          fd.append('payload', JSON.stringify({
            schema: 'energo-visits-v1', page: location.href, sentAt: now(), events: chunks[b]
          }));
          navigator.sendBeacon(endpoint, fd);
        } catch (e) {}
      }
      return;
    }

    flushing = true;
    saveOutbox(remaining.concat(queue));
    var attempt = function (i) {
      if (i >= chunks.length) {
        flushing = false;
        if (remaining.length) {
          queue = remaining.concat(queue).slice(0, 300);
          saveOutbox();
          retryDelay = Math.min(60000, retryDelay * 2);
          scheduleFlush();
        } else {
          retryDelay = 2000;
          saveOutbox();
          if (flushAgain) { flushAgain = false; flush(); }
        }
        return;
      }
      var part = chunks[i];
      var body = JSON.stringify({ schema: 'energo-visits-v1', page: location.href, sentAt: now(), events: part });
      sendOnce(endpoint, body).then(function () {
        var ids = {};
        for (var k = 0; k < part.length; k++) ids[part[k].eid] = 1;
        remaining = remaining.filter(function (ev) { return !ids[ev.eid]; });
        saveOutbox(remaining.concat(queue));
        attempt(i + 1);
      }).catch(function () { attempt(i + 1); });
    };
    attempt(0);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; flush(); }, retryDelay);
  }

  /* ---------- устройство / браузер / сеть ---------- */
  function browserOf(ua) {
    if (/YaBrowser/i.test(ua)) return 'Яндекс.Браузер';
    if (/OPR\/|Opera/i.test(ua)) return 'Opera';
    if (/Edg\//i.test(ua)) return 'Microsoft Edge';
    if (/amsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Chrome\/|CriOS/i.test(ua)) return 'Chrome';
    if (/Version\/.*Safari/i.test(ua)) return 'Safari';
    return 'не определён';
  }
  function osOf(ua) {
    if (/Windows NT 10\.0/i.test(ua)) return 'Windows 10/11';
    if (/Windows NT 6\.3/i.test(ua)) return 'Windows 8.1';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/CrOS/i.test(ua)) return 'ChromeOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'не определён';
  }
  function deviceOf(ua, w) {
    if (/iPad|Tablet|Nexus (7|9|10)/i.test(ua) || (w > 560 && w <= 1024 && /Android/i.test(ua))) return 'планшет';
    if (/Mobi|iPhone|Android/i.test(ua) || w <= 560) return 'мобильный';
    return 'десктоп';
  }
  function deviceInfo() {
    var ua = navigator.userAgent || '';
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    return {
      userAgent: ua,
      browser: browserOf(ua),
      os: osOf(ua),
      device: deviceOf(ua, innerWidth),
      screen: {
        width: screen.width || 0, height: screen.height || 0,
        availWidth: screen.availWidth || 0, availHeight: screen.availHeight || 0,
        innerWidth: innerWidth, innerHeight: innerHeight,
        dpr: window.devicePixelRatio || 1,
        orientation: (screen.orientation && screen.orientation.type) || ''
      },
      network: {
        effectiveType: c.effectiveType || '', downlink: c.downlink || null,
        rtt: c.rtt || null, saveData: !!(c.saveData)
      },
      language: navigator.language || '',
      timezoneOffset: new Date().getTimezoneOffset(),
      referrer: document.referrer || '',
      utm: (function () {
        var p = new URLSearchParams(location.search);
        return { source: p.get('utm_source') || '', medium: p.get('utm_medium') || '', campaign: p.get('utm_campaign') || '' };
      })(),
      hasInteracted: hasInteracted,
      isHeadless: isHeadless
    };
  }

  /* ---------- вкладки, скролл, карточки, поиск ---------- */
  function currentTab() {
    if (document.body.classList.contains('is-tenders')) {
      var pane = document.querySelector('.t-tab.is-active');
      var view = document.querySelector('[data-tcards].is-active, [data-view].is-active');
      return 'tenders' + (pane && pane.dataset.tview && pane.dataset.tview !== 'tenders' ? ':' + pane.dataset.tview : '') +
        (view ? ':' + (view.dataset.tcards || view.dataset.view) : '');
    }
    if (document.body.classList.contains('is-map')) return 'map';
    return 'registry' + (document.querySelector('[data-view].is-active') && document.querySelector('[data-view].is-active').dataset.view === 'table' ? ':table' : '');
  }
  function scrollPct() {
    var doc = document.documentElement;
    var max = Math.max(1, (doc.scrollHeight || document.body.scrollHeight) - innerHeight);
    return Math.max(0, Math.min(100, Math.round((scrollY || pageYOffset) / max * 100)));
  }
  function tabClose() {
    if (!activeTab || !tabStart) return;
    var dur = Math.max(0, Math.round((Date.now() - tabStart) / 100) / 10);
    push('tab', { tab: activeTab, action: 'close', seconds: dur, maxScroll: maxScroll[activeTab] || 0,
      seenPct: maxSeen[activeTab] || 0 });
    activeTab = null; tabStart = 0;
  }
  function tabOpen() {
    var t = currentTab();
    if (t === activeTab) return;
    tabClose();
    activeTab = t;
    tabStart = Date.now();
    maxScroll[t] = maxScroll[t] || 0;
    maxSeen[t] = maxSeen[t] || 0;
    push('tab', { tab: t, action: 'open' });
  }
  var scrollQueued = false;
  window.addEventListener('scroll', function () {
    if (scrollQueued || !activeTab) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      var p = scrollPct();
      var doc = document.documentElement;
      var total = Math.max(1, doc.scrollHeight || document.body.scrollHeight);
      var seen = Math.min(100, Math.round((scrollY + innerHeight) / total * 100));
      if (p > (maxScroll[activeTab] || 0) || seen > (maxSeen[activeTab] || 0)) {
        maxScroll[activeTab] = Math.max(p, maxScroll[activeTab] || 0);
        maxSeen[activeTab] = Math.max(seen, maxSeen[activeTab] || 0);
        scheduleFlush();
      }
    });
  }, { passive: true });

  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      push('click', { kind: 'tab', label: tabBtn.dataset.tab || '', tab: activeTab });
      tabOpen(); return;
    }
    var pane = e.target.closest('[data-tview], [data-tcards], [data-view], [data-tmode]');
    if (pane) {
      push('click', { kind: 'button', label: pane.dataset.tview || pane.dataset.tcards || pane.dataset.view || pane.dataset.tmode || '', tab: activeTab });
      tabOpen(); return;
    }
    var kw = e.target.closest('[data-kw]');
    if (kw) {
      var label = (kw.textContent || '').trim();
      var kind = kw.classList.contains('t-chip--composite') ? 'composite' : (kw.classList.contains('t-chip--base') || kw.classList.contains('t-chip--all') ? 'base' : 'other');
      if (label) { push('search', { source: 'chip', query: label, kind: kind, tab: activeTab }); scheduleFlush(); }
      return;
    }
    var btn = e.target.closest('#filterToggle, #tFilterToggle, #tReset, #exportBtn, #resetBtn, #tOpenSearch, #tSort, #sort');
    if (btn) {
      push('click', { kind: 'button', label: btn.id, tab: activeTab });
      scheduleFlush(); return;
    }
    var org = e.target.closest('[data-open-id], #cards .card[data-id]');
    if (org) {
      push('click', { kind: 'org_card', id: org.dataset.openId || org.dataset.id || '', tab: activeTab });
      scheduleFlush(); return;
    }
    var tender = e.target.closest('#tCards .t-card[data-id], #tTbody tr[data-id]');
    if (tender) {
      push('click', { kind: 'tender_card', id: tender.dataset.id || '', tab: activeTab });
      scheduleFlush(); return;
    }
    var link = e.target.closest('a[href]');
    if (link) {
      var href = link.getAttribute('href') || '';
      var linkKind = /^tel:/i.test(href) ? 'tel' : /^mailto:/i.test(href) ? 'mailto'
        : /(registry\.csv|registry\.json|\.pdf|print\.html)/i.test(href) ? 'download'
        : /^https?:\/\//i.test(href) && link.hostname !== location.hostname ? 'external' : '';
      if (linkKind) { push('link', { kind: linkKind, href: href.slice(0, 200), tab: activeTab }); scheduleFlush(); }
    }
    var marker = e.target.closest('.leaflet-marker-icon');
    if (marker) { push('click', { kind: 'map_marker', id: marker.dataset.id || '', tab: activeTab }); scheduleFlush(); }
  }, true);

  function trackInput(e) {
    var el = e.target;
    if (el.id !== 'q' && el.id !== 'tQ') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var q = (el.value || '').trim();
      if (q.length < 2) return;
      var key = el.id + ':' + q.toLowerCase();
      if (searches[key]) return;
      searches[key] = 1;
      push('search', { source: 'typed', query: q.slice(0, 120), field: el.id, tab: activeTab });
      scheduleFlush();
    }, 900);
  }
  document.addEventListener('input', trackInput, true);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      tabClose();   // время в фоне не считаем как активное
      flush(true);
    } else {
      tabOpen();
    }
  });
  window.addEventListener('pagehide', function () { tabClose(); flush(true); });

  /* ---------- запуск ---------- */
  function start() {
    if (started || !enabled || !endpoint) return;
    started = true;
    loadOutbox();
    tabOpen();
    setInterval(function () { if (!document.hidden) flush(); }, 30000);
    setInterval(function () {
      if (document.hidden || !activeTab) return;
      push('heartbeat', { tab: activeTab });
      scheduleFlush();
    }, 60000);
    // Сессию отправляем сразу, не дожидаясь отпечатка.
    push('session', deviceInfo());
    scheduleFlush();
    fingerprint().then(function (hardId) {
      if (hardId) { push('fingerprint', { hardId: hardId }); scheduleFlush(); }
    });
  }

  fetch('data/visits-config.json?ts=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) {
      if (!c || c.enabled === false) return;
      var list = Array.isArray(c.endpoints) ? c.endpoints.slice() : (c.endpoint ? [c.endpoint] : []);
      // Адрес приёма событий берётся ТОЛЬКО из конфига на нашем домене.
      // Оверрайд через query-параметр удалён: он позволял перенаправить
      // телеметрию посетителей на произвольный сервер по ссылке извне.
      endpoint = String(list[0] || '').trim();
      timeoutMs = Number(c.timeoutMs) || 5000;
      if (!/^https?:\/\//i.test(endpoint)) return;
      enabled = true;
      start();
    })
    .catch(function () { /* конфиг недоступен — сбор выключен */ });
})();
