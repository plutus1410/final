/* ============================================================
   PLUTUS — UI, data fetching, routing, charts
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const A = window.Analysis;
  const { fmtMoney, fmtPrice, fmtPct, fmtX, isNum } = A;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;
  const CMP_KEY = 'plutus.compare.v1'; // remembers the "Compare with industry average" switch
  const loadCmpPref = () => { try { return localStorage.getItem(CMP_KEY) === '1'; } catch (e) { return false; } };
  const state = { charts: [], lastHits: {}, model: null, ind: null, peerCmp: null, indStatus: 'loading', cmp: loadCmpPref(), holders: undefined, govx: undefined, priceMax: {}, kpiInfo: {},
    kpiTab: 0, shp: null, shpStatus: '', tradesOpen: false };

  /* ---------- tiny line icons (24×24, drawn with the current text colour) ---------- */
  const IC = {
    avg: '<path d="M5.5 20v-8M12 20V4M18.5 20v-11" stroke-width="3" opacity=".55"/><path d="M2 13h20" stroke-width="1.8"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    dn: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    eq: '<path d="M6 9h12M6 15h12"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    landmark: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/>',
    scale: '<path d="M12 4v16M7 20h10M4 8h16"/><path d="M4 8l-2.5 6a2.5 2.5 0 0 0 5 0zM20 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
    percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="17" r="2.4"/>',
    range: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
    pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    drop: '<path d="M12 3s6.5 6.5 6.5 11.2A6.5 6.5 0 0 1 5.5 14.2C5.5 9.5 12 3 12 3z"/>',
    waves: '<path d="M3 8c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/><path d="M3 16c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    sprout: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z"/><path d="M12 16c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/>',
    anchor: '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21M8 12h8M5 12H3a9 9 0 0 0 18 0h-2"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5"/>'
  };
  const ico = (k, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${IC[k] || ''}</svg>`;
  const KPI_ICON = { rev: 'banknote', ni: 'wallet', nm: 'pie', eps: 'hash', pe: 'scale', dy: 'percent', r1: 'trend', roe: 'repeat', de: 'card', eqa: 'shield', cr: 'drop', fcf: 'waves', vol: 'pulse' };
  const PILLAR_ICON = { growth: 'sprout', profit: 'wallet', strength: 'shield', value: 'tag', stability: 'anchor', track: 'award' };
  // label row of a headline-strip cell: icon · short label
  const stripK = (icon, label) => `<div class="k">${ico(icon)}<span>${label}</span></div>`;
  // the line under a headline number that shows the industry average when the comparison is on
  const stripInd = (key) => `<div class="sl cmpc" data-ind="${key}" data-t="sline"></div>`;

  /* ====================== DATA LAYER ====================== */
  const YH = 'https://query2.finance.yahoo.com';
  const YH1 = 'https://query1.finance.yahoo.com';
  const ttl = (CFG.CACHE_MINUTES || 15) * 60e3;
  // anyAge: also accept an expired copy (used only when the live request has failed)
  function cacheGet(k, anyAge) {
    try { const x = JSON.parse(sessionStorage.getItem(k)); if (x && (anyAge || Date.now() - x.t < ttl)) return x.d; } catch (e) { /* ignore */ }
    return null;
  }
  function cacheSet(k, d) {
    const v = JSON.stringify({ t: Date.now(), d });
    try { sessionStorage.setItem(k, v); } catch (e) {
      // storage full (peer statements are large): drop the oldest half of the Yahoo copies and try once more
      try {
        const old = Object.keys(sessionStorage).filter((x) => /^y[fp]:/.test(x))
          .map((x) => { let t = 0; try { t = JSON.parse(sessionStorage.getItem(x)).t || 0; } catch (er) { /* broken entry */ } return [x, t]; })
          .sort((a, b) => a[1] - b[1]);
        old.slice(0, Math.ceil(old.length / 2)).forEach(([x]) => sessionStorage.removeItem(x));
        sessionStorage.setItem(k, v);
      } catch (er) { /* still full: just not cached */ }
    }
  }

  /* ---- request queue + retries ----
     One dashboard fires a burst of requests: its own data, then shareholding, then up to ~40 for the industry peers (and the news
     sidebar adds its own). Yahoo answers such bursts with "429 Too Many Requests" or brief 5xx errors even when the visitor's
     connection is fine — that, plus a single quick retry, was what produced most "Signal lost" screens. So:
       • at most MAX_INFLIGHT requests run at once, and higher-priority ones (search, the stock being opened) jump the queue
         ahead of background peer lookups;
       • background requests for a stock the visitor has already left are dropped instead of competing with the new one;
       • a failed request is retried with growing, jittered waits (honouring Retry-After), alternating Yahoo's twin hosts;
       • if every try fails, an older copy from this tab's cache is used before giving up. */
  const PRIO = { bg: 0, side: 1, main: 2, search: 3 };
  const MAX_INFLIGHT = 6;
  let inflight = 0; const waiting = [];
  function acquire(prio) {
    if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); }
    return new Promise((go) => {
      let i = waiting.length; while (i > 0 && waiting[i - 1].prio < prio) i--; // first in, first out within a priority
      waiting.splice(i, 0, { prio, go });
    });
  }
  function release() { const n = waiting.shift(); if (n) n.go(); else inflight--; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const otherHost = (u) => (u.includes('://query2.finance.yahoo.com/') ? u.replace('://query2.', '://query1.') : u.replace('://query1.', '://query2.'));
  const transient = (e) => !!e && (e.retry || e.name === 'AbortError' || e instanceof TypeError || e instanceof SyntaxError);
  const backoff = (attempt, retryAfter) => (retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : Math.min(8000, 900 * 2 ** attempt) + Math.random() * 500);
  const workerBase = () => (CFG.WORKER_URL || '').replace(/\/+$/, '');
  // Plain-English reason for the error screen / search box (e.status keeps the code for logic)
  function explain(e) {
    if (!e) return 'Unknown error.';
    if (e.cancelled) return e.message;
    if (e.status === 429) return 'The data service is busy right now (too many requests at once).';
    if (e.status === 404) return 'Not found on Yahoo Finance (HTTP 404).';
    if (e.status >= 500) return `The data service had a temporary problem (HTTP ${e.status}).`;
    if (e.status) return `The data service refused the request (HTTP ${e.status}).`;
    if (e.name === 'AbortError') return 'The data service took too long to answer.';
    if (e instanceof SyntaxError) return 'The data service sent back an unreadable answer.';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You appear to be offline.';
    return 'Couldn’t reach the data service.';
  }
  // one HTTP call with a timeout; throws an Error carrying .status / .retry / .retryAfter
  async function fetchJSON(url, init, attempt) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (CFG.REQUEST_TIMEOUT_MS || 15000) + Math.min(2, attempt || 0) * 7000); // v12: 15 s, then 22 s, 29 s
    try {
      const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
      if (!res.ok) {
        const er = new Error('HTTP ' + res.status);
        er.status = res.status; er.retry = res.status === 429 || res.status >= 500;
        er.retryAfter = parseFloat(res.headers.get('Retry-After')) || 0;
        throw er;
      }
      return await res.json();
    } finally { clearTimeout(timer); }
  }
  // o: { prio, my, tries } — `my` ties a background request to the dashboard that asked for it (see loadSeq)
  async function yrequest(url, o, post) {
    o = o || {};
    const key = post ? 'yp:' + url + post : 'yf:' + url;
    const hit = cacheGet(key); if (hit) return hit;
    const prio = o.prio == null ? PRIO.main : o.prio;
    const tries = o.tries || (prio >= PRIO.main ? 4 : 3);
    let lastErr = new Error('No proxy configured');
    for (let attempt = 0; attempt < tries; attempt++) {
      if (o.my != null && o.my !== loadSeq) { const er = new Error('Cancelled — another stock was opened'); er.cancelled = true; throw er; }
      let u = attempt % 2 ? otherHost(url) : url;
      // Older Workers sent every edge-cache hit with a broken CORS header ("*, *"), which the browser reports as a network
      // error (TypeError). A throw-away parameter makes the retry miss that cache entry; Yahoo ignores it.
      if (!post && attempt > 0 && lastErr instanceof TypeError) u += (u.includes('?') ? '&' : '?') + '_pb=' + Date.now().toString(36);
      const routes = post
        ? (workerBase() ? [workerBase() + '/?url=' + encodeURIComponent(u)] : [])
        : workerBase() ? [workerBase() + '/?url=' + encodeURIComponent(u)] : (CFG.PUBLIC_PROXIES || []).map((p) => p + encodeURIComponent(u));
      if (!routes.length) throw new Error(post ? 'POST needs the Worker' : 'No proxy configured');
      await acquire(prio);
      try {
        for (const r of routes) {
          try {
            const data = await fetchJSON(r, post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: post } : null, attempt);
            if (!post && !okPayload(data)) { const er = new Error('empty answer'); er.retry = true; throw er; } // v12: Yahoo's "no result" hiccups
            cacheSet(key, data);
            return data;
          } catch (e) { lastErr = e; if (!transient(e)) throw e; }
        }
      } catch (e) { lastErr = e; break; } finally { release(); }
      if (attempt < tries - 1) await sleep(backoff(attempt, lastErr.retryAfter));
    }
    const old = cacheGet(key, true); // stale copy beats an error screen
    if (old) { console.info('[PLUTUS] using an older cached copy:', url, lastErr.message); return old; }
    // v12: the Worker kept failing (busy, or Cloudflare hiccup): try the public proxies once before giving up
    if (!post && workerBase() && transient(lastErr) && (CFG.PUBLIC_PROXIES || []).length && !(o.my != null && o.my !== loadSeq)) {
      for (const p of CFG.PUBLIC_PROXIES) {
        await acquire(prio);
        try { const data = await fetchJSON(p + encodeURIComponent(url), null, 1); if (okPayload(data)) { cacheSet(key, data); return data; } }
        catch (e) { /* next proxy */ } finally { release(); }
      }
    }
    lastErr.message = explain(lastErr);
    throw lastErr;
  }
  // v12: Yahoo sometimes answers 200 with an empty / error body ({"chart":{"result":null,"error":…}}); that is retried like a 5xx
  function okPayload(d) {
    if (!d || typeof d !== 'object') return false;
    const top = d.chart || d.quoteSummary || d.timeseries;
    if (top && top.error && !top.result) return !!(top.error.code && /not found/i.test(String(top.error.code + top.error.description))); // a real "not found" is final
    if (top && top.result === null) return false;
    return true;
  }
  const yfetch = (url, o) => yrequest(url, o);
  // POST (only the Worker supports it; used for the industry screener)
  const ypost = (url, body, o) => yrequest(url, o, JSON.stringify(body));
  const Yahoo = {
    // region 'IN' or 'US'. Yahoo answers at most ~7 matches per query and the India region often fills them with mutual
    // funds (it returned no share listing at all for "wells fargo"), so search asks both regions and merges (see SEARCH).
    search: (q, region) => yfetch(`${YH}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=true&region=${region === 'US' ? 'US&lang=en-US' : 'IN&lang=en-IN'}`, { prio: PRIO.search, tries: 2 }),
    recs: (s, o) => yfetch(`${YH}/v6/finance/recommendationsbysymbol/${encodeURIComponent(s)}`, o),
    chart: (s, range, interval, o) => yfetch(`${YH}/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`, o),
    timeseries: (s, o) => {
      const day = 86400;
      const p2 = Math.floor(Date.now() / 1000 / day) * day + day;
      const p1 = p2 - 10 * 365 * day;
      return yfetch(`${YH}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(s)}?symbol=${encodeURIComponent(s)}&type=${A.TIMESERIES_TYPES.join(',')}&period1=${p1}&period2=${p2}&merge=false`, o);
    },
    summary: (s, o) => yfetch(`${YH}/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,assetProfile`, o),
    holders: (s, o) => yfetch(`${YH}/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=majorHoldersBreakdown,institutionOwnership,fundOwnership,netSharePurchaseActivity`, o),
    // Corporate Governance: insider trades + insiders' own holdings (officers and ISS risk scores come with assetProfile in `summary`)
    insiders: (s, o) => yfetch(`${YH}/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=insiderTransactions,insiderHolders`, o),
    profile: (s, o) => yfetch(`${YH}/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=assetProfile`, o),
    industry: (key, o) => yfetch(`${YH}/v1/finance/industries/${encodeURIComponent(key)}?formatted=true&withReturns=false&lang=en-US&region=US`, o),
    screener: (body, o) => ypost(`${YH1}/v1/finance/screener?formatted=false&useRecordsResponse=false&lang=en-US&region=US&corsDomain=finance.yahoo.com`, body, o)
  };
  const bg = (my) => ({ prio: PRIO.bg, my }); // background lookups for the stock opened as `my`

  // Run fn over items with limited concurrency; never throws (each slot is {ok, v|e})
  async function pool(items, limit, fn) {
    const out = new Array(items.length); let i = 0;
    const run = async () => {
      while (i < items.length) {
        const k = i++;
        try { out[k] = { ok: true, v: await fn(items[k], k) }; } catch (e) { out[k] = { ok: false, e }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return out;
  }

    /* ====================== COMPANY LOGOS ====================== */
  const LOGO_TEMPLATES = (() => {
    const t = [], k = CFG.LOGODEV_KEY;
    if (k) {
      t.push('https://img.logo.dev/ticker/{symbol}?token=' + encodeURIComponent(k) + '&size=128&format=png&fallback=404');
      t.push('https://img.logo.dev/{domain}?token=' + encodeURIComponent(k) + '&size=128&format=png&fallback=404');
    }
    return t.concat((CFG.LOGO_SOURCES && CFG.LOGO_SOURCES.length) ? CFG.LOGO_SOURCES : [
      'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://{domain}&size=128',
      'https://icons.duckduckgo.com/ip3/{domain}.ico'
    ]);
  })();
  const logoCandidates = (d, s) => LOGO_TEMPLATES
    .filter((t) => (d || !t.includes('{domain}')) && (s || !t.includes('{symbol}')))
    .map((t) => t.replace('{domain}', encodeURIComponent(d || '')).replace('{symbol}', encodeURIComponent(s || '')));
  const domainOf = (url) => {
    if (!url) return '';
    try { return new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  };
  const initials = (name) => {
    const w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
  };
  function logoHTML(domain, name, size, sym) {
    const c = logoCandidates(domain, sym);
    return `<span class="logo ${size || ''} ${c.length ? '' : 'nologo'}" data-d="${esc(domain || '')}" data-s="${esc(sym || '')}" data-n="0">${c.length ? `<img src="${esc(c[0])}" alt="" loading="lazy" decoding="async">` : ''}<b>${esc(initials(name))}</b></span>`;
  }
  function applyLogo(wrap, domain) {
    if (!wrap || !domain) return;
    wrap.dataset.d = domain;
    if (!wrap.classList.contains('nologo') && wrap.querySelector('img')) return;
    const c = logoCandidates(domain, wrap.dataset.s); if (!c.length) return;
    wrap.dataset.n = '0'; wrap.classList.remove('nologo');
    let img = wrap.querySelector('img');
    if (!img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; wrap.insertBefore(img, wrap.firstChild); }
    img.src = c[0];
  }
  function logoFail(img) {
    const w = img.closest && img.closest('.logo'); if (!w) return;
    const n = (+w.dataset.n || 0) + 1; w.dataset.n = String(n);
    const c = logoCandidates(w.dataset.d, w.dataset.s);
    if (c[n]) img.src = c[n]; else w.classList.add('nologo');
  }
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) logoFail(e.target); }, true);
  document.addEventListener('load', (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.closest('.logo') && t.naturalWidth && t.naturalWidth < 8) logoFail(t); }, true);
  if (CFG.LOGODEV_KEY) document.addEventListener('DOMContentLoaded', () => {
    const f = document.querySelector('.foot');
    if (f) f.insertAdjacentHTML('beforeend', '<p style="margin-top:8px"><a href="https://logo.dev" target="_blank" rel="noopener" style="color:inherit">Logos provided by Logo.dev</a></p>');
  });

  // Company website domains: a few well-known seeds, then looked up from Yahoo and remembered
  const SEED_DOMAINS = { 'RELIANCE.NS': 'ril.com', 'TCS.NS': 'tcs.com', 'HDFCBANK.NS': 'hdfcbank.com', 'INFY.NS': 'infosys.com', 'TATAMOTORS.NS': 'tatamotors.com', 'ITC.NS': 'itcportal.com', AAPL: 'apple.com', MSFT: 'microsoft.com', NVDA: 'nvidia.com' };
  const DOM_KEY = 'plutus:dom';
  const domCache = (() => { try { return JSON.parse(localStorage.getItem(DOM_KEY)) || {}; } catch (e) { return {}; } })();
  function saveDom(sym, d) { domCache[sym] = d; try { localStorage.setItem(DOM_KEY, JSON.stringify(domCache)); } catch (e) { /* ignore */ } }
  function knownDomain(it) {
    if (it.domain != null) return it.domain;
    if (SEED_DOMAINS[it.symbol]) return SEED_DOMAINS[it.symbol];
    if (domCache[it.symbol] !== undefined) return domCache[it.symbol];
    return null; // unknown yet
  }
  const domInflight = {};
  function resolveDomain(sym) {
    if (domInflight[sym]) return domInflight[sym];
    domInflight[sym] = (async () => {
      try {
        const S = A.parseSummary(await Yahoo.profile(sym, { prio: PRIO.side }));
        const d = domainOf(S.assetProfile && S.assetProfile.website);
        saveDom(sym, d);
        return d;
      } catch (e) { return ''; } finally { delete domInflight[sym]; }
    })();
    return domInflight[sym];
  }
  let domQueue = 0; const domWaiters = [];
  async function limitedResolve(sym) {
    if (domQueue >= 4) await new Promise((r) => domWaiters.push(r));
    domQueue++;
    try { return await resolveDomain(sym); } finally { domQueue--; const n = domWaiters.shift(); if (n) n(); }
  }

  /* ====================== SEARCH (company name — complete or partial, typo-tolerant) ======================
     Why companies used to go missing: Yahoo's search returns at most ~7 matches per query, and with the India region
     it often fills them with mutual funds — "wells fargo" returned seven Wells Fargo funds and no share listing at
     all, so after keeping only shares the list was empty. Now:
       • each query goes to Yahoo twice in parallel (India region + US region) and the answers are merged;
       • a built-in list of popular Indian and US companies (js/companies.js) answers instantly, before Yahoo replies,
         and knows short names, brands and old names (SBI, HUL, L&T, Amex, Zomato → Eternal);
       • results are ranked by our own name matching: complete name, start of the name, start of each word
         ("wel far"), words typed together ("wellsfargo"), initials ("tcs", "sbi"), small typos ("relaince",
         "wels fargo"), and the exact ticker ("wfc") as a fallback;
       • the list updates as you type without ever going blank: every company seen so far is re-ranked on each key
         press, and Yahoo's answers slot in when they arrive. Indian listings (NSE, then BSE) still come first among
         equally good matches; preference shares, warrants and funds sink to the bottom. */
  const RECENT_KEY = 'plutus:recent';
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } };
  const pushRecent = (it) => {
    const r = getRecent().filter((x) => x.symbol !== it.symbol);
    const d = knownDomain(it);
    r.unshift({ symbol: it.symbol, name: it.name, short: it.short || '', exch: it.exch || '', sector: it.sector || '', industry: it.industry || '', domain: d == null ? undefined : d });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6))); } catch (e) { /* ignore */ }
  };
  const isIndian = (sym) => /\.(NS|BO)$/.test(sym || '');

  // Yahoo sometimes sends names with HTML entities ("JPMorgan Chase &amp; Co.")
  const decodeEnt = (s) => String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|apos|#39|#x27);/gi, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" }[k.toLowerCase()]));
  // Normalise a company name (or the typed query) so "Tata Motors Ltd.", "tata motors" and "TATA-MOTORS" compare cleanly
  const LEGAL = /\b(limited|ltd|inc|incorporated|corp|corporation|co|company|plc|ag|nv|sa|llc|lp|pvt|private)\b/g;
  const norm = (s) => {
    const t = decodeEnt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/['’`.]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const u = t.replace(LEGAL, ' ').replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();
    return u || t;
  };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // bold the parts of the name that match what was typed (word starts only)
  function highlight(text, q) {
    const raw = decodeEnt(text);
    const toks = [...new Set(norm(q).split(' ').filter(Boolean))].sort((a, b) => b.length - a.length).map(escRe);
    if (!toks.length) return esc(raw);
    const re = new RegExp('(^|[^A-Za-z0-9])(' + toks.join('|') + ')', 'ig');
    let out = '', i = 0, m;
    while ((m = re.exec(raw))) {
      const s = m.index + m[1].length;
      out += esc(raw.slice(i, s)) + '<mark>' + esc(m[2]) + '</mark>';
      i = s + m[2].length;
      if (!m[0].length) re.lastIndex++;
    }
    return out + esc(raw.slice(i));
  }

  /* ---------- name matching ---------- */
  const STOPQ = new Set(['and', 'of', 'the', 'a', 'an', 'for', 'in', 'de']);
  // edit distance with adjacent swaps ("relaince" → "reliance" = 1); gives up early above `max`
  function osa(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = null, p = Array.from({ length: lb + 1 }, (_, j) => j);
    for (let i = 1; i <= la; i++) {
      const c = [i]; let low = i;
      for (let j = 1; j <= lb; j++) {
        let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; if (v < low) low = v;
      }
      if (low > max) return max + 1;
      p2 = p; p = c;
    }
    return p[lb];
  }
  // one typed word vs one word of the name. `last`: the word still being typed (a prefix is a full match)
  function wordScore(t, w, last) {
    if (t === w) return 1;
    if (w.startsWith(t)) return last || t.length >= 3 ? 0.86 + 0.12 * (t.length / w.length) : 0.62;
    const ed = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0;
    if (ed) {
      const d = osa(t, w, ed);
      if (d <= ed) return 0.8 - 0.1 * d;                                   // whole word with a typo: "relaince", "wels"
      if (last && w.length > t.length) { const d2 = osa(t, w.slice(0, t.length), ed); if (d2 <= ed) return 0.7 - 0.1 * d2; } // typo while still typing
    }
    if (t.length >= 4 && w.includes(t)) return 0.6;                        // inside a word: "soft" in "microsoft"
    return 0;
  }
  // the whole query vs one normalised name; 0 = no match, 1 = identical
  function nameScore(q, f) {
    if (!q || !f) return 0;
    if (f === q) return 1;
    const qc = q.replace(/ /g, ''), fc = f.replace(/ /g, '');
    if (qc === fc) return 0.97;                                              // "wellsfargo" = "wells fargo"
    let best = 0;
    if (f.startsWith(q)) best = (f.length === q.length || f[q.length] === ' ' ? 0.95 : 0.88) + 0.04 * (q.length / f.length);
    else if (qc.length >= 3 && fc.startsWith(qc)) best = 0.86 + 0.05 * (qc.length / fc.length);
    // word by word, in any order: every typed word must match a word of the name
    const all = q.split(' '), qt = all.length > 1 ? all.filter((t) => !STOPQ.has(t)) : all, ft = f.split(' ');
    const used = new Set(); let sum = 0, inOrder = true, prev = -1, first = -1;
    for (let i = 0; i < qt.length; i++) {
      let b = 0, bi = -1;
      for (let j = 0; j < ft.length; j++) {
        if (used.has(j)) continue;
        const s = wordScore(qt[i], ft[j], i === qt.length - 1);
        if (s > b) { b = s; bi = j; if (s === 1) break; }
      }
      if (!b) { sum = 0; break; }
      sum += b; used.add(bi); if (bi < prev) inOrder = false; prev = bi; if (first < 0) first = bi;
    }
    if (sum && qt.length) best = Math.max(best, (sum / qt.length) * 0.84 + (inOrder ? 0.04 : 0) + (first === 0 ? 0.05 : 0) - 0.015 * Math.max(0, ft.length - used.size));
    // initials: "tcs" → Tata Consultancy Services, "sbi" → State Bank of India
    if (!q.includes(' ') && qc.length >= 2 && qc.length <= 6) {
      const ini = ft.filter((w) => !STOPQ.has(w)).map((w) => w[0]).join('');
      if (ini.length >= 2 && ini === qc) best = Math.max(best, 0.88);
      else if (qc.length >= 3 && ini.length > qc.length && ini.startsWith(qc)) best = Math.max(best, 0.66);
    }
    if (qc.length >= 4 && fc.includes(qc)) best = Math.max(best, 0.58);   // "fargo" in "wellsfargo…"
    return best;
  }
  const baseTicker = (sym) => String(sym || '').toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '');
  function candScore(c, q) {
    let s = Math.max(nameScore(q, c.n1), nameScore(q, c.n2) * 0.99);
    for (const a of c.al) s = Math.max(s, nameScore(q, a) * 0.98);
    const qc = q.replace(/ /g, '');
    if (qc.length >= 2 && baseTicker(c.symbol) === qc) s = Math.max(s, 0.86); // exact ticker ("wfc", "infy")
    else if (qc.length >= 4 && c.symbol.toLowerCase().replace(/[^a-z0-9]/g, '') === qc) s = Math.max(s, 0.9); // full symbol ("reliance.ns")
    return s;
  }
  // small nudges between equally good matches: home listings first, popular companies up, preference shares / funds down
  const PREF_RE = /-(P[A-Z]?|WT|WS|W|U|UN|R|RT|BL)(\.|$)/i; // preference shares, warrants, units, rights, block-deal windows
  function listingAdj(c) {
    const sym = c.symbol;
    let a = /\.NS$/.test(sym) ? 0.06 : /\.BO$/.test(sym) ? 0.035 : !sym.includes('.') ? 0.03 : 0;
    if (PREF_RE.test(sym) || /\b(preferred|depositary|warrants?|notes due|debentures?)\b/i.test(c.name)) a -= 0.2;
    if (/\b(etf|bees|fund|index fund)\b/i.test(c.name)) a -= 0.12;
    if (c.pop) a += 0.03;
    return a;
  }

  /* ---------- the pool of companies seen so far (built-in list + every Yahoo answer this visit) ---------- */
  const POOL = new Map();
  const exchOf = (sym) => (/\.NS$/.test(sym) ? 'NSE' : /\.BO$/.test(sym) ? 'BSE' : sym.includes('.') ? '' : 'US');
  function poolAdd(x, pop) {
    if (!x || !x.symbol) return null;
    const old = POOL.get(x.symbol);
    const name = decodeEnt(x.name || (old && old.name) || x.symbol), short = decodeEnt(x.short || (old && old.short) || '');
    const c = {
      symbol: x.symbol, name, short,
      exch: x.exch || (old && old.exch) || exchOf(x.symbol),
      sector: x.sector || (old && old.sector) || '', industry: x.industry || (old && old.industry) || '',
      al: old ? old.al : (x.al || []).map(norm).filter(Boolean),
      pop: !!(pop || (old && old.pop)), n1: norm(name), n2: short ? norm(short) : ''
    };
    POOL.set(x.symbol, c);
    return c;
  }
  (window.PLUTUS_COMPANIES || []).forEach((row) => {
    const [symbol, name, al] = String(row).split('|');
    poolAdd({ symbol, name, al: String(al || '').split(';').map((s) => s.trim()).filter(Boolean) }, true);
  });
  const fromYahoo = (data) => (data && data.quotes || [])
    .filter((x) => x.symbol && x.quoteType === 'EQUITY')
    .map((x) => poolAdd({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, short: x.shortname || '', exch: x.exchDisp || x.exchange || '', sector: x.sectorDisp || x.sector || '', industry: x.industryDisp || x.industry || '' }))
    .filter(Boolean);

  /* Rank the pool for a query. `related`: companies Yahoo returned for this exact query — shown after the real matches
     only when there are few of those (Yahoo knows some links our matcher can't, e.g. a brand name). */
  const MIN_SCORE = 0.5;
  function rankPool(query, related) {
    const q = norm(query);
    if (!q) return [];
    const scored = [];
    POOL.forEach((c) => { const s = candScore(c, q); if (s >= MIN_SCORE) scored.push({ c, s, r: s + listingAdj(c) }); });
    scored.sort((a, b) => b.r - a.r || a.c.name.length - b.c.name.length);
    if (scored.length < 4 && related && related.length) {
      const have = new Set(scored.map((x) => x.c.symbol));
      related.forEach((c, i) => { if (!have.has(c.symbol)) scored.push({ c, s: 0.3, r: 0.3 - i * 0.001, rel: true }); });
    }
    // one row per company (best listing first); a second listing of the same company (e.g. BSE next to NSE) only
    // after all the different companies, and only from a home market
    const seen = new Set(), main = [], alts = [];
    scored.forEach((x) => {
      const key = x.c.n1 || x.c.symbol;
      if (!seen.has(key)) { seen.add(key); main.push(x); }
      else if ((/\.(NS|BO)$/.test(x.c.symbol) || !x.c.symbol.includes('.')) && !PREF_RE.test(x.c.symbol)) alts.push(x);
    });
    return main.concat(alts).slice(0, 10).map((x) => x.c);
  }

  /* ---------- Yahoo lookups (both regions; cached per query for this visit) ---------- */
  const yCache = new Map(); // `${region}|${q}` → Promise<candidates[]>
  function ySearch(q, region) {
    const k = region + '|' + q.toLowerCase();
    if (!yCache.has(k)) {
      const p = Yahoo.search(q, region).then(fromYahoo);
      p.catch(() => yCache.delete(k)); // failures may be retried later
      yCache.set(k, p);
    }
    return yCache.get(k);
  }

  // onPick (optional): called with the chosen company instead of opening its dashboard (the Compare page uses it)
  function attachSearch(input, list, onPick) {
    let items = [], activeSym = null, timer = null, logoT = null, seq = 0, header = '', note = '', loading = false, pendingEnter = false, lastQ = '';
    const open = () => list.classList.add('open');
    const close = () => { list.classList.remove('open'); activeSym = null; pendingEnter = false; };
    const activeIdx = () => { const i = items.findIndex((x) => x.symbol === activeSym); return i; };

    function hydrateLogos() {
      clearTimeout(logoT);
      logoT = setTimeout(() => { // only once the list has settled, so typing doesn't fire a burst of profile lookups
        const snap = items;
        snap.forEach((it, i) => {
          if (knownDomain(it) !== null) return;
          limitedResolve(it.symbol).then((d) => {
            if (!d || snap !== items) return;
            it.domain = d;
            applyLogo(list.querySelector(`li[data-i="${i}"] .logo`), d);
          });
        });
      }, 450);
    }
    function render(q) {
      if (!items.length) {
        list.innerHTML = loading ? '<li class="s-info"><span class="s-spin" aria-hidden="true"></span>Searching markets…</li>'
          : `<li class="s-info">${note ? esc(note) : `No listed company matches “${esc(q)}”. Try the full company name, or check the spelling.`}</li>`;
        open(); return;
      }
      const head = header || loading || note
        ? `<li class="s-head"><span>${header || 'Best matches'}</span>${loading ? '<span class="s-load"><span class="s-spin" aria-hidden="true"></span>searching</span>' : note ? `<span class="s-note">${esc(note)}</span>` : ''}</li>` : '';
      list.innerHTML = head + items.map((it, i) => {
        const dom = knownDomain(it);
        return `<li role="option" data-i="${i}" class="${it.symbol === activeSym ? 'active' : ''}" aria-selected="${it.symbol === activeSym}">
           ${logoHTML(dom, it.name, 'md', it.symbol)}
           <span class="s-main">
             <span class="s-name">${highlight(it.name, q)}</span>
             <span class="s-sub">${isIndian(it.symbol) ? '<b class="in-tag">IN</b>' : ''}<span class="s-sym">${esc(it.symbol)}</span>${it.exch ? ' · ' + esc(it.exch) : ''}</span>
           </span>
         </li>`;
      }).join('');
      open();
      const a = list.querySelector('li.active'); if (a) a.scrollIntoView({ block: 'nearest' });
      hydrateLogos();
    }
    function setItems(next, q, keepActive) {
      items = next;
      if (!keepActive || !items.some((x) => x.symbol === activeSym)) activeSym = items.length ? items[0].symbol : null;
      render(q);
      if (pendingEnter && items.length && !loading) { pendingEnter = false; choose(0); }
    }
    function showRecent() {
      const r = getRecent();
      if (!r.length) return close();
      header = 'RECENT'; note = ''; loading = false;
      setItems(r, '', false);
    }
    // instant part: re-rank everything already known; then ask Yahoo (debounced) and merge its answers in
    function update(q) {
      const my = ++seq;
      header = ''; note = '';
      loading = true;
      setItems(rankPool(q), q, true);
      clearTimeout(timer);
      timer = setTimeout(() => fetchLive(q, my), 170);
    }
    async function fetchLive(q, my) {
      const related = [];
      let ok = 0, failed = null;
      const add = (cands) => { ok++; cands.forEach((c) => { if (!related.includes(c)) related.push(c); }); if (my === seq) setItems(rankPool(q, related), q, true); };
      await Promise.all(['IN', 'US'].map((r) => ySearch(q, r).then(add, (e) => { failed = e; })));
      if (my !== seq) return;
      // nothing good yet for a multi-word query (e.g. a typo in one word): search its longest word on its own
      const good = rankPool(q).filter((c) => candScore(c, norm(q)) >= 0.6).length;
      const words = norm(q).split(' ').filter((w) => w.length >= 4 && !STOPQ.has(w)).sort((a, b) => b.length - a.length);
      if (!good && words.length && norm(q).includes(' ')) {
        await ySearch(words[0], 'US').then(add, () => {});
        if (my !== seq) return;
      }
      loading = false;
      if (!ok && failed) note = items.length ? 'Live search is busy — showing known matches' : `${failed.message} Please try again in a moment.`;
      setItems(rankPool(q, related), q, true);
    }
    function choose(i) {
      const it = items[i]; if (!it) return;
      state.lastHits[it.symbol] = it; pushRecent(it);
      input.value = ''; close(); input.blur();
      if (onPick) { onPick(it); return; }
      location.hash = '#/s/' + encodeURIComponent(it.symbol);
    }
    input.addEventListener('input', () => {
      const q = input.value.trim();
      pendingEnter = false;
      if (!q) { seq++; clearTimeout(timer); lastQ = ''; return showRecent(); }
      if (norm(q) === norm(lastQ)) return; // only spacing / punctuation changed
      lastQ = q;
      update(q);
    });
    input.addEventListener('focus', () => { const q = input.value.trim(); if (!q) showRecent(); else if (items.length) render(q); });
    input.addEventListener('keydown', (e) => {
      const q = input.value.trim();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (items.length && list.classList.contains('open')) choose(Math.max(0, activeIdx()));
        else if (q) { pendingEnter = true; if (!list.classList.contains('open')) update(q); } // results still on their way: open the first one when they land
        return;
      }
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        const i = activeIdx(), n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        activeSym = items[n].symbol;
        list.querySelectorAll('li[data-i]').forEach((li) => { const on = +li.dataset.i === n; li.classList.toggle('active', on); li.setAttribute('aria-selected', on ? 'true' : 'false'); if (on) li.scrollIntoView({ block: 'nearest' }); });
      } else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
    list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('li[data-i]'); if (!li || li.classList.contains('active')) return;
      list.querySelectorAll('li.active').forEach((x) => x.classList.remove('active'));
      li.classList.add('active'); activeSym = (items[+li.dataset.i] || {}).symbol || activeSym;
    });
    document.addEventListener('click', (e) => { if (!list.contains(e.target) && e.target !== input) close(); });
  }
  // for quick checks in the browser console: PlutusSearch.rank('wels fargo')
  window.PlutusSearch = { rank: (q) => rankPool(q).map((c) => `${c.symbol}  ${c.name}  (${candScore(c, norm(q)).toFixed(2)})`), norm, pool: POOL };

  /* ====================== ROUTING ====================== */
  const HOME_TITLE = document.title; // the title in index.html
  function route() {
    const m = location.hash.match(/^#\/s\/(.+)$/);
    const cm = location.hash.match(/^#\/compare(?:\/(.*))?$/);
    if (cm) { // the stock comparison page (js/compare.js)
      loadSeq++; destroyCharts(); closeKpiPop();
      document.title = 'Compare stocks — PLUTUS';
      const syms = decodeURIComponent(cm[1] || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      const cmpChanged = !$('#viewCompare') || $('#viewCompare').classList.contains('hidden');
      showView('compare', !cmpChanged);
      if (window.PlutusCompare) window.PlutusCompare.show(syms);
      return;
    }
    if (m) { showView('dash'); loadDashboard(decodeURIComponent(m[1]).toUpperCase()); }
    else {
      loadSeq++; // a stock that is still loading must not re-title the home page when it finishes
      document.title = HOME_TITLE;
      showView('search'); if (!isMobile()) setTimeout(() => $('#mainSearch').focus(), 50);
    }
  }
  // keepScroll: re-showing the same view (e.g. a company added on the Compare page) keeps the scroll position
  function showView(v, keepScroll) {
    document.body.classList.toggle('on-home', v === 'search');   // v12: the big PLUTUS title replaces the small top-left brand on the home page
    $('#viewSearch').classList.toggle('hidden', v !== 'search');
    $('#viewDash').classList.toggle('hidden', v !== 'dash');
    if ($('#viewCompare')) $('#viewCompare').classList.toggle('hidden', v !== 'compare');
    $('#miniSearchWrap').classList.toggle('hidden', v !== 'dash' && v !== 'compare');
    $('#cmpBtn').classList.toggle('hidden', v !== 'dash');
    $('#topbar').classList.toggle('has-cmp', v === 'dash' || v === 'compare');
    if (!keepScroll) window.scrollTo(0, 0);
  }

  /* ====================== DASHBOARD ====================== */
  let loadSeq = 0;
  // round: 0 on a normal open; 1 for the automatic second attempt after a transient failure
  async function loadDashboard(symbol, round = 0) {
    const my = ++loadSeq;
    destroyCharts();
    state.ind = null; state.peerCmp = null; state.holders = undefined; state.govx = undefined; state.indStatus = 'loading'; updateCmpBtn();
    state.shp = null; state.shpStatus = /\.(NS|BO)$/i.test(symbol) ? 'loading' : 'na'; state.tradesOpen = false;
    closeKpiPop();
    $('#dashContent').classList.add('hidden'); $('#dashError').classList.add('hidden');
    $('#dashLoading').classList.remove('hidden'); $('#loadingSym').textContent = '· ' + symbol;
    $('#loadingMsg').textContent = round ? 'RE-ESTABLISHING LINK' : 'ACQUIRING TELEMETRY';
    document.title = symbol + ' — PLUTUS';
    const o = { prio: PRIO.main, my };
    const [c5, c1, ts, sum] = await Promise.allSettled([
      Yahoo.chart(symbol, '5y', '1wk', o), Yahoo.chart(symbol, '1y', '1d', o), Yahoo.timeseries(symbol, o), Yahoo.summary(symbol, o)
    ]);
    if (my !== loadSeq) return;
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const chartOk = (r) => { const v = val(r); return v && v.chart && v.chart.result && v.chart.result[0]; };
    if (!chartOk(c5) && !chartOk(c1)) {
      const err = [c1, c5].map((r) => (r.status === 'rejected' ? r.reason : null)).find(Boolean);
      if (!err || err.status === 404) { $('#dashLoading').classList.add('hidden'); return showError(symbol, 'Yahoo Finance has no price data for this symbol.', false); }
      // a busy / flaky data service usually recovers within seconds: two more full rounds before showing an error (v12)
      if (round < 2 && transient(err)) {
        $('#loadingMsg').textContent = round ? 'STILL TRYING · ALMOST THERE' : 'DATA SERVICE BUSY · RETRYING';
        await sleep(round ? 6000 : 3000);
        if (my !== loadSeq) return;
        return loadDashboard(symbol, round + 1);
      }
      $('#dashLoading').classList.add('hidden');
      return showError(symbol, err.message, true);
    }
    // v12: the price loaded but the financial statements or the company profile didn't (a busy moment at Yahoo) —
    // without them the page would wrongly say "no financial statements". Give the missing pieces one more go first.
    let tsR = ts, sumR = sum;
    const missed = (r) => r.status === 'rejected' && r.reason && r.reason.status !== 404 && !r.reason.cancelled;
    if (missed(ts) || missed(sum)) {
      $('#loadingMsg').textContent = 'FETCHING FINANCIAL STATEMENTS';
      await sleep(1500);
      if (my !== loadSeq) return;
      const o2 = { prio: PRIO.main, my, tries: 3 };
      [tsR, sumR] = await Promise.all([missed(ts) ? Promise.allSettled([Yahoo.timeseries(symbol, o2)]).then((x) => x[0]) : ts,
        missed(sum) ? Promise.allSettled([Yahoo.summary(symbol, o2)]).then((x) => x[0]) : sum]);
      if (my !== loadSeq) return;
    }
    $('#dashLoading').classList.add('hidden');
    let model;
    try { model = A.buildModel(symbol, val(c5), val(c1), val(tsR), val(sumR), state.lastHits[symbol]); }
    catch (e) { console.error(e); return showError(symbol, 'Could not process the data for this company.', false); }
    state.model = model;
    document.title = model.name + ' (' + symbol + ') — PLUTUS';
    // tell the other modules (the Ask Plutus panel shows the name in its header)
    window.__plutusCompany = { symbol, name: shortName(model.name) };
    try { window.dispatchEvent(new CustomEvent('plutus:company', { detail: window.__plutusCompany })); } catch (e) { /* very old browser */ }
    render(model, { summaryOk: !!val(sumR) && model.hasProfile });
    loadPeers(model, my);
    loadHolders(model, my);
    loadInsiders(model, my);
    loadShareholding(model, my);
    loadBizModel(model, my);
    // the full price history (monthly): all-time high / low, the 10-year price CAGR in Key Numbers, and the MAX share-price chart
    loadMaxPrice(model).then((pts) => { if (my === loadSeq) applyMaxStats(model, pts); }, () => {});
  }
  // canRetry: the failure was temporary (busy service, timeout, network) rather than "this symbol does not exist"
  function showError(symbol, reason, canRetry) {
    const el = $('#dashError');
    el.innerHTML = `<h2>${canRetry ? 'Signal lost' : 'No signal'}</h2><p>We couldn’t load data for <b>${esc(symbol)}</b>.<br>${esc(reason)}</p>
      ${canRetry ? '<p class="err-hint">Your internet is probably fine — Yahoo Finance sometimes limits requests for a short while. Trying again usually works.</p>' : ''}
      <div class="err-actions">${canRetry ? '<button type="button" class="primary" data-act="retry">↻ Try again</button>' : ''}<button type="button" data-act="home">← New search</button></div>`;
    el.classList.remove('hidden');
    const onIt = () => { const m = location.hash.match(/^#\/s\/(.+)$/); return !!m && decodeURIComponent(m[1]).toUpperCase() === symbol; };
    const again = () => { if (!el.classList.contains('hidden') && onIt()) loadDashboard(symbol); };
    el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.act === 'retry') again(); else location.hash = '#/'; }));
    if (canRetry && navigator.onLine === false) window.addEventListener('online', again, { once: true }); // back online: reload by itself
  }

  const colorFor = (s) => (s == null ? 'var(--dim)' : s >= 70 ? 'var(--good)' : s >= 45 ? 'var(--warn)' : 'var(--bad)');
  const signCls = (v) => (!isNum(v) ? 'muted' : v > 0 ? 'good' : v < 0 ? 'bad' : 'muted');

  /* ---------- industry-average comparison ---------- */
  // Every metric that is shown for the company is also computed (the same way) for its industry peers.
  const pillarScore = (m, k) => { const p = m.scores.pillars.find((x) => x.key === k); return p ? p.score : null; };
  const IND = {
    mc:  { get: (m) => m.marketCap, f: 'money', cur: 'px', better: null },
    rev: { get: (m) => m.revLast, f: 'money', cur: 'fin', better: null },
    ni:  { get: (m) => m.niLast, f: 'money', cur: 'fin', better: null },
    nm:  { get: (m) => m.netMargin, f: 'pct', better: 'high' },
    pe:  { get: (m) => (m.negEarnings ? null : A.validPe(m.pe)), f: 'x', better: 'low' },
    roe: { get: (m) => m.roe, f: 'pct', better: 'high' },
    de:  { get: (m) => (m.isFinancial ? null : m.de), f: 'x2', better: 'low', skipFin: true },
    eqa: { get: (m) => m.equityToAssets, f: 'pct', better: 'high' },
    fcf: { get: (m) => m.fcfLast, f: 'money', cur: 'fin', better: null },
    cr:  { get: (m) => (m.isFinancial ? null : m.currentRatio), f: 'x2', better: 'high', skipFin: true },
    eps: { noAvg: true },
    dy:  { get: (m) => m.divYield, f: 'pct2', better: 'high' },
    r1:  { get: (m) => m.ret1y, f: 'pct', better: 'high' },
    vol: { get: (m) => m.vol, f: 'pct', better: 'low' },
    pos: { get: (m) => m.pos52, f: 'pct0', better: null },
    overall: { get: (m) => m.scores.overall, f: 'pts', better: 'high' }
  };
  const specFor = (k) => (k.startsWith('p_') ? { get: (m) => pillarScore(m, k.slice(2)), f: 'pts', better: 'high' } : IND[k]);
  const allIndKeys = (m) => [...Object.keys(IND), ...m.scores.pillars.map((p) => 'p_' + p.key)];

  function fmtBy(spec, v, m) {
    switch (spec.f) {
      case 'money': return fmtMoney(v, spec.cur === 'px' ? m.currency : m.finCurrency);
      case 'pct': return fmtPct(v, 1);
      case 'pct2': return fmtPct(v, 2);
      case 'pct0': return fmtPct(v, 0);
      case 'x': return fmtX(v, 1);
      case 'x2': return fmtX(v, 2);
      case 'pts': return String(Math.round(v));
      default: return String(v);
    }
  }
  /* ---------- industry comparison ----------
     Industry averages are OFF by default. The "Compare with industry" switch in the top bar turns them on. Nothing is inserted into the page when it flips: every spot that can show
     a comparison already exists, with a fixed size, and just fades / swaps its content in place — "Industry avg …" plus a
     "▲ 9% higher" chip under the headline numbers and in each Key Number card, a chip on each Power Stat, a marker on its
     meter and on the score ring. */
  function cmpDelta(v, a, spec) {
    if (!isNum(v) || !isNum(a)) return null;
    const d = v - a, ad = Math.abs(d); let txt, tiny;
    if (spec.f === 'pct' || spec.f === 'pct2' || spec.f === 'pct0') { txt = `${(ad * 100).toFixed(1)} pts`; tiny = ad < 0.005; }
    else if (spec.f === 'pts') { txt = `${Math.round(ad)} pts`; tiny = ad < 2; }
    else { if (a === 0) return null; const rel = ad / Math.abs(a); txt = `${(rel * 100).toFixed(0)}%`; tiny = rel < 0.03; }
    const dir = tiny ? 'eq' : d > 0 ? 'up' : 'dn';
    const cls = tiny || !spec.better ? 'neu' : ((spec.better === 'high') === (d > 0)) ? 'good' : 'bad';
    return { dir, cls, txt: tiny ? '' : txt, word: tiny ? 'in line' : d > 0 ? 'higher' : 'lower', long: tiny ? 'in line with the industry' : `${txt} ${d > 0 ? 'higher' : 'lower'} than the industry` };
  }
  function cmpInfo(key) {
    const m = state.model, ind = state.ind, spec = specFor(key);
    if (!spec) return { s: 'none' };
    if (spec.noAvg) return { s: 'na', why: spec.why || 'Per-share values can’t be compared across companies' };
    if (state.indStatus === 'loading') return { s: 'wait' };
    if (!ind) return { s: 'na', why: 'No industry data' };
    if (spec.skipFin && m.isFinancial) return { s: 'na', why: 'Not applicable to financial companies' };
    const a = ind.avg[key];
    if (!isNum(a)) return { s: 'na', why: 'No industry average available' };
    return { s: 'ok', a, spec, txt: fmtBy(spec, a, m), d: cmpDelta(spec.get(m), a, spec) };
  }
  // e.g. "Industry average 24.1×. This company: 9% higher than the industry — worse (lower is better here)."
  function cmpTip(i) {
    const better = i.spec.better === 'high' ? 'higher is better here' : 'lower is better here';
    const verdict = !i.d ? '' : i.d.cls === 'good' ? ` — better (${better})` : i.d.cls === 'bad' ? ` — worse (${better})` : '';
    return `Industry average ${i.txt}.${i.d ? ` This company: ${i.d.long}${verdict}.` : ''}`;
  }
  const dlHTML = (i) => `<span class="dl ${i.d.cls}" tabindex="0" data-tip="${esc(cmpTip(i))}">${ico(i.d.dir)}${i.d.txt ? `<b>${esc(i.d.txt)}</b>` : ''}<i class="dw">${esc(i.d.word)}</i></span>`;
  // "INDUSTRY AVG 24.1×" (narrow boxes show "AVG 24.1×", see css/style.css)
  const lnKey = '<span class="ln-k"><span class="lk-l">Industry avg</span><span class="lk-s">Avg</span></span>';
  const lnHTML = (i) => (i.s === 'ok'
    ? `<span class="ln">${lnKey}<b>${esc(i.txt)}</b></span>${i.d ? dlHTML(i) : ''}`
    : `<span class="ln na" title="${esc(i.why || '')}">${lnKey}<b>n/a</b></span>`);

  function computeIndustryAvg(models) {
    const avg = {};
    allIndKeys(state.model).forEach((k) => {
      const spec = specFor(k); if (!spec || spec.noAvg) return;
      // money amounts (market cap, revenue, profit, cash flow) are only averaged across peers reporting in the same currency
      const usable = (x) => spec.f !== 'money' || (spec.cur === 'px' ? x.currency === state.model.currency : x.finCurrency === state.model.finCurrency);
      const vs = models.filter(usable).map((x) => spec.get(x)).filter(isNum);
      avg[k] = vs.length >= 2 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    });
    return avg;
  }
  // Fill every comparison spot (called when the page is drawn and again when the peers have loaded)
  function fillIndustryUI() {
    const m = state.model; if (!m) return;
    let n = 0;
    document.querySelectorAll('#dashContent [data-ind]').forEach((el) => {
      el.style.setProperty('--i', n++); // entrance stagger
      const t = el.dataset.t, i = cmpInfo(el.dataset.ind);
      if (t === 'mk' || t === 'rmk') { // markers on the Power Stat meters / the score ring
        el.classList.toggle('off', i.s !== 'ok');
        if (i.s === 'ok') el.style.setProperty(t === 'mk' ? '--x' : '--a', Math.max(0, Math.min(100, i.a)).toFixed(1));
        return;
      }
      if (i.s === 'wait') { el.innerHTML = '<span class="sk"></span>'; return; }
      if (t === 'line' || t === 'sline') el.innerHTML = lnHTML(i);
      else if (t === 'chip') el.innerHTML = i.s === 'ok' && i.d ? dlHTML(i) : '';
    });
  }

  /* ---------- the switch (top bar): "Compare with industry" / "Industry avg" ---------- */
  const HINT_KEY = 'plutus.compareHint.v1'; // set once the visitor has used the comparison (stops the attention glow)
  function cmpActive() { return !!state.cmp && state.indStatus !== 'fail'; }
  function updateCmpBtn() {
    const b = $('#cmpBtn'); if (!b) return;
    const st = state.indStatus, on = cmpActive();
    b.classList.toggle('is-wait', st === 'loading'); b.classList.toggle('is-na', st === 'fail');
    b.setAttribute('aria-checked', on ? 'true' : 'false'); b.disabled = st === 'fail';
    b.dataset.tip = st === 'fail' ? 'Industry comparison isn’t available for this company'
      : on ? 'Showing the industry average next to each number — click to hide it'
        : 'Show this company’s numbers next to the average of similar companies in its industry';
  }
  function applyCompare() {
    const root = $('#dashContent'); if (root) root.classList.toggle('cmp-on', cmpActive());
    updateCmpBtn();
  }
  function toggleCompare() {
    if (state.indStatus === 'fail') return;
    state.cmp = !state.cmp;
    try { localStorage.setItem(CMP_KEY, state.cmp ? '1' : '0'); localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* private mode: just not remembered */ }
    const b = $('#cmpBtn'); if (b) b.classList.remove('nudge');
    applyCompare(); syncCompareCharts();
    // say what just happened, and how to read the chips that appear
    showToast(state.cmp
      ? `<span class="tg-t">Industry average <b>on</b></span><span class="tg-g"><span class="dl neu">${ico('up')}<i class="dw">higher</i></span><span class="dl neu">${ico('dn')}<i class="dw">lower</i></span></span><span class="tg-g"><span class="tg-d good"></span>better<span class="tg-d bad"></span>worse</span>`
      : '<span class="tg-t">Industry average <b>off</b></span>');
  }

  // add / remove the industry lines on the charts without rebuilding them (Chart.js animates the change)
  function syncCompareCharts() {
    const m = state.model; if (!m) return;
    const on = cmpActive() && state.ind;
    const pe = findChart('chPE');
    if (pe && valSel().metric === 'pe' && pe.config.type === 'line') {
      const has = pe.data.datasets.some((d) => d.isInd);
      if (on && isNum(state.ind.avg.pe) && !has) { pe.data.datasets.push(peIndDataset(pe.data.labels.length, state.ind.avg.pe)); pe.update(); }
      else if (!on && has) { pe.data.datasets = pe.data.datasets.filter((d) => !d.isInd); pe.update(); }
    }
    const mg = findChart('chMargin');
    if (mg) {
      const pb = $('#periodToggle button.on'), annual = !pb || pb.dataset.p !== 'quarterly';
      const has = mg.data.datasets.some((d) => d.isInd);
      if (on && annual && isNum(state.ind.avg.nm) && !has) { mg.data.datasets.push(marginIndDataset(mg.data.labels, state.ind.avg.nm)); mg.update(); }
      else if (!(on && annual) && has) { mg.data.datasets = mg.data.datasets.filter((d) => !d.isInd); mg.update(); }
    }
  }
  let toastT = null;
  function showToast(html) {
    const t = $('#cmpToast'); if (!t) return;
    t.innerHTML = html; t.classList.add('in');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('in'), 3600);
  }
  // a gentle glow on the switch (until the comparison has been used once) so the feature is easy to discover
  function nudgeCompare() {
    const b = $('#cmpBtn'); if (!b || state.cmp) return;
    let seen = false; try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { /* ignore */ }
    if (seen) return;
    b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
    setTimeout(() => b.classList.remove('nudge'), 3400);
  }
  function initCompareSwitch() {
    const b = $('#cmpBtn'); if (!b) return;
    b.addEventListener('click', () => { if (!b.disabled) toggleCompare(); });
    // tap-to-show tooltips on the industry chips (touch screens have no hover)
    document.addEventListener('click', (e) => {
      const t = e.target.closest('.dl[data-tip], .bd[data-tip], .gv-rn[data-tip]');
      document.querySelectorAll('.dl.tip-open, .bd.tip-open, .gv-rn.tip-open').forEach((x) => { if (x !== t) x.classList.remove('tip-open'); });
      if (t) t.classList.toggle('tip-open');
    });
    updateCmpBtn();
  }

  function aboutSection(m, idx) {
    // Website: shown as "Website  domain ↗" so it lines up with the other label/value facts
    const siteHost = domainOf(m.website);
    const siteHref = m.website ? (/^https?:/i.test(m.website) ? m.website : 'https://' + m.website) : '';
    const facts = [
      m.sector ? `<span class="fact"><span class="fk">Sector</span> <b>${esc(m.sector)}</b></span>` : '',
      m.industry ? `<span class="fact"><span class="fk">Industry</span> <b>${esc(m.industry)}</b></span>` : '',
      m.city || m.country ? `<span class="fact"><span class="fk">HQ</span> <b>${esc([m.city, m.country].filter(Boolean).join(', '))}</b></span>` : '',
      isNum(m.beta) ? `<span class="fact"><span class="fk">Beta</span> <b>${m.beta.toFixed(2)}</b></span>` : '',
      siteHref ? `<span class="fact"><span class="fk">Website</span> <b><a href="${esc(siteHref)}" target="_blank" rel="noopener">${esc(siteHost || m.website)} ↗</a></b></span>` : ''
    ].join('');
    if (!m.summary && !facts) return '';
    return `<section class="section about reveal" id="sec-about">
      <div class="section-head"><span class="idx">${idx}</span><h2>About the Company</h2><p>What the business does</p></div>
      ${m.summary ? `<p class="about-text clamp" id="aboutText">${esc(m.summary)}</p><button class="more-btn hidden" id="aboutMore">Read more ↓</button>` : ''}
      ${facts ? `<div class="facts">${facts}</div>` : ''}
    </section>`;
  }

  function render(m, opts) {
    const c = m.finCurrency, pc = m.currency;
    const S = m.scores;
    const posPct = isNum(m.pos52) ? (m.pos52 * 100).toFixed(1) : null;
    let n = 0; const idx = () => String(++n).padStart(2, '0');
    const notices = [];
    if (!opts.summaryOk) notices.push('Company profile & key statistics are temporarily unavailable — some figures are computed from statements instead.');
    if (!m.hasFundamentals) notices.push('Yahoo Finance has no annual financial statements for this listing, so growth, profit and balance-sheet metrics can’t be shown.');
    if (!m.sameCur && m.hasFundamentals) notices.push(`Financial statements are reported in ${c} while the share trades in ${pc}; the P/E history chart is hidden to avoid mixing currencies.`);
    const about = aboutSection(m, '01');
    if (about) n = 1;
    const dom = domainOf(m.website) || (domCache[m.symbol] || '');
    if (domainOf(m.website)) saveDom(m.symbol, domainOf(m.website));

    const html = `
    ${secNavHTML(m, !!about, dom)}
    <section class="identity reveal">
      <div class="ident-row">
        ${logoHTML(dom, m.name, 'lg', m.symbol)}
        <div class="ident-txt">
          <div class="meta"><b>${esc(m.symbol)}</b> · ${esc(m.exchange)}</div>
          <h1>${esc(m.name)}</h1>
        </div>
      </div>
      <div class="price-block">
        <div class="price">${fmtPrice(m.price, pc)}</div>
        <div class="chg ${signCls(m.changePct)}">${isNum(m.change) ? (m.change > 0 ? '▲ ' : m.change < 0 ? '▼ ' : '') + Math.abs(m.change).toFixed(2) : ''} ${isNum(m.changePct) ? '(' + fmtPct(m.changePct, 2, true) + ')' : ''} <span class="muted">today</span></div>
          <a class="cmp-go" href="#/compare/${encodeURIComponent(m.symbol)}" title="Compare ${esc(shortName(m.name))} side by side with other stocks">${ico('scale')}<span>Compare with other stocks</span></a>
      </div>
    </section>
    ${notices.map((x) => `<div class="notice">${esc(x)}</div>`).join('')}
    <div class="strip reveal">
      <div>${stripK('landmark', 'Market Cap')}<div class="v">${fmtMoney(m.marketCap, pc)}</div>${stripInd('mc')}</div>
      <div>${stripK('scale', 'P/E')}<div class="v">${m.negEarnings ? 'n/a <span class="muted" style="font-size:12px">(loss)</span>' : fmtX(m.pe, 1)}</div>${stripInd('pe')}</div>
      <div>${stripK('trend', '1Y Return')}<div class="v ${signCls(m.ret1y)}">${fmtPct(m.ret1y, 1, true)}</div>${stripInd('r1')}</div>
      <div>${stripK('percent', 'Div. Yield')}<div class="v">${isNum(m.divYield) ? fmtPct(m.divYield, 2) : '—'}</div>${stripInd('dy')}</div>
      <div class="range-cell">${stripK('range', '52W Range')}
        ${posPct != null ? `<div class="range-wrap"><div class="range"><span style="left:${posPct}%"></span></div>
        <div class="range-lbl"><span>${fmtPrice(m.low52, pc)}</span><span>${fmtPrice(m.high52, pc)}</span></div></div>` : '<div class="v">—</div>'}
      </div>
    </div>

    ${about}

    <section class="section reveal" id="sec-biz">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Business Model</h2><p>How the company makes money, end to end</p></div>
      <div id="bizWrap"><div class="peer-loading"><div class="orbit sm"><span></span></div><span>Mapping the business model…</span></div></div>
    </section>

    <section class="section reveal" id="sec-key">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Key Numbers</h2><p>Tap ⓘ for meaning · add any metric you like</p></div>
      <div id="kpiWrap">${kpiGroupsHTML(m)}</div>
    </section>

    <section class="section reveal" id="sec-trajectory">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Trajectory</h2><p>How the business and the share price have moved over time</p></div>
      <div class="charts">
        ${chartCard('chPrice', 'Share Price', 'What one share has cost in the market over time. YTD = since the start of this year; MAX = all the price history Yahoo Finance has.', m.takeaways.price, true,
          `<div class="toggle" id="priceToggle" role="group" aria-label="Time range">${PRICE_RANGES.map(([k, l, t]) => `<button type="button" data-r="${k}" title="${t}"${k === '5y' ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`)}
        ${valCardHTML(m)}
        <div class="period-bar">
          <div><span class="pb-title">Business Results</span><span class="pb-sub" id="periodNote"></span></div>
          <div class="toggle big" id="periodToggle"><button data-p="annual" class="on">YEARLY</button><button data-p="quarterly">QUARTERLY</button></div>
        </div>
        ${chartCard('chRev', 'Revenue vs Net Profit', 'Sales (everything customers paid) vs. what was left after all costs and taxes.', m.takeaways.revenue)}
        ${chartCard('chMargin', 'Profit Margins', 'Out of every 100 of sales, how much remains as profit at each stage.', m.takeaways.margins)}
        ${chartCard('chEPS', 'Earnings per Share', 'Profit belonging to each single share.', m.takeaways.eps)}
        ${chartCard('chCash', 'Cash Flow', 'Cash generated by operations, and what is left after investing in the business (free cash flow).', m.takeaways.cash)}
        ${chartCard('chDebt', 'Debt vs Shareholders’ Equity', 'Money borrowed vs. money that belongs to the owners.', m.takeaways.debt, true)}
      </div>
    </section>

    <section class="section reveal" id="sec-shareholding">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Shareholding Pattern</h2><p>Who owns the company’s shares</p></div>
      <div id="holdWrap"><div class="peer-loading"><div class="orbit sm"><span></span></div><span>Loading shareholding…</span></div></div>
    </section>

    <section class="section reveal" id="sec-gov">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Corporate Governance</h2><p>Who runs the company, and how well shareholders are protected</p></div>
      <div id="govWrap">${govHTML(m)}</div>
    </section>

    <section class="section reveal" id="sec-peers">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Peer Arena</h2><p>How it stacks up against companies in the same industry</p></div>
      <div id="peerWrap"><div class="peer-loading"><div class="orbit sm"><span></span></div><span>Finding industry peers…</span></div></div>
    </section>

    <section class="section reveal" id="sec-sw">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Strengths &amp; Weaknesses</h2><p>Facts that stand out — you decide what matters to you</p></div>
      <div class="sw" id="swWrap">
        ${swCol('s', 'Strengths', m.strengths, 'good')}
        ${swCol('w', 'Weaknesses', m.weaknesses, 'bad')}
      </div>
      <div class="verdict-note">PLUTUS does not tell you to buy, sell or hold. Every investor has different goals, time horizons and risk tolerance. Use these facts as a starting point, compare with similar companies, and read the company’s official reports before deciding.</div>
    </section>`;

    const root = $('#dashContent');
    root.innerHTML = html;
    root.classList.remove('hidden');
    fillIndustryUI(); applyCompare();

    // About: show "Read more" only if text is actually clamped
    const at = $('#aboutText'), mb = $('#aboutMore');
    if (at && mb) {
      requestAnimationFrame(() => { if (at.scrollHeight > at.clientHeight + 4) mb.classList.remove('hidden'); });
      mb.addEventListener('click', () => { const c2 = at.classList.toggle('clamp'); mb.textContent = c2 ? 'Read more ↓' : 'Show less ↑'; });
    }
    // Key Numbers: category tabs, the "Add a metric" box and the × on added cards (one delegated handler)
    wireKpiWrap(root);
    // Key Number explanations (ⓘ): one shared popover — see KPI EXPLANATIONS
    wireKpiInfo(root);
    wireGov(root);

    observeReveal();
    initSecNav();
    drawCharts(m);
  }

  function countUp(el, target) {
    if (!el) return;
    if (!isNum(target)) { el.textContent = '—'; return; }
    const t0 = performance.now(), dur = 1300;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function observeReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.05 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- sticky section navigation ----------
     A slim bar at the very top of the stock page (above the company name and price) that sticks under the top bar while
     the page scrolls. Tabs jump to a section; the tab of the section being read lights up. Scrolling is done in JS (not with
     #anchors) because the address hash is the router (#/s/SYMBOL). */
  const SEC_TABS = [
    { id: 'sec-about', label: 'About the Company' },
    { id: 'sec-biz', label: 'Business Model' },
    { id: 'sec-key', label: 'Key Numbers' },
    { id: 'sec-trajectory', label: 'Trajectory' },
    { id: 'sec-shareholding', label: 'Shareholding' },
    { id: 'sec-gov', label: 'Governance' },
    { id: 'sec-peers', label: 'Peer Arena' },
    { id: 'sec-sw', label: 'Strengths &amp; Weaknesses' }
  ];
  /* The company chip: logo · name · price, pinned at the left of the sticky bar. It slides in once the big company
     name at the top of the page has scrolled out of view, so you always know which company you're reading about;
     tapping it scrolls back to the top. It only changes the bar's width (the tabs scroll sideways), never its height,
     so nothing below jumps. */
  function secNavHTML(m, hasAbout, dom) {
    const tabs = SEC_TABS.filter((t) => hasAbout || t.id !== 'sec-about')
      .map((t) => `<button type="button" class="sn-tab" data-t="${t.id}">${t.label}</button>`).join('');
    const chg = isNum(m.changePct) ? `<span class="sn-chg ${signCls(m.changePct)}">${fmtPct(m.changePct, 2, true)}</span>` : '';
    const chip = `<button type="button" class="sn-id" id="snId" tabindex="-1" aria-hidden="true" title="${esc(m.name)} — back to top">
        ${logoHTML(dom, m.name, 'sm', m.symbol)}
        <span class="sn-txt"><b class="sn-name">${esc(shortName(m.name))}</b><span class="sn-q"><span class="sn-sym">${esc(m.symbol)}</span><span class="sn-px">${fmtPrice(m.price, m.currency)}</span>${chg}</span></span>
      </button>`;
    return `<nav class="secnav" id="secNav" aria-label="Jump to a section">${chip}<div class="sn-track">${tabs}</div></nav>`;
  }
  // "Wells Fargo & Company" → "Wells Fargo", "Reliance Industries Limited" → "Reliance Industries"
  function shortName(n) {
    let s = decodeEnt(n).trim();
    for (let i = 0; i < 3; i++) {
      const t = s.replace(/[\s,]+(limited|ltd\.?|inc\.?|incorporated|corporation|corp\.?|plc|p\.l\.c\.|n\.v\.|s\.a\.|a\/s|ag|se|co\.?|company|holdings?)\.?$/i, '').replace(/[\s,&]+$/, '').trim();
      if (t === s || !t) break;
      s = t;
    }
    return s || decodeEnt(n);
  }
  let secNavOff = null;
  function initSecNav() {
    if (secNavOff) { secNavOff(); secNavOff = null; }
    const nav = $('#secNav'); if (!nav) return;
    const track = $('.sn-track', nav);
    const items = Array.from(nav.querySelectorAll('.sn-tab')).map((tab) => ({ tab, sec: document.getElementById(tab.dataset.t) })).filter((x) => x.sec);
    const barH = () => { const tb = $('#topbar'); return tb ? tb.getBoundingClientRect().height : 68; };
    const offset = () => barH() + nav.offsetHeight + 16;                          // where a section's top should land
    const docTop = (el) => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; }; // ignores the reveal animation's shift
    let locked = false, lockT = null, current = null, raf = 0;
    function setActive(it) {
      if (it === current) return;
      current = it;
      items.forEach((x) => { const on = x === it; x.tab.classList.toggle('on', on); if (on) x.tab.setAttribute('aria-current', 'true'); else x.tab.removeAttribute('aria-current'); });
      if (it && track.scrollWidth > track.clientWidth + 2) { // narrow screens: keep the active tab in view (sideways only, never moves the page)
        track.scrollTo({ left: Math.max(0, it.tab.offsetLeft - (track.clientWidth - it.tab.offsetWidth) / 2), behavior: 'smooth' });
      }
    }
    const idName = $('#dashContent .identity h1'), chip = $('#snId', nav);
    let idShown = false;
    function update() {
      raf = 0;
      if (!document.body.contains(nav)) { off(); return; }
      if (!nav.offsetParent) return; // dashboard hidden (home page)
      const nr = nav.getBoundingClientRect();
      nav.classList.toggle('stuck', nr.top <= barH() + 0.5);
      // company chip: shown once the big company name has slid up under the bar
      const show = !!idName && idName.getBoundingClientRect().bottom < nr.bottom - 4;
      if (show !== idShown) {
        idShown = show; nav.classList.toggle('show-id', show);
        if (chip) { chip.tabIndex = show ? 0 : -1; chip.setAttribute('aria-hidden', show ? 'false' : 'true'); }
      }
      if (locked) return;
      const line = window.scrollY + offset() + 8;
      let cur = null;
      for (const it of items) if (docTop(it.sec) <= line) cur = it;
      if (items.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = items[items.length - 1]; // bottom of the page
      setActive(cur);
    }
    const onScroll = () => {
      if (locked) { clearTimeout(lockT); lockT = setTimeout(() => { locked = false; update(); }, 140); } // a tab click is still scrolling
      if (!raf) raf = requestAnimationFrame(update);
    };
    nav.addEventListener('click', (e) => {
      if (e.target.closest('.sn-id')) { // the company chip: back to the top
        const reduce0 = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce0 ? 'auto' : 'smooth' });
        return;
      }
      const b = e.target.closest('.sn-tab'); if (!b) return;
      const it = items.find((x) => x.tab === b); if (!it) return;
      locked = true; clearTimeout(lockT); lockT = setTimeout(() => { locked = false; update(); }, 400);
      setActive(it);
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, docTop(it.sec) - offset()), behavior: reduce ? 'auto' : 'smooth' });
    });
    // a soft fade at the right edge while more tabs are hidden there (the bar scrolls sideways)
    const edge = () => nav.classList.toggle('more-r', track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    track.addEventListener('scroll', edge, { passive: true });
    if (chip) chip.addEventListener('transitionend', edge);
    const onScroll2 = () => { onScroll(); edge(); };
    window.addEventListener('scroll', onScroll2, { passive: true });
    window.addEventListener('resize', onScroll2);
    requestAnimationFrame(edge);
    function off() { window.removeEventListener('scroll', onScroll2); window.removeEventListener('resize', onScroll2); clearTimeout(lockT); if (raf) cancelAnimationFrame(raf); raf = 0; }
    secNavOff = off;
    requestAnimationFrame(update);
  }

  /* ====================== v13: EVERY METRIC FROM THE SCREENER.IN REFERENCE LIST ======================
     Key Numbers shows 4 cards per category by default. The "Add a metric" box above the tabs lists every other
     metric (search by name, or browse the drop-down); an added card goes into its own category with a × to remove it.
     The choice is remembered in this browser (plutus.kpi.extra.v1) and applies to every company.
     g: category (0 Growth & Profit · 1 Value & Returns · 2 Safety & Cash) · f: format · better: which way is better
     (colours the industry chip; null = neither) · noAvg: not comparable across companies (per-share, ownership). */
  const XKPI_KEY = 'plutus.kpi.extra.v1';
  const shpv = (k) => (m) => (m.shp && isNum(m.shp[k]) ? m.shp[k] : null);
  const XKPI = {
    // ---- Growth & Profit ----
    salesg: { g: 0, t: 'Sales Growth (YoY)', ic: 'trend', get: (m) => m.revYoY, f: 'pctp', better: 'high', what: 'How much revenue grew (or shrank) in the latest financial year compared with the year before.', calc: '(Revenue this year ÷ revenue last year − 1) × 100', read: 'Steady double-digit growth usually means rising demand or market share. One year can be distorted by acquisitions or one-offs.' },
    profg: { g: 0, t: 'Profit Growth (YoY)', ic: 'wallet', get: (m) => m.niYoY, f: 'pctp', better: 'high', what: 'How much net profit changed in the latest financial year compared with the year before.', calc: '(Net profit this year ÷ net profit last year − 1) × 100', read: 'Profit growing faster than sales means margins are improving; slower means costs are rising faster than revenue.' },
    qsales: { g: 0, t: 'Qtr Sales Var %', ic: 'banknote', get: (m) => m.qSalesVar, f: 'pctp', better: 'high', sub: () => 'latest quarter vs same quarter last year', what: 'Change in revenue in the latest quarter compared with the same quarter a year earlier.', calc: '(Latest quarter’s revenue ÷ revenue in the same quarter last year − 1) × 100', read: 'Comparing with the same quarter last year removes seasonal effects (festive season, monsoon, year-end orders).' },
    qprofit: { g: 0, t: 'Qtr Profit Var %', ic: 'wallet', get: (m) => m.qProfitVar, f: 'pctp', better: 'high', sub: () => 'latest quarter vs same quarter last year', what: 'Change in net profit in the latest quarter compared with the same quarter a year earlier.', calc: '(Latest quarter’s net profit ÷ net profit in the same quarter last year − 1) × 100', read: 'The freshest sign of whether profits are accelerating or slowing. A single quarter can be lumpy.' },
    sc3: { g: 0, t: 'Sales CAGR 3Y', ic: 'sprout', get: (m) => m.salesCAGR3, f: 'pctp', better: 'high', what: 'The average yearly growth rate of revenue over the last 3 years (compounded).', calc: '(Revenue now ÷ revenue 3 years ago)^(1/3) − 1', read: 'Smooths out single good or bad years. Compare with the 5- and 10-year rates to see if growth is speeding up or slowing down.' },
    sc5: { g: 0, t: 'Sales CAGR 5Y', ic: 'sprout', get: (m) => m.salesCAGR5, f: 'pctp', better: 'high', what: 'The average yearly growth rate of revenue over the last 5 years (compounded).', calc: '(Revenue now ÷ revenue 5 years ago)^(1/5) − 1', read: 'A good measure of the business’s long-run growth engine.' },
    sc10: { g: 0, t: 'Sales CAGR 10Y', ic: 'sprout', get: (m) => m.salesCAGR10, f: 'pctp', better: 'high', what: 'The average yearly growth rate of revenue over the last 10 years (compounded).', calc: '(Revenue now ÷ revenue 10 years ago)^(1/10) − 1', read: 'Needs 11 years of statements; Yahoo Finance usually publishes about 4–5, so this is often unavailable.' },
    pc3: { g: 0, t: 'Profit CAGR 3Y', ic: 'award', get: (m) => m.profitCAGR3, f: 'pctp', better: 'high', what: 'The average yearly growth rate of net profit over the last 3 years (compounded).', calc: '(Net profit now ÷ net profit 3 years ago)^(1/3) − 1', read: 'Only meaningful when profit was positive at both ends.' },
    pc5: { g: 0, t: 'Profit CAGR 5Y', ic: 'award', get: (m) => m.profitCAGR5, f: 'pctp', better: 'high', what: 'The average yearly growth rate of net profit over the last 5 years (compounded).', calc: '(Net profit now ÷ net profit 5 years ago)^(1/5) − 1', read: 'Profit compounding faster than sales over many years is the sign of a business gaining operating leverage.' },
    pc10: { g: 0, t: 'Profit CAGR 10Y', ic: 'award', get: (m) => m.profitCAGR10, f: 'pctp', better: 'high', what: 'The average yearly growth rate of net profit over the last 10 years (compounded).', calc: '(Net profit now ÷ net profit 10 years ago)^(1/10) − 1', read: 'Needs 11 years of statements; Yahoo Finance usually publishes about 4–5, so this is often unavailable.' },
    ebitda: { g: 0, t: 'Operating Profit (EBITDA)', ic: 'pie', get: (m) => m.ebitda, f: 'money', cur: 'fin', better: null, what: 'Profit from the core business before interest, tax, depreciation and amortisation.', calc: 'Revenue − operating costs (materials, staff, other expenses)', read: 'Shows how much the business itself earns before financing and accounting choices. Compare it with revenue (OPM %).' },
    opm: { g: 0, t: 'OPM %', ic: 'pie', get: (m) => m.opm, f: 'pct', better: 'high', what: 'Operating profit margin: how much of each sale is left as operating profit (EBITDA).', calc: 'EBITDA ÷ revenue × 100 (operating income where EBITDA isn’t published)', read: 'Higher = more pricing power or lower costs. Compare within the same industry.' },
    roce: { g: 0, t: 'ROCE %', ic: 'repeat', get: (m) => m.roce, f: 'pct', better: 'high', what: 'Return on capital employed: profit earned on ALL the money used in the business — shareholders’ and lenders’.', calc: 'EBIT ÷ (total assets − current liabilities) × 100', read: 'Unlike ROE it isn’t flattered by borrowing. A ROCE well above the cost of borrowing means the company creates value.' },
    roic: { g: 0, t: 'Return on Invested Capital (ROIC)', ic: 'repeat', get: (m) => m.roic, f: 'pct', better: 'high', what: 'The after-tax operating return earned on the long-term capital supplied by shareholders and lenders.', calc: 'EBIT × (1 − effective tax rate) ÷ (shareholders’ equity + total debt − cash) × 100', read: 'A sustained ROIC above the company’s cost of capital usually signals that the business is creating value. Compare it with similar companies and across several years.' },
    roa: { g: 0, t: 'ROA %', ic: 'repeat', get: (m) => m.roa, f: 'pct', better: 'high', what: 'Return on assets: net profit earned for every 100 of assets the company owns.', calc: 'Net profit ÷ total assets × 100', read: 'Useful for banks and asset-heavy businesses, where even 1–2% can be good.' },
    // ---- Value & Returns ----
    cmp: { g: 1, t: 'Current Price (CMP)', ic: 'tag', get: (m) => m.price, f: 'price', noAvg: true, why: 'Share prices can’t be compared across companies', what: 'The latest price at which one share traded on the exchange.', calc: 'Last traded price', read: 'On its own the price says nothing about value — read it with earnings (P/E) and book value (P/B).' },
    mcap: { g: 1, t: 'Market Cap', ic: 'landmark', get: (m) => m.marketCap, f: 'money', cur: 'px', better: null, what: 'The market value of all the company’s shares together.', calc: 'Share price × total shares', read: 'Tells you the size of the company in the market — large caps are usually steadier, small caps can grow (and fall) faster.' },
    ev: { g: 1, t: 'Enterprise Value', ic: 'landmark', get: (m) => m.ev, f: 'money', cur: 'px', better: null, what: 'What it would cost to buy the whole business: its shares plus its debt, minus its cash.', calc: 'Market cap + total debt − cash & cash equivalents', read: 'Used instead of market cap when comparing companies with very different amounts of debt (e.g. EV / EBITDA).' },
    pb: { g: 1, t: 'P/B (Price to Book)', ic: 'scale', get: (m) => (isNum(m.pb) && m.pb > 0 ? m.pb : null), f: 'x', better: 'low', what: 'How the share price compares with the company’s net assets (book value) per share.', calc: 'Share price ÷ book value per share', read: 'Most useful for banks and asset-heavy firms. Below 1× means the market values it below its accounting net worth.' },
    bv: { g: 1, t: 'Book Value / share', ic: 'shield', get: (m) => m.bookValue, f: 'fprice', noAvg: true, why: 'Per-share values can’t be compared across companies', what: 'The company’s net worth (assets minus liabilities) for each share.', calc: 'Shareholders’ equity ÷ number of shares', read: 'Rising book value over the years means the company keeps adding to its net worth.' },
    fv: { g: 1, t: 'Face Value', ic: 'hash', get: (m) => m.faceValue, f: 'inr', noAvg: true, why: 'Per-share values can’t be compared across companies', sub: (m) => (isIndian(m.symbol) ? 'nominal value of one share' : 'used for Indian listings'), what: 'The nominal value printed on each share when it was issued (e.g. ₹1, ₹2, ₹10).', calc: 'Set by the company; changes only with a share split or consolidation', read: 'Has nothing to do with the market price. Dividends in India are often announced as a % of face value.' },
    hl52: { g: 1, t: '52W High / Low', ic: 'range', get: (m) => m.high52, show: (m) => (isNum(m.high52) ? `${fmtPrice(m.high52, m.currency)} / ${fmtPrice(m.low52, m.currency)}` : '—'), sub: (m) => (isNum(m.pos52) ? `now at ${fmtPct(m.pos52, 0)} of the range` : ''), f: 'price', noAvg: true, why: 'Share prices can’t be compared across companies', what: 'The highest and lowest prices the share traded at in the last 52 weeks.', calc: 'Highest and lowest daily closing prices of the last 12 months', read: 'Shows where today’s price sits in the year’s range — near the high or near the low.' },
    hlall: { g: 1, t: 'All-time High / Low', ic: 'range', get: (m) => m.allTimeHigh, show: (m) => (isNum(m.allTimeHigh) ? `${fmtPrice(m.allTimeHigh, m.currency)} / ${fmtPrice(m.allTimeLow, m.currency)}` : '…'), sub: (m) => (isNum(m.allTimeHigh) && isNum(m.price) ? `now ${fmtPct(m.price / m.allTimeHigh - 1, 0, true)} from the high` : 'loading the full price history'), f: 'price', noAvg: true, why: 'Share prices can’t be compared across companies', what: 'The highest and lowest prices in all the price history available (monthly closes).', calc: 'Highest and lowest monthly closing prices since listing (as far back as Yahoo Finance has)', read: 'Early prices are not adjusted for every corporate action on every exchange, so treat very old lows with care.' },
    ey: { g: 1, t: 'Earnings Yield', ic: 'percent', get: (m) => m.earningsYield, f: 'pct', better: 'high', what: 'The P/E turned upside down: the yearly profit you “get” for every 100 you pay for the share.', calc: '1 ÷ P/E × 100 (= EPS ÷ share price)', read: 'Easy to compare with interest rates: an earnings yield of 5% vs a fixed-deposit rate of 7%, for example.' },
    payout: { g: 1, t: 'Dividend Payout %', ic: 'percent', get: (m) => m.payout, f: 'pct', better: null, what: 'The share of the year’s profit paid out to shareholders as dividends.', calc: 'Dividends ÷ net profit × 100', read: 'High payout = generous but less money kept for growth; very high (above 100%) can’t last unless profits rise.' },
    prc3: { g: 1, t: 'Stock Price CAGR 3Y', ic: 'trend', get: (m) => m.priceCAGR3, f: 'pctp', better: 'high', what: 'The average yearly rise (or fall) of the share price over the last 3 years.', calc: '(Price now ÷ price 3 years ago)^(1/3) − 1 · dividends not included', read: 'Past returns don’t predict future ones — compare them with how fast profits grew over the same years.' },
    prc5: { g: 1, t: 'Stock Price CAGR 5Y', ic: 'trend', get: (m) => m.priceCAGR5, f: 'pctp', better: 'high', what: 'The average yearly rise (or fall) of the share price over the last 5 years.', calc: '(Price now ÷ price 5 years ago)^(1/5) − 1 · dividends not included', read: 'Past returns don’t predict future ones.' },
    prc10: { g: 1, t: 'Stock Price CAGR 10Y', ic: 'trend', get: (m) => m.priceCAGR10, f: 'pctp', better: 'high', what: 'The average yearly rise (or fall) of the share price over the last 10 years.', calc: '(Price now ÷ price 10 years ago)^(1/10) − 1 · dividends not included', read: 'Loaded with the full price history; shows “—” for companies listed less than 10 years ago.' },
    // ---- Safety & Cash ----
    quick: { g: 2, t: 'Quick Ratio', ic: 'drop', get: (m) => (m.isFinancial ? null : m.quickRatio), f: 'x2', better: 'high', skipFin: true, what: 'Like the current ratio, but without inventory — can the company pay its short-term bills from its most liquid assets?', calc: '(Current assets − inventory) ÷ current liabilities', read: 'Above 1× is comfortable. Matters most for companies holding lots of stock that may be slow to sell.' },
    icr: { g: 2, t: 'Interest Coverage', ic: 'shield', get: (m) => m.interestCoverage, f: 'x', better: 'high', what: 'How many times over operating profit can pay the year’s interest bill.', calc: 'EBIT ÷ interest expense', read: 'Below about 2× is a warning sign; above 5× is comfortable. Very high values usually mean little or no debt.' },
    pledge: { g: 2, t: 'Pledged %', ic: 'card', get: (m) => m.pledge, f: 'pct', noAvg: true, why: 'Not available in the data sources used here', sub: () => 'not in Yahoo / screener.in public data', what: 'The share of promoter-held shares pledged as collateral for loans.', calc: 'Pledged promoter shares ÷ promoter shares × 100', read: 'High pledging is a risk: if the share price falls, lenders can sell the shares. Check the latest shareholding filing on NSE / BSE — you can also ask Plutus (“Has the promoter pledged any shares?”).' },
    borrow: { g: 2, t: 'Borrowings (Total Debt)', ic: 'card', get: (m) => m.borrowings, f: 'money', cur: 'fin', better: null, what: 'All the money the company owes to lenders: loans, bonds and similar, short- and long-term.', calc: 'Short-term + long-term borrowings (latest balance sheet)', read: 'Read it with equity (Debt / Equity), cash and interest coverage — the amount alone says little.' },
    fixed: { g: 2, t: 'Fixed Assets & CWIP', ic: 'landmark', get: (m) => m.fixedAssets, f: 'money', cur: 'fin', better: null, sub: (m) => (isNum(m.cwip) && m.cwip > 0 ? `incl. ${fmtMoney(m.cwip, m.finCurrency)} capital work in progress` : 'property, plant & equipment'), what: 'Physical assets the business runs on (land, buildings, machinery) plus capital work in progress — assets still being built.', calc: 'Net property, plant & equipment + capital work in progress', read: 'Large CWIP means new capacity is coming; it earns nothing until it’s finished.' },
    cfo: { g: 2, t: 'Cash from Operations', ic: 'waves', get: (m) => m.cfo, f: 'money', cur: 'fin', better: null, what: 'Cash generated by the day-to-day business in the latest year.', calc: 'Net profit adjusted for non-cash items and working-capital changes', read: 'Should be close to (or above) net profit over time. Profit without cash can be a warning sign.' },
    prom: { g: 2, t: 'Promoter Holding %', ic: 'shield', get: shpv('promoters'), f: 'pct2', noAvg: true, why: 'Ownership isn’t a better-or-worse measure', sub: (m) => shpSub(m, 'promoters'), what: 'The share of the company owned by its promoters (founders / controlling group).', calc: 'Promoter shares ÷ total shares × 100 (latest quarterly filing)', read: 'A high, stable promoter stake aligns owners with other shareholders. Watch for steady selling or pledging.' },
    fii: { g: 2, t: 'FII Holding %', ic: 'landmark', get: shpv('fiis'), f: 'pct2', noAvg: true, why: 'Ownership isn’t a better-or-worse measure', sub: (m) => shpSub(m, 'fiis'), what: 'The share owned by foreign institutional investors (overseas funds and banks).', calc: 'FII shares ÷ total shares × 100 (latest quarterly filing)', read: 'Rising FII ownership often signals global investor interest; it can also make the stock swing with global flows.' },
    dii: { g: 2, t: 'DII Holding %', ic: 'landmark', get: shpv('diis'), f: 'pct2', noAvg: true, why: 'Ownership isn’t a better-or-worse measure', sub: (m) => shpSub(m, 'diis'), what: 'The share owned by domestic institutions — Indian mutual funds, insurers, banks and pension funds.', calc: 'DII shares ÷ total shares × 100 (latest quarterly filing)', read: 'Steady DII buying is often seen as a sign of confidence from professional investors.' },
    pub: { g: 2, t: 'Public Holding %', ic: 'wallet', get: shpv('public'), f: 'pct2', noAvg: true, why: 'Ownership isn’t a better-or-worse measure', sub: (m) => shpSub(m, 'public'), what: 'The share owned by retail investors and others not counted as promoters or institutions.', calc: 'Public shares ÷ total shares × 100 (latest quarterly filing)', read: 'Indian rules require at least 25% public shareholding for most listed companies.' },
    holders: { g: 2, t: 'No. of Shareholders', ic: 'hash', get: shpv('holders'), f: 'int', noAvg: true, why: 'Depends on company size', sub: (m) => shpSub(m, 'holders'), what: 'How many individual shareholders (accounts) the company has, as per its latest filing.', calc: 'Number of shareholders reported in the quarterly shareholding pattern', read: 'A fast-rising count means more retail interest; it says nothing about value on its own.' }
  };
  Object.keys(XKPI).forEach((k) => { if (!KPI_ICON[k]) KPI_ICON[k] = XKPI[k].ic || 'avg'; });
  // "+1.2 pp in a year" under an ownership card
  function shpSub(m, k) {
    const s = state.shp, q = s && s.q, i = q ? q.dates.length - 1 : -1;
    if (!q || i < 0) return isIndian(m.symbol) ? 'loading from the shareholding filing' : 'published for Indian listings';
    const arr = k === 'holders' ? q.holders : q.rows[k], now = arr && arr[i], ago = arr && arr[Math.max(0, i - 4)];
    if (!isNum(now)) return '—';
    if (!isNum(ago) || i < 4) return `as of ${q.dates[i]}`;
    if (k === 'holders') return `${now >= ago ? '+' : '−'}${fmtPct(Math.abs(now / ago - 1), 0)} in a year · ${q.dates[i]}`;
    const d = (now - ago) * 100;
    return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} pp in a year · ${q.dates[i]}`;
  }
  function xfmt(d, v, m) {
    if (!isNum(v)) return '—';
    switch (d.f) {
      case 'pct': return fmtPct(v, 1);
      case 'pct2': return fmtPct(v, 2);
      case 'pctp': return fmtPct(v, 1, true);
      case 'x': return fmtX(v, 1);
      case 'x2': return fmtX(v, 2);
      case 'money': return fmtMoney(v, d.cur === 'px' ? m.currency : m.finCurrency);
      case 'price': return fmtPrice(v, m.currency);
      case 'fprice': return fmtPrice(v, m.finCurrency);
      case 'inr': return fmtPrice(v, 'INR').replace(/\.00$/, '');
      case 'int': return Math.round(v).toLocaleString(m.currency === 'INR' ? 'en-IN' : 'en-US');
      default: return String(v);
    }
  }
  // colour of the little icon on the card (same idea as the default cards)
  function xlvl(d, v) {
    if (!isNum(v) || !d.better) return '';
    if (d.f === 'pctp' || d.f === 'pct') {
      if (d.better === 'high') return v >= (d.f === 'pctp' ? 0.1 : 0.15) ? 'good' : v <= 0 ? 'bad' : 'warn';
    }
    if (d === XKPI.icr) return v >= 5 ? 'good' : v < 2 ? 'bad' : 'warn';
    if (d === XKPI.quick) return v >= 1 ? 'good' : v < 0.7 ? 'bad' : 'warn';
    if (d === XKPI.pb) return v <= 3 ? 'good' : v >= 8 ? 'bad' : 'warn';
    return '';
  }
  // industry-average spec for each added metric (so the "Compare with industry" switch works on them too)
  Object.keys(XKPI).forEach((k) => {
    const d = XKPI[k];
    IND[k] = d.noAvg ? { noAvg: true, why: d.why } : { get: d.get, f: { pctp: 'pct', pct2: 'pct2', x: 'x', x2: 'x2', money: 'money' }[d.f] || 'pct', cur: d.cur, better: d.better, skipFin: d.skipFin };
  });
  const loadExtra = () => { try { const a = JSON.parse(localStorage.getItem(XKPI_KEY)); return Array.isArray(a) ? a.filter((k) => XKPI[k]) : []; } catch (e) { return []; } };
  const saveExtra = (a) => { try { localStorage.setItem(XKPI_KEY, JSON.stringify(a)); } catch (e) { /* private mode: not remembered */ } };
  const kpiCardHTML = (k, v, sub, dot, ik, extra) => `<div class="kpi${extra ? ' kpi-x' : ''}" data-k="${ik}"><div class="k"><span class="ki ${dot}">${ico(KPI_ICON[ik] || 'avg')}</span><span class="k-label">${k}</span><button type="button" class="info" data-k="${ik}" aria-label="What does ${esc(k)} mean?" aria-haspopup="dialog" aria-expanded="false" aria-controls="kpiPop">i</button>${extra ? `<button type="button" class="kx-rm" data-rm="${ik}" aria-label="Remove ${esc(k)}" title="Remove from Key Numbers">×</button>` : ''}</div><div class="v">${v}</div><div class="sub swap"><span class="sw-a">${sub}</span><span class="sw-b cmpc" data-ind="${ik}" data-t="line"></span></div></div>`;
  function xCard(k, m) {
    const d = XKPI[k], v = d.get(m);
    const sub = d.sub ? d.sub(m) : '';
    return kpiCardHTML(esc(d.t), d.show ? d.show(m) : xfmt(d, v, m), esc(sub), xlvl(d, v), k, true);
  }
  function xExplanations(m) {
    const E = {};
    Object.keys(XKPI).forEach((k) => {
      const d = XKPI[k], v = d.get(m), shown = d.show ? d.show(m) : xfmt(d, v, m);
      E[k] = { t: d.t, what: d.what, calc: d.calc, read: d.read, col: [],
        you: isNum(v) || (d.show && shown !== '—') ? `${shown}${d.sub && d.sub(m) ? ' — ' + d.sub(m) : ''}.` : (d === XKPI.fv && !isIndian(m.symbol) ? 'Face value is shown for Indian listings (from screener.in).' : 'Not published for this company in the data sources used here.') };
    });
    return E;
  }
  /* the "Add a metric" box: type to filter, or open the list and pick; Enter adds the highlighted one */
  const KPI_CAT = ['Growth & Profit', 'Value & Returns', 'Safety & Cash'];
  function kpiAddHTML() {
    return `<div class="kx-add" id="kxAdd">
      <svg class="mini-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      <input id="kxInput" type="text" autocomplete="off" spellcheck="false" placeholder="Add a metric — ROIC, ROCE, EV, Quick ratio, Promoter holding…" aria-label="Add a metric to Key Numbers" aria-expanded="false" aria-controls="kxList" role="combobox" />
      <button type="button" class="kx-open" id="kxOpen" aria-label="Show all metrics" title="Show all metrics"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <ul class="kx-list suggest" id="kxList" role="listbox"></ul>
    </div>`;
  }
  function kpiAddList(q) {
    const have = new Set(loadExtra()), nq = norm(q || '');
    const all = Object.keys(XKPI).filter((k) => !have.has(k));
    const hits = all.filter((k) => !nq || norm(XKPI[k].t + ' ' + k).includes(nq) || nq.split(' ').every((w) => norm(XKPI[k].t + ' ' + XKPI[k].what).includes(w)));
    if (!hits.length) return `<li class="s-info">${have.size === Object.keys(XKPI).length ? 'Every metric is already on the page.' : 'No metric matches — try “growth”, “ratio”, “holding”.'}</li>`;
    return [0, 1, 2].map((g) => {
      const ks = hits.filter((k) => XKPI[k].g === g); if (!ks.length) return '';
      return `<li class="s-head"><span>${KPI_CAT[g]}</span></li>` + ks.map((k) => `<li role="option" data-add="${k}"><span class="kx-li-ic">${ico(KPI_ICON[k] || 'avg')}</span><span class="s-main"><span class="s-name">${esc(XKPI[k].t)}</span><span class="kx-li-d">${esc(XKPI[k].what)}</span></span></li>`).join('');
    }).join('');
  }
  // the Key Numbers block (tabs + panels) can be redrawn on its own: a metric added / removed, ownership or full price history arrived
  function renderKpiWrap(flashKey) {
    const w = $('#kpiWrap'), m = state.model; if (!w || !m) return;
    closeKpiPop();
    w.innerHTML = kpiGroupsHTML(m);
    wireKpiInfo(w);
    fillIndustryUI(); applyCompare();
    if (flashKey) {
      const c = w.querySelector(`.kpi[data-k="${flashKey}"]`);
      if (c) { c.classList.add('kx-new'); setTimeout(() => c.classList.remove('kx-new'), 1600); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
  }
  function wireKpiWrap(root) {
    const w = $('#kpiWrap', root); if (!w || w.dataset.wired) return;
    w.dataset.wired = '1';
    const list = () => $('#kxList', w), input = () => $('#kxInput', w);
    let active = -1;
    const openList = (q) => { const l = list(); l.innerHTML = kpiAddList(q); l.classList.add('open'); input().setAttribute('aria-expanded', 'true'); active = -1; };
    const closeList = () => { const l = list(); if (l) l.classList.remove('open'); const i = input(); if (i) i.setAttribute('aria-expanded', 'false'); };
    const add = (k) => {
      const ex = loadExtra(); if (!XKPI[k] || ex.includes(k)) return;
      ex.push(k); saveExtra(ex); state.kpiTab = XKPI[k].g;
      renderKpiWrap(k);
      showToast(`<span class="tg-t">Added <b>${esc(XKPI[k].t)}</b> to ${KPI_CAT[XKPI[k].g]}</span>`);
    };
    w.addEventListener('click', (e) => {
      const tab = e.target.closest('.kpi-tab');
      if (tab) {
        closeKpiPop(); state.kpiTab = +tab.dataset.g;
        w.querySelectorAll('.kpi-tab').forEach((t) => { const on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
        w.querySelectorAll('.kpis').forEach((p) => { p.hidden = p.dataset.g !== tab.dataset.g; });
        return;
      }
      const rm = e.target.closest('.kx-rm');
      if (rm) { e.stopPropagation(); saveExtra(loadExtra().filter((x) => x !== rm.dataset.rm)); renderKpiWrap(); return; }
      if (e.target.closest('#kxOpen')) { const l = list(); if (l.classList.contains('open')) closeList(); else { openList(input().value); input().focus(); } return; }
      const li = e.target.closest('li[data-add]'); if (li) { add(li.dataset.add); return; }
    });
    w.addEventListener('mousedown', (e) => { if (e.target.closest('li[data-add]')) e.preventDefault(); });
    w.addEventListener('input', (e) => { if (e.target.id === 'kxInput') openList(e.target.value); });
    w.addEventListener('focusin', (e) => { if (e.target.id === 'kxInput') openList(e.target.value); });
    w.addEventListener('keydown', (e) => {
      if (e.target.id === 'kxInput') {
        const items = Array.from(list().querySelectorAll('li[data-add]'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); if (!items.length) return;
          active = e.key === 'ArrowDown' ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1);
          items.forEach((x, i) => x.classList.toggle('active', i === active)); items[active].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') { e.preventDefault(); const it = items[Math.max(0, active)]; if (it) add(it.dataset.add); }
        else if (e.key === 'Escape') closeList();
        return;
      }
      if (e.target.closest('.kpi-tabs') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const tabs = Array.from(w.querySelectorAll('.kpi-tab')), i = tabs.indexOf(document.activeElement); if (i < 0) return;
        const nx = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; nx.focus(); nx.click(); e.preventDefault();
      }
    });
    if (!window.__plutusKxDoc) { window.__plutusKxDoc = true; document.addEventListener('click', (e) => { if (!e.target.closest('#kxAdd')) { const l = $('#kxList'); if (l) l.classList.remove('open'); } }); }
  }

  /* ---------- KPI cards ---------- */
  // 12 cards in 3 categories of 4 (the 4 most useful for that question), each category filling the full width.
  const KPI_GROUPS = [
    { name: 'Growth & Profit', icon: 'trend', sub: 'Is it growing and earning?', keys: ['rev', 'ni', 'nm', 'eps'] },
    { name: 'Value & Returns', icon: 'tag', sub: 'What you pay, what you get', keys: ['pe', 'dy', 'r1', 'roe'] },
    { name: 'Safety & Cash', icon: 'shield', sub: 'How strong are its finances?', keys: ['de', 'cr', 'fcf', 'vol'] }
  ];
  function kpiGroupsHTML(m) {
    const byKey = {};
    kpiCards(m).forEach((html) => { const k = (html.match(/data-k="([^"]+)"/) || [])[1]; if (k) byKey[k] = html; });
    const extra = loadExtra(), cur = Math.max(0, Math.min(2, state.kpiTab || 0));
    const tabs = KPI_GROUPS.map((g, i) => { const n = 4 + extra.filter((k) => XKPI[k].g === i).length;
      return `<button type="button" class="kpi-tab${i === cur ? ' on' : ''}" role="tab" id="kpiTab${i}" aria-controls="kpiPanel${i}" aria-selected="${i === cur}" tabindex="${i === cur ? 0 : -1}" data-g="${i}" title="${esc(g.sub)}"><span class="kt-ic">${ico(g.icon)}</span><span class="kt-name">${g.name}</span><span class="kt-n">${n}</span></button>`; }).join('');
    const panels = KPI_GROUPS.map((g, i) => `<div class="kpis" role="tabpanel" id="kpiPanel${i}" aria-labelledby="kpiTab${i}" data-g="${i}"${i === cur ? '' : ' hidden'}>${g.keys.map((k) => byKey[k] || (k === 'de' ? byKey.eqa : '') || '').join('')}${extra.filter((k) => XKPI[k].g === i).map((k) => xCard(k, m)).join('')}</div>`).join('');
    return `${kpiAddHTML()}<div class="kpi-tabs" role="tablist" aria-label="Key number categories">${tabs}</div>${panels}`;
  }
  function kpiCards(m) {
    const c = m.finCurrency;
    const lvl = (v, good, bad, higherBetter = true) => (!isNum(v) ? '' : higherBetter ? (v >= good ? 'good' : v <= bad ? 'bad' : 'warn') : (v <= good ? 'good' : v >= bad ? 'bad' : 'warn'));
    const card = (k, v, sub, dot, ik) => `<div class="kpi" data-k="${ik}"><div class="k"><span class="ki ${dot}">${ico(KPI_ICON[ik] || 'avg')}</span><span class="k-label">${k}</span><button type="button" class="info" data-k="${ik}" aria-label="What does ${k} mean?" aria-haspopup="dialog" aria-expanded="false" aria-controls="kpiPop">i</button></div><div class="v">${v}</div><div class="sub swap"><span class="sw-a">${sub}</span><span class="sw-b cmpc" data-ind="${ik}" data-t="line"></span></div></div>`;
    const yoy = (g) => (isNum(g) ? `<span class="${signCls(g)}">${fmtPct(g, 1, true)}</span> vs last year` : 'vs last year: —');
    const fin = m.isFinancial;
    state.kpiInfo = { ...kpiExplanations(m), ...xExplanations(m) };
    return [
      card('Revenue', fmtMoney(m.revLast, c), yoy(m.revYoY), lvl(m.revYoY, 0.08, 0), 'rev'),
      card('Net Profit', fmtMoney(m.niLast, c), isNum(m.niYoY) ? yoy(m.niYoY) : (isNum(m.niLast) && m.niLast < 0 ? '<span class="bad">Net loss</span>' : '—'), isNum(m.niLast) && m.niLast < 0 ? 'bad' : lvl(m.niYoY, 0.08, 0), 'ni'),
      card('Net Margin', fmtPct(m.netMargin), isNum(m.netMarginPrev) ? `prev. year ${fmtPct(m.netMarginPrev)}` : '—', lvl(m.netMargin, 0.12, 0.04), 'nm'),
      card('P/E Ratio', m.negEarnings ? 'n/a' : fmtX(m.pe, 1), m.negEarnings ? '<span class="bad">loss-making</span>' : isNum(m.peMedian) && isNum(m.pe) ? `5-yr median ${fmtX(m.peMedian, 1)}` : isNum(m.fwdPe) ? `forward ${fmtX(m.fwdPe, 1)}` : '—', m.negEarnings ? 'bad' : lvl(m.pe, 18, 40, false), 'pe'),
      card('ROE', fmtPct(m.roe), 'profit ÷ shareholders’ equity', lvl(m.roe, 0.15, 0.06), 'roe'),
      card(fin ? 'Equity / Assets' : 'Debt / Equity', fin ? fmtPct(m.equityToAssets) : fmtX(m.de, 2), fin ? 'owners’ cushion (financial co.)' : 'debt per 1 of owners’ money', fin ? lvl(m.equityToAssets, 0.12, 0.06) : lvl(m.de, 0.5, 1.5, false), fin ? 'eqa' : 'de'),
      card('Free Cash Flow', fmtMoney(m.fcfLast, c), isNum(m.fcfMargin) ? `${fmtPct(m.fcfMargin)} of revenue` : '—', isNum(m.fcfLast) ? (m.fcfLast > 0 ? 'good' : 'bad') : '', 'fcf'),
      card('Current Ratio', fin ? 'n/a' : fmtX(m.currentRatio, 2), fin ? 'not meaningful for financials' : 'short-term assets ÷ short-term bills', fin ? '' : lvl(m.currentRatio, 1.5, 1), 'cr'),
      card('EPS (TTM)', isNum(m.ttmEps) ? m.ttmEps.toFixed(2) : '—', `${esc(m.ttmEpsCur || c)} per share · last 12 months`, isNum(m.ttmEps) ? (m.ttmEps > 0 ? 'good' : 'bad') : '', 'eps'),
      card('Dividend Yield', isNum(m.divYield) ? fmtPct(m.divYield, 2) : '—', isNum(m.divYield) && m.divYield > 0 ? 'yearly dividend ÷ share price' : 'no regular dividend', isNum(m.divYield) && m.divYield >= 0.015 ? 'good' : '', 'dy'),
      card('1-Year Return', fmtPct(m.ret1y, 1, true), isNum(m.ret5y) ? `5-yr ${fmtPct(m.ret5y, 0, true)}` : 'share-price change', lvl(m.ret1y, 0.1, -0.1), 'r1'),
      card('Volatility', fmtPct(m.vol, 0), isNum(m.maxDD) ? `biggest fall from a high ${fmtPct(m.maxDD, 0)}` : '—', lvl(m.vol, 0.25, 0.45, false), 'vol')
    ];
  }

  /* ====================== KPI EXPLANATIONS (the ⓘ on each Key Number) ======================
     Each explanation answers, in plain words: what the number is · how it's worked out (exactly as PLUTUS computes
     it) · what it means for THIS company, with its own figures · how to read it · what the card's colour means (the
     thresholds the card actually uses). Shown in one shared popover: next to the card on wider screens, as a sheet at
     the bottom on phones. Opens on hover (mouse) or tap / Enter; closes with Esc, a tap outside, or ×. */
  function kpiExplanations(m) {
    const fc = m.finCurrency, pc = m.currency;
    const S = (cur) => A.curSym(cur) || (cur ? cur + ' ' : '');      // "$", "₹", "CHF "
    const sf = S(fc), sp = S(pc);
    // examples use the same rounding as the card (one decimal), so "25.5%" reads as "$25.5 of every $100", not "$25"
    const n0 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const c = (good, mid, bad) => [['good', good], ['warn', mid], ['bad', bad]].filter((x) => x[1]);
    const fin = m.isFinancial;
    const E = {};
    E.rev = { t: 'Revenue', what: 'All the money the company earned from selling its products or services in its latest financial year — before any costs are taken off. Also called sales, turnover or the "top line".',
      calc: fin ? 'Total income from the business in the year (for banks: mainly interest earned on loans, plus fees)' : 'Everything customers paid for the company’s goods and services in the year',
      you: isNum(m.revLast) ? `${fmtMoney(m.revLast, fc)} in the latest year${isNum(m.revYoY) ? ` — ${m.revYoY >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(m.revYoY), 1)} on the year before` : ''}.` : '',
      read: 'Rising revenue usually means more customers, more sold or higher prices. On its own it says nothing about profit — read it with Net Profit and Net Margin.',
      col: c('growing 8% or more a year', 'growing 0–8%', 'flat or shrinking') };
    E.ni = { t: 'Net Profit', what: 'What is left of revenue after paying every cost — materials, salaries, rent, interest and tax. Also called the "bottom line" or PAT (profit after tax). A negative number is a loss.',
      calc: 'Revenue − all costs − interest − tax',
      you: isNum(m.niLast) ? (m.niLast < 0 ? `A loss of ${fmtMoney(Math.abs(m.niLast), fc)} in the latest year.` : `${fmtMoney(m.niLast, fc)} in the latest year${isNum(m.niYoY) ? ` — ${m.niYoY >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(m.niYoY), 1)} on the year before` : ''}.`) : '',
      read: 'One-off items (selling a business, a big write-off) can make a single year look unusually good or bad, so check the trend over several years in Trajectory.',
      col: c('up 8% or more on last year', 'up 0–8%', 'falling, or a loss') };
    E.nm = { t: 'Net Margin', what: 'How much of each sale the company keeps as profit after every cost.',
      calc: 'Net profit ÷ revenue × 100',
      you: isNum(m.netMargin) ? `${fmtPct(m.netMargin)} → it keeps about ${sf}${n0(m.netMargin * 100)} as profit from every ${sf}100 of sales.` : '',
      read: 'Higher = more efficient, or more pricing power. Normal levels differ a lot between industries — supermarkets run on thin margins, software companies on wide ones — so compare it with similar companies.',
      col: c('12% or more', '4–12%', 'below 4%') };
    E.eps = { t: 'EPS (TTM)', what: 'The company’s profit split equally across all its shares — the profit "earned" by each single share. It is not cash paid to you (that’s the dividend).',
      calc: 'Net profit over the last 12 months ÷ number of shares (TTM = trailing twelve months)',
      you: isNum(m.ttmEps) ? `${m.ttmEps.toFixed(2)} ${m.ttmEpsCur || fc} of profit per share over the last 12 months${m.ttmEps < 0 ? ' — a loss per share' : ''}.` : '',
      read: 'Best for following one company over time: rising EPS means profit per share is growing. Don’t compare EPS between companies — it depends on how many shares each has issued (that’s why it has no industry average).',
      col: c('positive (profitable)', '', 'negative (loss-making)') };
    E.pe = { t: 'P/E Ratio', what: 'How much investors are paying for each 1 of the company’s yearly profit.',
      calc: 'Share price ÷ earnings per share over the last 12 months',
      you: m.negEarnings ? 'The company made a loss over the last 12 months, so there is no profit to divide by and P/E can’t be calculated.'
        : isNum(m.pe) ? `P/E ${fmtX(m.pe, 1)} → investors pay about ${sp}${n0(m.pe)} for every ${sp}1 of yearly profit. If profit stayed exactly the same, it would take about ${Math.round(Math.round(m.pe * 10) / 10)} years of profit to add up to today’s share price.` : '',
      read: 'A high P/E usually means investors expect fast growth — or that the share is expensive. A low P/E can mean it is cheap — or that investors expect trouble. Compare it with the company’s own history (Trajectory) and its peers, not with a fixed number.',
      col: c('18 or lower', '18–40', '40 or higher, or a loss') };
    E.dy = { t: 'Dividend Yield', what: 'The cash the company pays its shareholders each year, as a percentage of today’s share price.',
      calc: 'Yearly dividend per share ÷ share price × 100',
      you: isNum(m.divYield) && m.divYield > 0 ? `${fmtPct(m.divYield, 2)} → about ${sp}${(m.divYield * 100).toFixed(2)} a year in dividends for every ${sp}100 invested at today’s price.` : 'It doesn’t currently pay a regular dividend.',
      read: 'Dividends aren’t guaranteed — they can be raised, cut or stopped. A very high yield can be a warning sign that the share price has dropped sharply. Many fast-growing companies pay little or nothing and reinvest instead.',
      col: [['good', '1.5% or more'], ['none', 'below 1.5% or none (not a bad sign on its own)']] };
    E.r1 = { t: '1-Year Return', what: 'How much the share price has changed over the last 12 months.',
      calc: '(Price today ÷ price one year ago − 1) × 100 · dividends not included',
      you: isNum(m.ret1y) ? `${fmtPct(m.ret1y, 1, true)} → ${sp}100 put into the shares a year ago would be worth about ${sp}${Math.round(100 * (1 + m.ret1y)).toLocaleString('en-US')} today (before dividends).` : '',
      read: 'Past returns don’t predict future ones. A share can rise while the business weakens, or fall while it improves.',
      col: c('up 10% or more', 'between −10% and +10%', 'down more than 10%') };
    E.roe = { t: 'ROE — Return on Equity', what: 'How much profit the company makes with the money that belongs to its shareholders.',
      calc: 'Net profit ÷ shareholders’ equity × 100 · equity = what owners put in + profits kept in the business over the years',
      you: isNum(m.roe) ? `${fmtPct(m.roe)} → about ${sf}${n0(m.roe * 100)} of profit last year for every ${sf}100 of shareholders’ money in the business.` : '',
      read: 'Higher = owners’ money is being turned into profit efficiently. Heavy borrowing can push ROE up (less equity, same profit), so read it together with Debt / Equity.',
      col: c('15% or more', '6–15%', 'below 6%') };
    E.de = { t: 'Debt / Equity', what: 'How much the company has borrowed compared with the money that belongs to its owners.',
      calc: 'Total debt (loans and bonds) ÷ shareholders’ equity',
      you: isNum(m.de) ? `${fmtX(m.de, 2)} → it owes about ${sf}${n0(m.de * 100)} for every ${sf}100 of shareholders’ money.` : '',
      read: 'Lower = less reliance on lenders and less interest to pay when times are hard. Some debt is normal; power, telecom and real-estate companies usually borrow much more than software companies.',
      col: c('0.5× or lower', '0.5–1.5×', 'above 1.5×') };
    E.eqa = { t: 'Equity / Assets', what: 'For banks and insurers, borrowing (customer deposits, bonds) is how the business works, so a debt ratio would mislead. This shows the owners’ own cushion instead.',
      calc: 'Shareholders’ equity ÷ total assets × 100',
      you: isNum(m.equityToAssets) ? `${fmtPct(m.equityToAssets)} → about ${sf}${n0(m.equityToAssets * 100)} of owners’ money behind every ${sf}100 of assets (loans, investments …).` : '',
      read: 'This cushion takes losses first, before depositors or lenders are hurt — so higher = more buffer. Regulators use a stricter, more detailed version called the capital adequacy ratio.',
      col: c('12% or more', '6–12%', 'below 6%') };
    E.cr = { t: 'Current Ratio', what: 'Whether the company has enough short-term assets to pay the bills that fall due within a year.',
      calc: 'Current assets (cash, money customers owe, stock) ÷ current liabilities (bills and loans due within a year)',
      you: fin ? 'Not meaningful for banks and insurers — their balance sheets aren’t split into short-term and long-term items this way.'
        : isNum(m.currentRatio) ? `${fmtX(m.currentRatio, 2)} → about ${sf}${m.currentRatio.toFixed(2)} of short-term assets for every ${sf}1 due within a year.` : '',
      read: 'Above 1× means near-term assets cover near-term bills. Below 1× can mean cash is tight — though some businesses (e.g. retailers paid by customers upfront) run safely below 1.',
      col: fin ? [] : c('1.5× or more', '1–1.5×', 'below 1×') };
    E.fcf = { t: 'Free Cash Flow', what: 'The cash the business actually produced in the year, after paying its running costs and investing in equipment, factories and the like.',
      calc: 'Cash from operations − capital expenditure (spending on long-term assets)',
      you: isNum(m.fcfLast) ? `${fmtMoney(m.fcfLast, fc)} in the latest year${isNum(m.fcfMargin) ? ` — about ${sf}${n0(m.fcfMargin * 100)} of free cash for every ${sf}100 of revenue` : ''}.` : '',
      read: (fin ? 'Less meaningful for banks, whose cash flows include customer deposits and loans. ' : '') + 'Free cash can pay dividends, buy back shares, repay debt or fund growth without borrowing. Negative isn’t always bad — it can mean heavy investment for growth — but it can’t go on for ever.',
      col: c('positive', '', 'negative') };
    E.vol = { t: 'Volatility', what: 'How bumpy the share price has been over the last year — the size of its ups and downs, not their direction.',
      calc: 'Standard deviation of daily price changes over the last year, scaled up to a yearly figure',
      you: isNum(m.vol) ? `${fmtPct(m.vol, 0)} → in a typical year (about 2 years in 3) the price would end within roughly ±${fmtPct(m.vol, 0)} of its usual path.${isNum(m.maxDD) ? ` Biggest fall from a high in the last 12 months: ${fmtPct(m.maxDD, 0)}.` : ''}` : '',
      read: 'Higher = bigger swings both ways, which can be hard to sit through. It measures bumpiness, not the quality of the business.',
      col: c('25% or lower', '25–45%', 'above 45%') };
    return E;
  }
  function kpiPopHTML(k) {
    const e = state.kpiInfo[k]; if (!e) return '';
    const row = (label, v, cls) => (v ? `<div class="kx-row ${cls || ''}"><span class="kx-k">${label}</span><span class="kx-v">${v}</span></div>` : '');
    const col = (e.col || []).length ? `<span class="kx-cols">${e.col.map(([cl, t]) => `<span class="kx-c"><i class="${cl}"></i>${esc(t)}</span>`).join('')}</span>` : '';
    return `<div class="kx-head"><b id="kpiPopT">${esc(e.t)}</b><button type="button" class="kx-x" aria-label="Close">×</button></div>
      <p class="kx-what">${esc(e.what)}</p>
      ${row('How it’s worked out', esc(e.calc), 'kx-f')}
      ${row('This company', esc(e.you), 'kx-you')}
      ${row('How to read it', esc(e.read))}
      ${row('Card colour', col, 'kx-col')}`;
  }
  let kpiPop = null, kpiPopBtn = null, kpiPinned = false, kpiHoverT = null, kpiRaf = 0;
  function ensureKpiPop() {
    if (kpiPop) return kpiPop;
    kpiPop = document.createElement('div');
    kpiPop.className = 'kpi-pop'; kpiPop.id = 'kpiPop'; kpiPop.hidden = true;
    kpiPop.setAttribute('role', 'dialog'); kpiPop.setAttribute('aria-labelledby', 'kpiPopT');
    document.body.appendChild(kpiPop);
    kpiPop.addEventListener('click', (e) => { if (e.target.closest('.kx-x')) { const b = kpiPopBtn; closeKpiPop(); if (b) b.focus(); } e.stopPropagation(); });
    kpiPop.addEventListener('mouseenter', () => clearTimeout(kpiHoverT));
    kpiPop.addEventListener('mouseleave', () => { if (!kpiPinned) kpiHoverT = setTimeout(closeKpiPop, 220); });
    document.addEventListener('click', (e) => { if (kpiPop && !kpiPop.hidden && !e.target.closest('.kpi .info')) closeKpiPop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && kpiPop && !kpiPop.hidden) { const b = kpiPopBtn; closeKpiPop(); if (b) b.focus(); } });
    const follow = () => { if (!kpiPop.hidden && !kpiRaf) kpiRaf = requestAnimationFrame(placeKpiPop); };
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return kpiPop;
  }
  const sheetMode = () => window.matchMedia('(max-width: 640px)').matches;
  function placeKpiPop() {
    kpiRaf = 0;
    if (!kpiPop || kpiPop.hidden || !kpiPopBtn) return;
    if (!document.body.contains(kpiPopBtn) || !kpiPopBtn.offsetParent) { closeKpiPop(); return; }
    const sheet = sheetMode();
    kpiPop.classList.toggle('sheet', sheet);
    if (sheet) { kpiPop.style.left = kpiPop.style.top = ''; return; }
    const r = kpiPopBtn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) { if (!kpiPinned) closeKpiPop(); return; }
    const w = kpiPop.offsetWidth, h = kpiPop.offsetHeight;
    const left = Math.max(12, Math.min(vw - w - 12, r.right - w + 14));
    let top = r.bottom + 10;
    if (top + h > vh - 12 && r.top - h - 10 > 12) top = r.top - h - 10;  // no room below: open upwards
    kpiPop.style.left = left + 'px'; kpiPop.style.top = Math.max(12, top) + 'px';
  }
  function openKpiPop(btn, pinned) {
    const k = btn.dataset.k, html = kpiPopHTML(k); if (!html) return;
    ensureKpiPop();
    if (kpiPopBtn && kpiPopBtn !== btn) kpiPopBtn.setAttribute('aria-expanded', 'false');
    kpiPopBtn = btn; kpiPinned = !!pinned;
    kpiPop.innerHTML = html; kpiPop.hidden = false; kpiPop.dataset.k = k;
    btn.setAttribute('aria-expanded', 'true');
    document.querySelectorAll('.kpi.kx-on').forEach((x) => x.classList.remove('kx-on'));
    const card = btn.closest('.kpi'); if (card) card.classList.add('kx-on');
    placeKpiPop();
    requestAnimationFrame(() => kpiPop && kpiPop.classList.add('in'));
  }
  function closeKpiPop() {
    clearTimeout(kpiHoverT);
    if (!kpiPop || kpiPop.hidden) return;
    kpiPop.classList.remove('in'); kpiPop.hidden = true; kpiPinned = false;
    if (kpiPopBtn) kpiPopBtn.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.kpi.kx-on').forEach((x) => x.classList.remove('kx-on'));
    kpiPopBtn = null;
  }
  function wireKpiInfo(root) {
    const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
    root.querySelectorAll('.kpi .info').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kpiPopBtn === b && kpiPinned) { closeKpiPop(); return; }
        openKpiPop(b, true);
      });
      b.addEventListener('mouseenter', () => { if (!hover.matches || (kpiPinned && kpiPopBtn !== b)) return; clearTimeout(kpiHoverT); kpiHoverT = setTimeout(() => { if (!kpiPinned || kpiPopBtn !== b) openKpiPop(b, false); }, 120); });
      b.addEventListener('mouseleave', () => { if (!hover.matches) return; clearTimeout(kpiHoverT); if (!kpiPinned) kpiHoverT = setTimeout(closeKpiPop, 220); });
    });
  }

  function chartCard(id, title, what, takeaway, wide, extra) {
    return `<div class="chart-card ${wide ? 'wide' : ''}">
      <h3>${title}${extra || ''}</h3>
      <p class="what">${what}</p>
      <div class="chart-box" id="box-${id}"><canvas id="${id}"></canvas></div>
      <div class="takeaway ${takeaway ? '' : 'hidden'}" id="tk-${id}">${esc(takeaway || '')}</div>
    </div>`;
  }
  function swCol(cls, title, items, color) {
    return `<div class="sw-col ${cls}">
      <h3 class="${color}">${title} <span class="count">${items.length}</span></h3>
      ${items.length ? items.map((x) => `<div class="sw-item"><span class="bar"></span><div><div class="t">${esc(x.title)}${x.peer ? '<span class="peer-chip">VS INDUSTRY</span>' : ''}</div><div class="d">${esc(x.text)}</div></div><span class="m">${esc(x.metric)}</span></div>`).join('')
        : `<div class="sw-empty">Nothing stands out ${cls === 's' ? 'strongly on the positive side' : 'as a clear weak spot'} based on the available data.</div>`}
    </div>`;
  }

  /* ====================== INDUSTRY PEERS ====================== */
  const toIndustryKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const sameText = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  // ----- listing country: derived from the ticker's exchange suffix (no suffix = US exchanges) -----
  const SUFFIX_COUNTRY = {
    NS: 'IN', BO: 'IN', L: 'GB', T: 'JP', HK: 'HK', DE: 'DE', F: 'DE', SG: 'DE', TO: 'CA', V: 'CA', NE: 'CA', CN: 'CA', AX: 'AU', NZ: 'NZ',
    PA: 'FR', MI: 'IT', MC: 'ES', AS: 'NL', BR: 'BE', LS: 'PT', ST: 'SE', CO: 'DK', HE: 'FI', OL: 'NO', VI: 'AT', SW: 'CH', IR: 'IE',
    SS: 'CN', SZ: 'CN', KS: 'KR', KQ: 'KR', TW: 'TW', TWO: 'TW', SI: 'SG', SA: 'BR', MX: 'MX', JO: 'ZA', TA: 'IL', BK: 'TH', JK: 'ID',
    KL: 'MY', SR: 'SA', IS: 'TR', WA: 'PL', AT: 'GR'
  };
  const COUNTRY_NAME = {
    US: 'the United States', IN: 'India', GB: 'the United Kingdom', JP: 'Japan', HK: 'Hong Kong', DE: 'Germany', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand',
    FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'the Netherlands', BE: 'Belgium', PT: 'Portugal', SE: 'Sweden', DK: 'Denmark', FI: 'Finland', NO: 'Norway',
    AT: 'Austria', CH: 'Switzerland', IE: 'Ireland', CN: 'China', KR: 'South Korea', TW: 'Taiwan', SG: 'Singapore', BR: 'Brazil', MX: 'Mexico', ZA: 'South Africa',
    IL: 'Israel', TH: 'Thailand', ID: 'Indonesia', MY: 'Malaysia', SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', GR: 'Greece'
  };
  const marketOf = (sym) => {
    const i = String(sym || '').lastIndexOf('.');
    if (i < 0) return 'US';
    const suf = sym.slice(i + 1).toUpperCase();
    return SUFFIX_COUNTRY[suf] || 'X:' + suf;
  };
  const countryName = (code) => COUNTRY_NAME[code] || '';

  // field: 'industry' (same industry) or 'sector' (wider fallback). Always restricted to the company's listing country.
  function screenerBody(m, field) {
    const ops = [{ operator: 'EQ', operands: [field, field === 'sector' ? m.sector : m.industry] }];
    const mk = marketOf(m.symbol);
    if (/\.NS$/.test(m.symbol)) ops.push({ operator: 'EQ', operands: ['exchange', 'NSI'] });
    else if (/\.BO$/.test(m.symbol)) ops.push({ operator: 'EQ', operands: ['exchange', 'BSE'] });
    else if (mk.length === 2) ops.push({ operator: 'EQ', operands: ['region', mk.toLowerCase()] });
    return { size: 40, offset: 0, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY', topOperator: 'AND', query: { operator: 'AND', operands: ops }, userId: '', userIdType: 'guid' };
  }
  function collectSymbols(node, out, depth) {
    if (!node || depth > 8) return out;
    if (Array.isArray(node)) node.forEach((n) => collectSymbols(n, out, depth + 1));
    else if (typeof node === 'object') {
      if (typeof node.symbol === 'string' && node.symbol && node.symbol[0] !== '^') out.push({ symbol: node.symbol, name: node.name || node.longName || node.shortName || '' });
      Object.values(node).forEach((v) => { if (v && typeof v === 'object') collectSymbols(v, out, depth + 1); });
    }
    return out;
  }
  const rawNum = (v) => (isNum(v) ? v : v && isNum(v.raw) ? v.raw : null);

  // Collect candidate companies. Several sources, because any single one can be unavailable or return too few names.
  // `diag` records what each source returned so a "no peers" result can be explained instead of silently empty.
  async function gatherCandidates(m, my, diag) {
    const out = new Map();
    const myMarket = marketOf(m.symbol);
    const sameMkt = (x) => marketOf(x) === myMarket; // peers must be listed in the same country
    diag.market = myMarket;
    const add = (sym, name, mc, src) => { if (sym && sym !== m.symbol && sameMkt(sym) && !out.has(sym)) out.set(sym, { symbol: sym, name, marketCap: mc, src }); };
    const indCount = () => [...out.values()].filter((c) => c.src === 'screener' || c.src === 'industry').length;
    const runScreener = async (field, src) => {
      try {
        const r = await Yahoo.screener(screenerBody(m, field), bg(my));
        const res = r && r.finance && r.finance.result && r.finance.result[0];
        const list = (res && (res.quotes || res.records)) || [];
        list.forEach((q) => add(q.symbol, q.longName || q.shortName || q.displayName || '', rawNum(q.marketCap), src));
        diag[src] = list.length;
      } catch (e) { diag[src] = 'error: ' + e.message; }
    };
    // 1) Yahoo screener: every listed company in this industry (needs the updated Worker)
    if (m.industry) await runScreener('industry', 'screener');
    // 2) Yahoo's industry page: the industry's top companies
    if (m.industry && indCount() < 6) {
      try {
        const r = await Yahoo.industry(m.industryKey || toIndustryKey(m.industry), bg(my));
        const l = collectSymbols(r, [], 0);
        l.forEach((x) => add(x.symbol, x.name, null, 'industry'));
        diag.industryPage = l.length;
      } catch (e) { diag.industryPage = 'error: ' + e.message; }
    }
    // 3) Yahoo's "similar companies" (kept only if they pass the industry/sector check below)
    if (out.size < 8) {
      try {
        const r = await Yahoo.recs(m.symbol, bg(my));
        const list = (r.finance && r.finance.result && r.finance.result[0] && r.finance.result[0].recommendedSymbols) || [];
        list.forEach((x) => add(x.symbol, '', null, 'recs'));
        diag.similar = list.length;
      } catch (e) { diag.similar = 'error: ' + e.message; }
    }
    // 4) Same SECTOR: fallback pool for companies whose exact industry has few (or no) listed peers, e.g. Apple
    if (m.sector && indCount() < 6) await runScreener('sector', 'screenerSector');
    const logGap = (c) => (isNum(c.marketCap) && isNum(m.marketCap) && c.marketCap > 0 && m.marketCap > 0 ? Math.abs(Math.log(c.marketCap / m.marketCap)) : 99);
    const prio = { screener: 0, industry: 1, recs: 2, screenerSector: 3 };
    const arr = [...out.values()].sort((a, b) => prio[a.src] - prio[b.src] || logGap(a) - logGap(b));
    diag.candidates = arr.length;
    return arr.slice(0, 18);
  }

  // Returns { models, level: 'industry' | 'sector' | 'similar' } or null
  async function findIndustryPeers(m, my, diag) {
    const cands = await gatherCandidates(m, my, diag);
    if (my !== loadSeq || !cands.length) return null;
    const sums = await pool(cands, 4, (c) => Yahoo.summary(c.symbol, bg(my)));
    if (my !== loadSeq) return null;
    diag.profiles = `${sums.filter((x) => x.ok).length}/${cands.length}`;
    const seen = new Set([norm(m.name)]);
    const rows = [];
    // .NS listings first so the NSE copy of a dual-listed company wins
    cands.map((c, i) => ({ c, s: sums[i] })).sort((a, b) => (/\.NS$/.test(b.c.symbol) ? 1 : 0) - (/\.NS$/.test(a.c.symbol) ? 1 : 0)).forEach(({ c, s }) => {
      if (!s.ok || marketOf(c.symbol) !== marketOf(m.symbol)) return;
      const S = A.parseSummary(s.v), pr = S.price || {}, ap = S.assetProfile || {};
      const nm = pr.longName || pr.shortName || c.name || c.symbol;
      const key = norm(nm); if (seen.has(key)) return; // same company listed twice
      const mc = rawNum(pr.marketCap) ?? c.marketCap;
      rows.push({ c, S, nm, key, mc, industry: ap.industry || '', sector: ap.sector || '', cur: pr.currency });
      seen.add(key);
    });
    let pick, level;
    const inInd = m.industry ? rows.filter((r) => sameText(r.industry, m.industry)) : [];
    const inSec = m.sector ? rows.filter((r) => !sameText(r.industry, m.industry) && sameText(r.sector, m.sector)) : [];
    diag.sameIndustry = inInd.length; diag.sameSector = inSec.length;
    if (inInd.length >= 3) { pick = inInd; level = 'industry'; }
    else if (inInd.length + inSec.length >= 3) { pick = [...inInd, ...inSec]; level = 'sector'; }
    else if (inInd.length >= 2) { pick = inInd; level = 'industry'; }
    else if (inInd.length + inSec.length >= 2) { pick = [...inInd, ...inSec]; level = 'sector'; }
    else if (!m.industry && !m.sector && rows.length >= 2) { pick = rows; level = 'similar'; }
    else return null;
    // Keep the 6 closest in size (same-industry names always come first)
    const gap = (r) => (isNum(r.mc) && isNum(m.marketCap) && r.mc > 0 && m.marketCap > 0 ? Math.abs(Math.log(r.mc / m.marketCap)) : 99);
    pick = pick.sort((a, b) => (level === 'sector' ? (sameText(b.industry, m.industry) - sameText(a.industry, m.industry)) : 0) || gap(a) - gap(b)).slice(0, 6);
    // Full models for each peer so every metric is computed exactly like the main company's
    const built = await pool(pick, 3, async (r) => {
      const [c5, c1, ts] = await Promise.allSettled([Yahoo.chart(r.c.symbol, '5y', '1wk', bg(my)), Yahoo.chart(r.c.symbol, '1y', '1d', bg(my)), Yahoo.timeseries(r.c.symbol, bg(my))]);
      const val = (x) => (x.status === 'fulfilled' ? x.value : null);
      const sumRes = sums[cands.indexOf(r.c)].v;
      return A.buildModel(r.c.symbol, val(c5), val(c1), val(ts), sumRes, { name: r.nm });
    });
    if (my !== loadSeq) return null;
    // Peers that report or trade in another currency (e.g. a Japanese company's US listing) are kept: ratios and percentages are
    // comparable; only their money amounts are left out of the averages (see computeIndustryAvg).
    const models = built.filter((x) => x.ok).map((x) => x.v).filter((x) => x.hasFundamentals || isNum(x.marketCap));
    diag.peersBuilt = `${models.length}/${pick.length}`;
    if (models.length < 2) return null;
    return { models, level };
  }

  async function loadPeers(m, my) {
    const diag = {};
    const fail = (msg) => {
      if (my !== loadSeq) return;
      state.ind = null; state.peerCmp = null; state.indStatus = 'fail';
      const detail = Object.entries(diag).map(([k, v]) => `${k}: ${v}`).join(' · ');
      const hint = Object.values(diag).some((v) => /HTTP (400|403|404|405)/.test(String(v))) ? ' The peer-lookup request was refused — make sure the latest worker.js is deployed on Cloudflare.' : '';
      const w = $('#peerWrap'); if (w) w.innerHTML = `<div class="nodata"><div>${esc(msg)}${hint ? `<div class="diag">${esc(hint.trim())}</div>` : ''}${detail ? `<div class="diag">Lookup details — ${esc(detail)}</div>` : ''}</div></div>`;
      fillIndustryUI();
      applyCompare();
    };
    try {
      const found = await findIndustryPeers(m, my, diag);
      if (my !== loadSeq) return;
      console.info('[PLUTUS peers]', m.symbol, m.industry, diag);
      const where = countryName(marketOf(m.symbol));
      if (!found) return fail(m.industry ? `Couldn’t find enough peers for “${m.industry}”${where ? ' listed in ' + where : ' in the same market'} right now.` : 'Yahoo Finance has no industry information for this company.');
      state.ind = { models: found.models, level: found.level, n: found.models.length, avg: computeIndustryAvg(found.models) };
      state.indStatus = 'ok';
      fillIndustryUI();
      applyCompare();
      refreshIndustryCharts();
      nudgeCompare();
      const mainRow = A.peerRowFromModel(m, true);
      const peerRows = found.models.map((x) => { const r = A.peerRowFromModel(x, false); if (x.currency !== m.currency) r.marketCap = null; return r; });
      const cmp = A.peerCompare(mainRow, peerRows, m.isFinancial);
      state.peerCmp = cmp;
      renderPeers(m, cmp, found.level);
      const sw = $('#swWrap');
      if (sw && (cmp.strengths.length || cmp.weaknesses.length)) {
        const tag = (arr) => arr.map((x) => ({ ...x, peer: true }));
        sw.innerHTML = swCol('s', 'Strengths', [...m.strengths, ...tag(cmp.strengths)], 'good') + swCol('w', 'Weaknesses', [...m.weaknesses, ...tag(cmp.weaknesses)], 'bad');
      }
    } catch (e) { console.error(e); diag.error = e.message; fail('Couldn’t load industry peers (' + e.message + ').'); }
  }

  /* ====================== SHAREHOLDING PATTERN ====================== */
  const rawv = (x) => (x && typeof x === 'object' ? x.raw : x);
  function parseHolders(res) {
    const r = res && res.quoteSummary && res.quoteSummary.result && res.quoteSummary.result[0];
    if (!r) return null;
    const mh = r.majorHoldersBreakdown || {};
    const num = (x) => { const v = rawv(x); return isNum(v) ? v : null; };
    // Yahoo's pctChange = how much that holder changed ITS OWN stake since the previous filing.
    // dpp turns it into percentage points of ALL the company's shares:  now - before,  where before = now / (1 + change).
    const list = (o) => ((o && o.ownershipList) || [])
      .map((x) => {
        const pct = num(x.pctHeld), chg = num(x.pctChange);
        const dpp = pct != null && chg != null && chg > -1 ? (pct - pct / (1 + chg)) * 100 : null;
        return { name: x.organization, pct, chg, dpp, date: num(x.reportDate) };
      })
      .filter((x) => x.name && x.pct != null && x.pct > 0)
      .sort((a, b) => b.pct - a.pct).slice(0, 10);
    // insiders: net buying / selling over the last 6 months
    const na = r.netSharePurchaseActivity || {};
    const buys = num(na.buyInfoShares), sells = num(na.sellInfoShares);
    let net = num(na.netInfoShares);
    if (net == null && (buys != null || sells != null)) net = (buys || 0) - Math.abs(sells || 0);
    const act = net == null ? null : { net, period: na.period || '6m' };
    const h = { ins: num(mh.insidersPercentHeld), inst: num(mh.institutionsPercentHeld), instFloat: num(mh.institutionsFloatPercentHeld), count: num(mh.institutionsCount),
      insts: list(r.institutionOwnership), funds: list(r.fundOwnership), act };
    if (h.ins == null && h.inst == null && !h.insts.length && !h.funds.length) return null;
    return h;
  }
  // Three groups: insiders / institutions / everyone else. If the source figures add up to more than 100%, the crowd is scaled to 100.
  function holdSegments(h) {
    const ins = h.ins, inst = h.inst, known = (ins || 0) + (inst || 0);
    const others = Math.max(0, 1 - known), total = Math.max(1, known);
    const segs = [];
    if (ins != null) segs.push({ key: 'ins', label: 'Promoters & insiders', value: ins });
    if (inst != null) segs.push({ key: 'inst', label: 'Institutions', value: inst });
    segs.push({ key: 'pub', label: 'Public & others', value: others });
    segs.forEach((x) => { x.share = x.value / total; });
    return { segs, scaled: known > 1.02 };
  }

  /* ---------- change since the previous filing ---------- */
  const fmtPP = (v) => { const a = Math.abs(v); return a < 0.005 ? '≈0 pp' : (v > 0 ? '+' : '−') + a.toFixed(2) + ' pp'; };
  function moveStats(list) {
    const ch = list.filter((x) => isNum(x.dpp));
    if (!ch.length) return null;
    const up = ch.filter((x) => x.dpp >= 0.005).sort((a, b) => b.dpp - a.dpp);
    const dn = ch.filter((x) => x.dpp <= -0.005).sort((a, b) => a.dpp - b.dpp);
    return { up, dn, net: ch.reduce((a, x) => a + x.dpp, 0), n: ch.length, flat: ch.length - up.length - dn.length };
  }
  const trend = (v) => (v >= 0.005 ? 'good' : v <= -0.005 ? 'bad' : 'muted');
  const arrow = (v) => (v >= 0.005 ? '▲' : v <= -0.005 ? '▼' : '•');
  const periodLbl = (p) => String(p).replace(/^(\d+)\s*m$/i, '$1 mo');
  function changeChip(key, h) {
    if (key === 'ins' && h.act) {
      const n = h.act.net;
      return `<span class="cl-chg ${trend(n)}">${arrow(n)} ${n >= 0.005 ? 'Net buying' : n <= -0.005 ? 'Net selling' : 'No net trades'} · ${esc(periodLbl(h.act.period))}</span>`;
    }
    if (key === 'inst') {
      const m = moveStats(h.insts);
      if (m) return `<span class="cl-chg ${trend(m.net)}">${arrow(m.net)} ${fmtPP(m.net)} · top ${m.n} holders</span>`;
    }
    return '';
  }
  function holdListHTML(items) {
    if (!items.length) return '<li class="hl-empty">Not available for this company.</li>';
    const max = Math.max(...items.map((x) => x.pct));
    return items.map((x, i) => {
      const chg = isNum(x.dpp) && Math.abs(x.dpp) >= 0.005
        ? `<span class="hl-chg ${trend(x.dpp)}" title="Change in the share of the company held, since the previous filing">${arrow(x.dpp)} ${Math.abs(x.dpp).toFixed(2)} pp</span>` : '<span class="hl-chg"></span>';
      return `<li><span class="hl-n">${i + 1}</span><div class="hl-main"><div class="hl-row"><span class="hl-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="hl-pct">${fmtPct(x.pct, 2)}</span></div><div class="hl-bar"><i style="width:${Math.max(2, x.pct / max * 100).toFixed(1)}%"></i></div></div>${chg}</li>`;
    }).join('');
  }
  function movesHTML(list) {
    const m = moveStats(list);
    if (!m) return '<p class="hold-empty">Change data isn’t available for this list.</p>';
    const max = Math.max(0.0001, ...m.up.concat(m.dn).map((x) => Math.abs(x.dpp)));
    const rows = (arr, cls) => arr.length
      ? arr.map((x) => `<li><div class="mv-row"><span class="mv-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="mv-val ${cls}">${fmtPP(x.dpp)}</span></div><div class="mv-bar"><i class="${cls}" style="width:${Math.max(4, Math.abs(x.dpp) / max * 100).toFixed(1)}%"></i></div></li>`).join('')
      : '<li class="mv-none">None</li>';
    return `<div class="mv-head"><b>Change since the previous filing</b><span class="mv-net ${trend(m.net)}">${arrow(m.net)} Net ${fmtPP(m.net)}</span></div>
      <div class="mv-grid">
        <div class="mv-col"><h4 class="good">▲ Added <span>${m.up.length}</span></h4><ul>${rows(m.up, 'good')}</ul></div>
        <div class="mv-col"><h4 class="bad">▼ Trimmed <span>${m.dn.length}</span></h4><ul>${rows(m.dn, 'bad')}</ul></div>
      </div>
      <p class="hold-note mv-note">pp = percentage points of all shares${m.flat ? ` · ${m.flat} unchanged` : ''}</p>`;
  }

  /* ---------- crowd of people ----------
     100 little people = 100% of the shares (1 person = 1%). Each colour is one kind of shareholder, so the size of
     each group is that group's holding. Counts use the "largest remainder" method so they always add up to 100,
     and any holder with a visible stake gets at least one person.
     Wide screens: a grid. Phones: the same people arranged in a circle (one wedge per group). */
  const CROWD_N = 100;
  const PERSON = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="plutusPerson" viewBox="0 0 24 40"><circle cx="12" cy="7" r="6"/><path d="M2.5 40V24.5C2.5 18.7 6.7 15 12 15s9.5 3.7 9.5 9.5V40z"/></symbol></svg>';
  const personSvg = (cls, extra) => `<svg class="${cls}" viewBox="0 0 24 40"${extra || ''} aria-hidden="true" focusable="false"><use href="#plutusPerson"/></svg>`;
  function crowdCounts(segs) {
    const raw = segs.map((x) => x.share * CROWD_N), c = raw.map(Math.floor);
    let rem = CROWD_N - c.reduce((p, q) => p + q, 0);
    raw.map((r, i) => [r - c[i], i]).sort((p, q) => q[0] - p[0]).forEach((e) => { if (rem > 0) { c[e[1]]++; rem--; } });
    segs.forEach((x, i) => { if (c[i] === 0 && x.value >= 0.004) { c[c.indexOf(Math.max(...c))]--; c[i] = 1; } });
    return c;
  }
  const SIZES = ['', 'v1', 'v2', 'v3', 'v4']; // a few slightly different heights so it reads as a crowd, not a grid
  function crowdHTML(segs, counts) {
    let i = 0, out = '';
    segs.forEach((x, k) => { for (let n = 0; n < counts[k]; n++, i++) out += personSvg(`pp g-${x.key} ${SIZES[(i * 7 + k * 3) % SIZES.length]}`, ` data-g="${x.key}" style="--i:${i};--c:${x.col || 'var(--pub)'}"`); });
    return out;
  }
  // Circle layout: 100 points spread evenly over a disc (sunflower pattern), then ordered clockwise from the top,
  // so handing them out group by group makes each group one wedge of the circle.
  let DISC = null;
  function discPoints() {
    if (DISC) return DISC;
    const N = CROWD_N, R = 0.44, ga = Math.PI * (3 - Math.sqrt(5)), pts = [];
    for (let i = 0; i < N; i++) {
      const r = R * Math.sqrt((i + 0.5) / N), t = i * ga, x = r * Math.cos(t), y = r * Math.sin(t);
      pts.push({ x, y, a: (Math.atan2(y, x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI) });
    }
    pts.sort((p, q) => p.a - q.a);
    return (DISC = pts);
  }
  function discHTML(segs, counts) {
    const pts = discPoints(), W = 5.2; let i = 0, out = '';
    segs.forEach((x, k) => {
      for (let n = 0; n < counts[k]; n++, i++) {
        const p = pts[i], w = W * (0.94 + ((i * 37) % 13) / 100), h = w * 40 / 24;
        out += personSvg(`pp g-${x.key}`, ` data-g="${x.key}" style="--i:${i};--c:${x.col || 'var(--pub)'};left:${(50 + p.x * 100 - w / 2).toFixed(2)}%;top:${(50 + p.y * 100 - h / 2).toFixed(2)}%;width:${w.toFixed(2)}%"`);
      }
    });
    return out;
  }

  async function loadHolders(m, my) {
    let res = null;
    for (let i = 0; i < 2 && !res; i++) {   // v12: a second try after a pause
      if (i) { await sleep(3000); if (my !== loadSeq) return; }
      try { res = await Yahoo.holders(m.symbol, { prio: PRIO.side, my }); } catch (e) { console.info('[PLUTUS holders]', m.symbol, e.message); if (e.status === 404 || e.cancelled) break; }
    }
    if (my !== loadSeq) return;
    const h = parseHolders(res);
    state.holders = h;
    renderHolders(h, !res);
    renderGov();
  }
  function renderHolders(h, failed) {
    const w = $('#holdWrap'); if (!w) return;
    const m = state.model || {}, ind = isIndian(m.symbol), s = state.shp;
    // Indian listings: wait for the exchange filing data (promoters / FIIs / DIIs …) before drawing anything
    if (ind && state.shpStatus === 'loading') { if (!w.querySelector('.peer-loading')) w.innerHTML = '<div class="peer-loading"><div class="orbit sm"><span></span></div><span>Loading shareholding…</span></div>'; return; }
    if (!s && h === undefined) { if (!w.querySelector('.peer-loading')) w.innerHTML = '<div class="peer-loading"><div class="orbit sm"><span></span></div><span>Loading shareholding…</span></div>'; return; }
    let segs, scaled = false, stats = '';
    if (s) {
      const q = s.q, i = q.dates.length - 1, j = Math.max(0, i - 4);
      segs = SHP_KEYS.map(([k, l]) => {
        const v = q.rows[k][i], a = q.rows[k][j];
        return { key: k, label: l, value: isNum(v) ? v : 0, col: `var(${SHP_COL[k]})`, sub: SHP_SUB[k], d: isNum(v) && isNum(a) && i >= 4 ? (v - a) * 100 : null };
      }).filter((x) => x.value >= 0.0005);
      const tot = segs.reduce((a, x) => a + x.value, 0) || 1;
      segs.forEach((x) => { x.share = x.value / tot; });
      scaled = Math.abs(tot - 1) > 0.02;
    } else if (h) {
      const hs = holdSegments(h); scaled = hs.scaled;
      const COL = { ins: 'var(--accent-2)', inst: 'var(--accent)', pub: 'var(--pub)' };
      segs = hs.segs.map((x) => ({ ...x, col: COL[x.key], chip: changeChip(x.key, h) }));
      stats = [
        isNum(h.count) ? `<div><b>${Math.round(h.count).toLocaleString('en-US')}</b><span>Institutions holding</span></div>` : '',
        isNum(h.instFloat) ? `<div><b>${fmtPct(h.instFloat, 1)}</b><span>Of free float held by institutions</span></div>` : ''
      ].join('');
    } else {
      w.innerHTML = `<div class="nodata"><div>${failed ? 'Shareholding data couldn’t be loaded right now.' : 'Shareholding data isn’t published for this company.'}</div></div>`;
      return;
    }
    const counts = crowdCounts(segs);
    const lead = segs.reduce((p, x, i) => (x.value > p.v ? { v: x.value, i } : p), { v: -1, i: 0 }), L = segs[lead.i];
    const legend = segs.map((x, k) => {
      const chg = x.chip != null ? x.chip : isNum(x.d) ? `<span class="cl-chg ${Math.abs(x.d) < 0.005 ? 'muted' : x.d > 0 ? 'good' : 'bad'}">${Math.abs(x.d) < 0.005 ? '• unchanged' : (x.d > 0 ? '▲ ' : '▼ ') + Math.abs(x.d).toFixed(2) + ' pp'} · 1 yr</span>` : '';
      return `<li><button type="button" class="cl-item" data-g="${x.key}" style="--c:${x.col}" aria-pressed="false">
        ${personSvg('cl-ico g-' + x.key)}
        <span class="cl-txt"><span class="cl-name">${x.label}</span><span class="cl-sub">${x.sub ? esc(x.sub) + ' · ' : ''}${counts[k]} of every 100 shares</span>${chg}</span>
        <span class="cl-val">${fmtPct(x.value, s ? 2 : 1)}</span></button></li>`;
    }).join('');
    const aria = `Crowd of 100 people showing who owns the shares: ${esc(segs.map((x, k) => `${counts[k]} ${x.label}`).join(', '))}`;
    const asOf = s ? `As of ${s.q.dates[s.q.dates.length - 1]} (latest filing with the exchanges)` : '';
    w.innerHTML = `${PERSON}
      <div class="panel crowd-panel">
        <div class="panel-title crowd-title"><span>Who owns the shares${asOf ? ` <small class="crowd-asof">· ${esc(asOf)}</small>` : ''}</span><span class="crowd-key">${personSvg('ck-ico')} = 1% of shares</span></div>
        <div class="crowd-wrap">
          <div class="crowd-vis">
            <div class="crowd crowd-grid" role="img" aria-label="${aria}">${crowdHTML(segs, counts)}</div>
            <div class="crowd crowd-disc" role="img" aria-label="${aria}">${discHTML(segs, counts)}</div>
          </div>
          <div class="crowd-side">
            <p class="crowd-lead"><b>${counts[lead.i]}</b> of every 100 shares are held by <span style="color:${L.col}">${L.label.toLowerCase()}</span>.</p>
            <ul class="crowd-legend">${legend}</ul>
            ${stats ? `<div class="hold-stats">${stats}</div>` : ''}
            ${scaled ? '<p class="hold-note">Source figures don’t add up to exactly 100%, so the crowd is scaled to 100.</p>' : ''}
          </div>
        </div>
      </div>
      ${s ? `<div class="shp-grid">${shpTrendHTML(s)}</div>` : ind ? '<p class="hold-note">The promoter / FII / DII history couldn’t be loaded right now, so this shows Yahoo Finance’s insiders / institutions split.</p>' : '<p class="hold-note">A promoter / FII / DII breakdown over time is published for Indian listings (NSE / BSE). For this company Yahoo Finance gives insiders and institutions.</p>'}
      <p class="hold-foot">Source: ${s ? 'quarterly shareholding pattern filed with NSE / BSE, via screener.in' : 'Yahoo Finance · can lag official filings'}.</p>`;
    // hover / tap a group (or a person) to light up that part of the crowd
    const cw = $('.crowd-wrap', w); let locked = null;
    const pps = Array.from(cw.querySelectorAll('.pp'));
    const setHl = (k) => {
      cw.classList.toggle('hl', !!k);
      pps.forEach((p) => p.classList.toggle('on', !!k && p.dataset.g === k));
      cw.querySelectorAll('.cl-item').forEach((b) => { b.classList.toggle('on', b.dataset.g === k); b.setAttribute('aria-pressed', locked === b.dataset.g ? 'true' : 'false'); });
    };
    cw.querySelectorAll('.cl-item').forEach((b) => {
      b.addEventListener('mouseenter', () => setHl(b.dataset.g));
      b.addEventListener('mouseleave', () => setHl(locked));
      b.addEventListener('focus', () => setHl(b.dataset.g));
      b.addEventListener('blur', () => setHl(locked));
      b.addEventListener('click', () => { locked = locked === b.dataset.g ? null : b.dataset.g; setHl(locked || b.dataset.g); });
    });
    cw.querySelectorAll('.crowd').forEach((c) => {
      c.addEventListener('mouseover', (e) => { const p = e.target.closest('.pp'); if (p) setHl(p.dataset.g); });
      c.addEventListener('mouseleave', () => setHl(locked));
    });
    const tg = $('#shpToggle');
    if (tg) tg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; tg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); drawShpCharts(); });
    if (s) drawShpCharts();
  }

  /* ====================== v13: SHAREHOLDING BY HOLDER TYPE, OVER TIME (Indian listings) ======================
     Source: the company's page on screener.in (fetched through the Worker), which lists the quarterly and yearly
     shareholding pattern filed with the exchanges: promoters, FIIs, DIIs, government, public (+ others) and the number
     of shareholders. It also gives the face value. Other listings keep Yahoo Finance's insiders / institutions split. */
  const SHP_KEYS = [['promoters', 'Promoters'], ['fiis', 'FIIs'], ['diis', 'DIIs'], ['government', 'Government'], ['public', 'Public']];
  const SHP_COL = { promoters: '--accent-2', fiis: '--accent', diis: '--good', government: '--warn', public: '--pub' };
  const SHP_SUB = { promoters: 'Founders / controlling group', fiis: 'Foreign institutions', diis: 'Indian funds, insurers, banks', government: 'Central / state government', public: 'Retail & others' };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  async function fetchText(url) {
    const key = 'pg:' + url;
    try { const x = JSON.parse(sessionStorage.getItem(key)); if (x && Date.now() - x.t < 6 * 3600e3) return x.d; } catch (e) { /* ignore */ }
    const routes = workerBase() ? [workerBase() + '/?url=' + encodeURIComponent(url)] : [];
    (CFG.PUBLIC_PROXIES || []).forEach((p) => routes.push(p + encodeURIComponent(url)));
    let last = new Error('no route');
    for (const r of routes) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(r, { signal: ctrl.signal });
        if (!res.ok) { last = new Error('HTTP ' + res.status); last.status = res.status; continue; }
        const txt = await res.text();
        if (txt.length < 500 || !/shareholding|top-ratios/i.test(txt)) { last = new Error('unexpected page'); continue; }
        try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: txt })); } catch (e) { /* quota */ }
        return txt;
      } catch (e) { last = e; } finally { clearTimeout(t); }
    }
    throw last;
  }
  const numOf = (s) => { const v = parseFloat(String(s || '').replace(/[,%₹\s]/g, '')); return isFinite(v) ? v : null; };
  function parseShpTable(tbl) {
    if (!tbl) return null;
    const head = Array.from(tbl.querySelectorAll('thead th')).map((th) => th.textContent.trim()).slice(1);
    if (!head.length) return null;
    const rows = {}; let holders = null;
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')); if (!cells.length) return;
      const name = cells[0].textContent.replace(/[+\s]+/g, ' ').trim().toLowerCase();
      const vals = cells.slice(1).map((td) => numOf(td.textContent));
      if (/^no\.? of shareholders/.test(name)) holders = vals;
      else if (/^promoter/.test(name)) rows.promoters = vals.map((v) => (isNum(v) ? v / 100 : null));
      else if (/^fii|^foreign/.test(name)) rows.fiis = vals.map((v) => (isNum(v) ? v / 100 : null));
      else if (/^dii|^domestic/.test(name)) rows.diis = vals.map((v) => (isNum(v) ? v / 100 : null));
      else if (/^government/.test(name)) rows.government = vals.map((v) => (isNum(v) ? v / 100 : null));
      else if (/^public/.test(name)) rows.public = vals.map((v) => (isNum(v) ? v / 100 : null));
      else if (/^others/.test(name)) rows.others = vals.map((v) => (isNum(v) ? v / 100 : null));
    });
    if (!rows.promoters && !rows.public) return null;
    // "Others" (if listed) is folded into Public, so the five groups always add up to about 100%
    if (rows.others) rows.public = (rows.public || head.map(() => 0)).map((v, i) => (isNum(v) || isNum(rows.others[i]) ? (v || 0) + (rows.others[i] || 0) : null));
    SHP_KEYS.forEach(([k]) => { if (!rows[k]) rows[k] = head.map(() => null); });
    return { dates: head, rows, holders: holders || head.map(() => null) };
  }
  function parseScreener(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let faceValue = null;
    doc.querySelectorAll('#top-ratios li').forEach((li) => {
      const n = (li.querySelector('.name') || {}).textContent || '';
      if (/face value/i.test(n)) faceValue = numOf((li.querySelector('.number') || li.querySelector('.value') || {}).textContent);
    });
    const sec = doc.querySelector('#shareholding') || doc;
    const q = parseShpTable(sec.querySelector('#quarterly-shp table') || sec.querySelector('table'));
    const y = parseShpTable(sec.querySelector('#yearly-shp table'));
    return { faceValue, q, y };
  }
  async function loadShareholding(m, my) {
    if (!isIndian(m.symbol)) { state.shp = null; state.shpStatus = 'na'; return; }
    state.shpStatus = 'loading';
    const base = m.symbol.replace(/\.(NS|BO)$/i, '');
    let parsed = null;
    for (const path of [`https://www.screener.in/company/${encodeURIComponent(base)}/consolidated/`, `https://www.screener.in/company/${encodeURIComponent(base)}/`]) {
      try { parsed = parseScreener(await fetchText(path)); if (parsed.q || parsed.faceValue) break; } catch (e) { console.info('[PLUTUS shareholding]', m.symbol, e.message); }
      if (my !== loadSeq) return;
    }
    if (my !== loadSeq) return;
    state.shp = parsed && parsed.q ? parsed : null;
    state.shpStatus = state.shp ? 'ok' : 'fail';
    if (parsed && isNum(parsed.faceValue)) m.faceValue = parsed.faceValue;
    if (state.shp) {
      const q = state.shp.q, i = q.dates.length - 1;
      m.shp = { asOf: q.dates[i], holders: q.holders[i] };
      SHP_KEYS.forEach(([k]) => { m.shp[k] = q.rows[k][i]; });
    }
    renderHolders(state.holders, state.holders === null);
    if (loadExtra().some((k) => ['fv', 'prom', 'fii', 'dii', 'pub', 'holders'].includes(k))) renderKpiWrap();
  }
  /* charts: holding % per group over time, and the number of shareholders */
  function drawShpCharts() {
    const s = state.shp; if (!s || !$('#box-chShp')) return;
    const per = (($('#shpToggle button.on') || {}).dataset || {}).p === 'y' && s.y ? s.y : s.q;
    resetBox('chShp'); resetBox('chHolders');
    const mob = isMobile();
    const sets = SHP_KEYS.filter(([k]) => per.rows[k].some((v) => isNum(v) && v > 0)).map(([k, l]) => {
      const col = cssVar(SHP_COL[k]);
      const actual = per.rows[k].map((v) => (isNum(v) ? +(v * 100).toFixed(2) : null));
      const base = actual.find(isNum);
      return { label: l, actual, data: actual.map((v) => (isNum(v) && isNum(base) ? +(v - base).toFixed(2) : null)), borderColor: col, backgroundColor: col,
        borderWidth: 2.4, pointRadius: mob ? 2 : 3, pointHoverRadius: 6, tension: 0.25, spanGaps: true };
    });
    // Plot percentage-point movement, not absolute ownership. Otherwise a ~63% promoter line forces the smaller FII/DII/public
    // series into a narrow strip at the bottom and hides the changes investors are trying to inspect.
    const moves = sets.flatMap((d) => d.data).filter(isNum);
    const rawLim = Math.max(0.25, ...moves.map(Math.abs));
    const lim = Math.ceil(rawLim * 1.18 * 4) / 4;
    mk('chShp', { type: 'line', data: { labels: per.dates, datasets: sets },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (x) => {
        const d = x.parsed.y, a = x.dataset.actual && x.dataset.actual[x.dataIndex];
        return `${x.dataset.label}: ${d > 0 ? '+' : ''}${d.toFixed(2)} pp${isNum(a) ? ` · ${a.toFixed(2)}% holding` : ''}`;
      } } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: mob ? 4 : 8 } },
          y: { min: -lim, max: lim, grid: { color: (x) => (x.tick.value === 0 ? tc().muted : tc().grid), lineWidth: (x) => (x.tick.value === 0 ? 1.5 : 1) },
            ticks: { maxTicksLimit: 7, callback: (v) => `${v > 0 ? '+' : ''}${v} pp` } } } } });
    const hv = per.holders;
    if (hv.some(isNum)) {
      const C = tc();
      mk('chHolders', { type: 'bar', data: { labels: per.dates, datasets: [{ label: 'Shareholders', data: hv, backgroundColor: grad(C.accent, 0.85), borderColor: C.accent, borderWidth: 1, borderRadius: 3, maxBarThickness: mob ? 16 : 28 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${Math.round(x.parsed.y).toLocaleString('en-IN')} shareholders` } } },
          scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: mob ? 4 : 6 } }, y: { ticks: { maxTicksLimit: 5, callback: (v) => compactNum(v) } } } } });
    } else noData('chHolders', 'Not published');
  }
  const compactNum = (v) => (Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(1) + ' Cr' : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + ' L' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
  function shpTrendHTML(s) {
    const q = s.q, i = q.dates.length - 1, j = Math.max(0, i - 4);
    const chips = SHP_KEYS.map(([k, l]) => {
      const now = q.rows[k][i], ago = q.rows[k][j]; if (!isNum(now) || (k === 'government' && now < 0.0005)) return '';
      const d = isNum(ago) && i >= 4 ? (now - ago) * 100 : null;
      return `<div class="shp-chip" style="--c:var(${SHP_COL[k]})"><i></i><span class="shp-cn">${l}</span><b>${fmtPct(now, 2)}</b>${d != null ? `<span class="shp-cd ${Math.abs(d) < 0.005 ? 'muted' : d > 0 ? 'good' : 'bad'}">${Math.abs(d) < 0.005 ? '• no change' : (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(2) + ' pp'}</span>` : ''}</div>`;
    }).join('');
    const hn = q.holders[i], ha = q.holders[j];
    const hch = isNum(hn) && isNum(ha) && ha > 0 && i >= 4 ? hn / ha - 1 : null;
    return `<div class="panel shp-trend">
        <div class="panel-title hold-top-head"><span>Shareholding over time</span>${s.y ? '<div class="toggle" id="shpToggle"><button data-p="q" class="on">QUARTERLY</button><button data-p="y">YEARLY</button></div>' : ''}</div>
        <div class="shp-chips">${chips}</div>
        <p class="hold-note shp-note">Latest holding and one-year change are shown above. The chart rebases every group to 0 at its first period, so small moves are easy to compare; hover or tap for the actual holding. pp = percentage points.</p>
        <div class="chart-box shp-box" id="box-chShp"><canvas id="chShp"></canvas></div>
      </div>
      <div class="panel shp-holders">
        <div class="shp-hn"><span class="panel-title">Number of shareholders</span><b>${isNum(hn) ? Math.round(hn).toLocaleString('en-IN') : '—'}</b>
          ${hch != null ? `<span class="${hch >= 0 ? 'good' : 'bad'}">${hch >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(hch), 1)} in a year</span>` : ''}<small>as of ${esc(q.dates[i])}</small></div>
        <div class="chart-box shp-hbox" id="box-chHolders"><canvas id="chHolders"></canvas></div>
      </div>`;
  }

  /* ====================== v15: BUSINESS MODEL (replaces Health Scan) ======================
     A balanced hub-and-spoke map keeps the company at the centre, with what it uses on the left, what it sells on the
     right, and who pays below. The revenue engine and reported money flow follow beneath the map. The structure comes
     from the Worker (POST /bizmodel, an AI summary of the company description and well-known public facts, cached 30
     days); without it the section still shows the description and the money flow. */
  // v14 uses a fresh cache key because the Worker now returns a balanced four-item map.
  const BIZ_KEY = 'plutus.biz.v2:';
  async function loadBizModel(m, my) {
    const sym = m.symbol;
    let biz = null;
    try { const x = JSON.parse(localStorage.getItem(BIZ_KEY + sym)); if (x && Date.now() - x.t < 7 * 864e5) biz = x.d; } catch (e) { /* ignore */ }
    if (!biz && workerBase()) {
      const pct = (v) => (isNum(v) ? fmtPct(v, 1) : 'n/a');
      const figures = { 'Revenue (latest year)': fmtMoney(m.revLast, m.finCurrency), 'Revenue growth': pct(m.revYoY), 'Operating margin (OPM)': pct(m.opm),
        'Net margin': pct(m.netMargin), 'Debt / equity': isNum(m.de) ? fmtX(m.de, 2) : 'n/a', Employees: isNum(m.employees) ? m.employees.toLocaleString('en-US') : 'n/a' };
      for (let i = 0; i < 2 && !biz; i++) {
        if (i) { await sleep(2500); if (my !== loadSeq) return; }
        try {
          const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
          const res = await fetch(workerBase() + '/bizmodel', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: sym, name: m.name, sector: m.sector, industry: m.industry, country: m.country, summary: String(m.summary || '').slice(0, 3000), figures }) }).finally(() => clearTimeout(t));
          if (res.status === 404 || res.status === 405) break;          // an older Worker without /bizmodel
          const j = await res.json().catch(() => null);
          if (res.ok && j && j.one_liner) { biz = j; try { localStorage.setItem(BIZ_KEY + sym, JSON.stringify({ t: Date.now(), d: j })); } catch (e) { /* quota */ } }
          else if (res.status === 503 || res.status === 400) break;
        } catch (e) { /* network / timeout: one more try */ }
      }
    }
    if (my !== loadSeq) return;
    renderBiz(m, biz);
  }
  const bizItems = (arr, cls) => (arr || []).map((x, i) => `<li class="bm-it ${cls || ''}" style="--d:${i}"><b>${esc(x.name)}</b>${x.note ? `<span>${esc(x.note)}</span>` : ''}</li>`).join('');
  const lane = (dir) => `<div class="bm-lane ${dir || ''}" aria-hidden="true"><span class="bm-track"></span>${'<i class="bm-dot"></i>'.repeat(4)}${'<i class="bm-coin"></i>'.repeat(3)}</div>`;
  // where each 100 of sales goes, from the latest annual figures
  function moneyFlowHTML(m) {
    const A0 = m.annual, i = A0.revenue.map((v, k) => (isNum(v) ? k : -1)).filter((k) => k >= 0).pop();
    if (i == null) return '';
    const rev = A0.revenue[i], ni = A0.netIncome[i], eb = isNum(A0.ebitda[i]) ? A0.ebitda[i] : A0.opIncome[i];
    if (!(rev > 0)) return '';
    const c = m.finCurrency, sym = A.curSym(c).trim() || c, pc = (v) => (v / rev) * 100;
    const rows = [{ k: 'Sales', v: rev, cls: 'rev', note: 'what customers paid' }];
    if (isNum(eb)) {
      rows.push({ k: 'Running costs', v: rev - eb, cls: 'cost', note: 'materials, staff, other expenses' });
      rows.push({ k: isNum(A0.ebitda[i]) ? 'Operating profit (EBITDA)' : 'Operating profit', v: eb, cls: 'mid', note: 'left from running the business' });
      if (isNum(ni)) rows.push({ k: 'Depreciation, interest & tax', v: eb - ni, cls: 'cost', note: 'wear of assets, lenders, government' });
    } else if (isNum(ni)) rows.push({ k: 'All costs & tax', v: rev - ni, cls: 'cost', note: '' });
    if (isNum(ni)) rows.push({ k: ni >= 0 ? 'Net profit' : 'Net loss', v: ni, cls: ni >= 0 ? 'prof' : 'loss', note: ni >= 0 ? 'kept for owners' : 'costs exceeded sales' });
    return `<div class="bm-flowmoney">
      <div class="panel-title">Where every ${sym}100 of sales goes · ${esc(A0.labels[i])}</div>
      <ul class="bm-wf">${rows.map((r, k) => `<li class="bm-wr ${r.cls}" style="--d:${k}"><span class="bm-wk">${esc(r.k)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
        <span class="bm-wb"><i style="--w:${Math.max(1.5, Math.min(100, Math.abs(pc(r.v)))).toFixed(1)}%"></i></span><b>${sym}${Math.abs(pc(r.v)).toFixed(pc(r.v) < 10 ? 1 : 0)}</b></li>`).join('')}</ul>
      <p class="hold-note">${fmtMoney(rev, c)} of sales in ${esc(A0.labels[i])}${isNum(ni) ? ` → ${fmtMoney(ni, c)} net ${ni >= 0 ? 'profit' : 'loss'}` : ''}. From the company’s reported figures.</p>
    </div>`;
  }
  function renderBiz(m, b) {
    const w = $('#bizWrap'); if (!w) return;
    const dom = domainOf(m.website) || domCache[m.symbol] || '';
    const sents = String(m.summary || '').split(/(?<=[.!?])\s+/).filter(Boolean);
    const lead = b ? b.one_liner : (sents[0] || `${m.name} — ${m.industry || m.sector || 'listed company'}.`);
    const how = b ? b.how : sents.slice(1, 3).join(' ');
    const core = `<div class="bm-core"><div class="bm-orb"><span class="bm-ring"></span><span class="bm-ring r2"></span>${logoHTML(dom, m.name, 'lg', m.symbol)}</div><b>${esc(shortName(m.name))}</b><span>${esc(m.industry || m.sector || '')}</span></div>`;
    const flow = b ? `<div class="bm-map bm-orbit-map">
        <div class="bm-col bm-stage bm-uses"><h4><span>1</span>What it uses</h4><ul>${bizItems(b.inputs)}</ul></div>
        ${lane('bm-lane-left')}
        <div class="bm-col bm-mid">${core}</div>
        ${lane('bm-lane-right')}
        <div class="bm-col bm-stage bm-offerings"><h4><span>2</span>What it sells</h4><ul>${bizItems(b.offerings, 'off')}</ul></div>
        ${lane('bm-lane-down')}
        <div class="bm-col bm-stage bm-customers"><h4><span>3</span>Who pays</h4><ul>${bizItems(b.customers, 'cus')}</ul>${b.channels && b.channels.length ? `<div class="bm-ch"><div class="bm-ch-head"><small>Reached through</small><span>How customers buy</span></div><ul class="bm-channel-list">${b.channels.map((x) => `<li><i aria-hidden="true"></i><span>${esc(x)}</span></li>`).join('')}</ul></div>` : ''}</div>
      </div>
      <div class="bm-legend" aria-hidden="true"><span><i class="bm-dot"></i>products &amp; services flow to customers</span><span><i class="bm-coin"></i>money flows back to the company</span></div>` : `<div class="bm-map bm-simple">${core}</div>`;
    const rev = b && b.revenue && b.revenue.length ? `<div class="panel bm-rev">
      <div class="bm-rev-head"><div><span class="bm-kicker">Revenue engine</span><div class="panel-title">How it makes money</div></div><p>Each stream shows what customers pay for.</p></div>
      <ol class="bm-streams">${b.revenue.map((r, i) => `<li style="--d:${i}"><span class="bm-stream-no">${String(i + 1).padStart(2, '0')}</span><div class="bm-stream-copy"><div class="bm-sr"><b>${esc(r.name)}</b></div>${r.note ? `<p>${esc(r.note)}</p>` : ''}</div></li>`).join('')}</ol>
      ${b.costs && b.costs.length ? `<div class="bm-costs"><div class="bm-cost-head"><div><small>Cost base</small><b>What revenue has to cover</b></div><span>Largest recurring cost buckets</span></div><ul>${b.costs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : '';
    const mf = moneyFlowHTML(m);
    const edge = b && (b.edge.length || b.watch.length) ? `<div class="bm-ew">
        ${b.edge.length ? `<div class="panel bm-edge"><div class="panel-title">${ico('shield')} Its edge</div><ul>${b.edge.map((x, i) => `<li style="--d:${i}">${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${b.watch.length ? `<div class="panel bm-watch"><div class="panel-title">${ico('pulse')} What could hurt it</div><ul>${b.watch.map((x, i) => `<li style="--d:${i}">${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>` : '';
    w.innerHTML = `<div class="bm">
        <p class="bm-lead">${esc(lead)}</p>${how ? `<p class="bm-how">${esc(how)}</p>` : ''}
        ${flow}
        <div class="bm-two">${rev}${mf ? `<div class="panel">${mf}</div>` : ''}</div>
        ${edge}
        <p class="hold-foot">${b ? 'Business map: an AI summary of the company’s own description and well-known public facts — check the annual report for detail (ask Plutus). Money flow: the company’s reported figures.' : workerBase() ? 'The detailed business map isn’t available right now (it needs the v14 Worker on Cloudflare). Money flow: the company’s reported figures.' : 'Money flow: the company’s reported figures.'}</p>
      </div>`;
    const sec = $('#sec-biz'); if (sec) sec.classList.add('bm-ready');
  }

  /* ====================== CORPORATE GOVERNANCE ======================
     Facts about who runs the company and how well ordinary shareholders are protected — not a rating of the shares.
       • At a glance: whether one person is both Chair and CEO, how much insiders / promoters own, whether insiders were
         net buyers or sellers in the last 6 months, (executive pay is not shown).
       • Key people (Yahoo's list of officers: title and age) and the latest insider trades (folded away until opened).
     v14 removes the third-party governance score and annual-report question shortcuts from this section. */
  const isCEO = (t) => /\b(ceo|chief executive officer|chief executive|managing director|md)\b(?!\s+(of|for)\b)/i.test(t) && !/\b(deputy|vice|joint|additional|division(al)?|regional)\s+(ceo|md|managing director|chief executive)/i.test(t);
  const isChair = (t) => /\bchair(man|woman|person)?\b/i.test(t) && !/\b(vice|deputy|co)[\s-]?chair/i.test(t) && !/emeritus/i.test(t);
  const isCFO = (t) => /\b(cfo|chief financial officer|finance director|group finance)\b/i.test(t);
  const cleanPerson = (n) => String(n || '').replace(/^\s*(mr|ms|mrs|miss|shri|smt)\.?\s+/i, '').replace(/\s+/g, ' ').trim();
  const tcase = (s) => { s = String(s || '').trim(); return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s; };
  // SEC filings list people as "FLOWERS DEREK A" → "Derek A. Flowers" (names with brackets or commas are left as they are)
  function personName(raw) {
    const s0 = String(raw || '').trim();
    if (!s0 || s0 !== s0.toUpperCase() || /[(),&]/.test(s0) || /\b(llc|lp|inc|ltd|trust|fund|capital|partners|holdings)\b/i.test(s0)) return tcase(s0);
    const w = tcase(s0).split(/\s+/);
    if (w.length < 2) return w.join(' ');
    let suf = /^(jr|sr|ii|iii|iv)$/i.test(w[w.length - 1]) ? w.pop() : '';
    if (suf) suf = /^(jr|sr)$/i.test(suf) ? suf + '.' : suf.toUpperCase();
    const last = w.shift();
    return [...w.map((x) => (x.length === 1 ? x + '.' : x)), last, suf].filter(Boolean).join(' ');
  }
  const fmtShares = (v) => (Math.abs(v) >= 1e7 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v).toLocaleString('en-US'));
  const dateTxt = (s) => new Date(s * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  function parseInsiders(res) {
    const r = res && res.quoteSummary && res.quoteSummary.result && res.quoteSummary.result[0];
    if (!r) return null;
    const num = (x) => { const v = rawv(x); return isNum(v) ? v : null; };
    const kindOf = (t) => (/\b(sale|sold|dispos)/i.test(t) ? 'sell' : /\b(purchase|buy|bought|acqui)/i.test(t) ? 'buy' : /gift/i.test(t) ? 'gift' : /option|exercis/i.test(t) ? 'option' : /award|grant/i.test(t) ? 'award' : 'other');
    const trades = (((r.insiderTransactions || {}).transactions) || []).map((t) => {
      const txt = String(t.transactionText || '').trim(), act = ((txt.match(/^(.*?)\s+at price\b/i) || [])[1] || txt).trim();
      return { name: personName(t.filerName), rel: /unreported/i.test(t.filerRelation || '') ? '' : tcase(t.filerRelation || ''), action: act || 'Other', kind: kindOf(act), shares: num(t.shares), date: num(t.startDate) };
    }).filter((t) => t.name && isNum(t.date)).sort((a, b) => b.date - a.date);
    return { trades };
  }
  async function loadInsiders(m, my) {
    let res = null;
    for (let i = 0; i < 2 && !res; i++) {   // v12: a second try after a pause
      if (i) { await sleep(3000); if (my !== loadSeq) return; }
      try { res = await Yahoo.insiders(m.symbol, { prio: PRIO.side, my }); } catch (e) { console.info('[PLUTUS insiders]', m.symbol, e.message); if (e.status === 404 || e.cancelled) break; }
    }
    if (my !== loadSeq) return;
    state.govx = parseInsiders(res);
    renderGov();
  }
  function renderGov() { const w = $('#govWrap'); if (w && state.model) w.innerHTML = govHTML(state.model); }

  function govHTML(m) {
    const g = m.gov || { officers: [] }, h = state.holders, x = state.govx, ind = isIndian(m.symbol);
    const officers = (g.officers || []).map((o) => ({ ...o, name: cleanPerson(o.name) }));
    const ceo = officers.find((o) => isCEO(o.title)), chair = officers.find((o) => isChair(o.title)), cfo = officers.find((o) => isCFO(o.title));
    const insLabel = ind ? 'Promoters & insiders' : 'Insiders';

    // ---- at a glance ----
    const checks = [];
    if (ceo && chair && ceo === chair) checks.push({ cls: 'warn', t: 'One person is both Chair and CEO', d: `${ceo.name} (“${ceo.title}”) leads the board and also runs the company. Many governance codes prefer two different people, so the board can oversee management independently; some companies balance this with a lead independent director.` });
    else if (ceo && chair) checks.push({ cls: 'good', t: 'Chair and CEO are different people', d: `${chair.name} chairs the board; ${ceo.name} runs the company. Splitting the roles helps the board oversee management independently.` });
    else if (ceo) checks.push({ cls: 'info', t: 'Chair not in the officer list', d: `Yahoo’s list names who runs the company (${ceo.name}, ${ceo.title}) but not the Chair. Often the Chair is a non-executive director, so isn’t listed as an officer.` });
    if (h === undefined) checks.push({ cls: 'wait', t: `${insLabel}’ stake`, d: '' });
    else if (h && isNum(h.ins)) {
      const p = h.ins;
      const why = p >= 0.5 ? 'A controlling stake: their wealth rises and falls with the company’s, and they can outvote other shareholders on most decisions.'
        : p >= 0.2 ? 'A large stake: their own money is tied to the company’s results.'
          : p >= 0.05 ? 'A meaningful stake in the company.'
            : p >= 0.01 ? 'A small stake — common for large companies, where most shares belong to funds and the public.'
              : 'Under 1% — common for very large, widely owned companies, where most shares belong to funds and the public.';
      checks.push({ cls: 'info', t: `${insLabel} own ${fmtPct(p, 1)} of the shares`, d: why });
    }
    if (h && h.act && isNum(h.act.net)) {
      const n = h.act.net, per = periodLbl(h.act.period).replace(/ mo$/, ' months');
      if (n >= 1) checks.push({ cls: 'good', t: 'Insiders were net buyers', d: `Over the last ${per}, insiders bought ${fmtShares(n)} more shares than they sold.` });
      else if (n <= -1) checks.push({ cls: 'warn', t: 'Insiders were net sellers', d: `Over the last ${per}, insiders sold ${fmtShares(-n)} more shares than they bought. Insiders sell for many reasons (taxes, diversifying, planned sales), so this is not a bad sign on its own.` });
      else checks.push({ cls: 'info', t: 'No net insider buying or selling', d: `Over the last ${per}, insiders’ purchases and sales roughly cancelled out.` });
    }
    // v13: executive pay is no longer shown (Key People has no salaries either)
    const checksHTML = checks.length ? `<ul class="gv-checks">${checks.map((c) => c.cls === 'wait'
      ? `<li class="gv-c wait"><span class="gv-dot"></span><div><b>${esc(c.t)}</b><span class="sk"></span></div></li>`
      : `<li class="gv-c ${c.cls}"><span class="gv-dot">${ico(c.cls === 'good' ? 'shield' : c.cls === 'warn' ? 'pulse' : 'avg')}</span><div><b>${esc(c.t)}</b>${c.d ? `<p>${esc(c.d)}</p>` : ''}</div></li>`).join('')}</ul>`
      : '<p class="gv-empty">Yahoo Finance publishes no officer or ownership details for this company.</p>';

    // ---- key people ----
    const roleTag = (o) => [o === ceo ? (ind && /\b(md|managing director)\b/i.test(o.title) && !/\bceo\b/i.test(o.title) ? 'MD' : 'CEO') : '', o === chair ? 'Chair' : '', o === cfo ? 'CFO' : ''].filter(Boolean).map((t) => `<span class="gv-tag">${t}</span>`).join('');
    const people = officers.slice(0, 8);
    const peopleHTML = people.length ? `<ul class="gv-people">${people.map((o) => `<li>
        <span class="gv-av" aria-hidden="true">${esc(initials(o.name))}</span>
        <div class="gv-pm"><div class="gv-pn"><b>${esc(o.name)}</b>${roleTag(o)}</div><span class="gv-pt">${esc(o.title || '—')}</span></div>
        <div class="gv-pf">${isNum(o.age) ? `<span>Age ${o.age}</span>` : ''}</div>
      </li>`).join('')}</ul>`
      : '<p class="gv-empty">Yahoo Finance has no list of officers for this company.</p>';

    // ---- insider trades ----
    let tradesHTML;
    if (x === undefined) tradesHTML = '<div class="peer-loading"><div class="orbit sm"><span></span></div><span>Loading insider trades…</span></div>';
    else if (!x || !x.trades.length) tradesHTML = '<p class="gv-empty">No insider trades are reported on Yahoo Finance for this company.</p>';
    else {
      const KIND = { buy: 'Bought', sell: 'Sold', gift: 'Gift', option: 'Option exercise', award: 'Award', other: 'Other filing' };
      // market purchases and sales say the most; show those when there are enough, otherwise every kind of filing
      const market = x.trades.filter((t) => t.kind === 'buy' || t.kind === 'sell');
      const list = market.length >= 3 ? market : x.trades;
      tradesHTML = `<ul class="gv-trades">${list.slice(0, 8).map((t) => `<li>
          <span class="gt-d">${dateTxt(t.date)}</span>
          <span class="gt-n"><b>${esc(t.name)}</b>${t.rel ? `<small>${esc(t.rel)}</small>` : ''}</span>
          <span class="gt-k k-${t.kind}" title="${esc(t.action)}">${KIND[t.kind]}</span>
          <span class="gt-s">${isNum(t.shares) ? fmtShares(t.shares) + ' shares' : '—'}</span>
        </li>`).join('')}</ul>
        <p class="gv-note">${list === market
          ? `Latest ${Math.min(8, market.length)} purchases and sales in the market, out of ${x.trades.length} insider filings (the rest are gifts, awards, option exercises and similar).`
          : `Latest ${Math.min(8, x.trades.length)} of ${x.trades.length} insider filings by directors, officers${ind ? ', promoters' : ''} and large holders. Gifts, awards and option exercises aren’t buying or selling in the market.`}</p>`;
    }

    return `<div class="gov">
        <div class="panel gv-glance gv-wide"><div class="panel-title">At a glance</div>${checksHTML}</div>
        <div class="panel gv-wide"><div class="panel-title">Key people</div>${peopleHTML}</div>
        <div class="panel gv-wide gv-tp${state.tradesOpen ? ' open' : ''}">
          <button type="button" class="gv-tog" aria-expanded="${state.tradesOpen ? 'true' : 'false'}" aria-controls="gvTrades">
            <span class="panel-title">Insider trades</span><span class="gv-tc">${x === undefined ? 'loading…' : !x || !x.trades.length ? 'none reported' : `${x.trades.length} filing${x.trades.length === 1 ? '' : 's'}${x.trades[0] ? ' · latest ' + dateTxt(x.trades[0].date) : ''}`}</span>
            <span class="gv-tl"><span class="gv-show">Show</span><span class="gv-hide">Hide</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span>
          </button>
          <div class="gv-tbody" id="gvTrades"${state.tradesOpen ? '' : ' hidden'}>${tradesHTML}</div>
        </div>
      </div>
      <p class="hold-foot">Source: Yahoo Finance (officers, ownership and insider trades). Facts only — not a rating of the shares.</p>`;
  }
  // Governance interactions are wired once on the dashboard root.
  function wireGov(root) {
    if (root.dataset.govWired) return;
    root.dataset.govWired = '1';
    root.addEventListener('click', (e) => {
      const tg = e.target.closest('.gv-tog');
      if (tg) {   // insider trades: folded away by default, opened / closed here
        state.tradesOpen = !state.tradesOpen;
        const p = tg.closest('.gv-tp'), body = p && p.querySelector('.gv-tbody');
        if (p) p.classList.toggle('open', state.tradesOpen);
        tg.setAttribute('aria-expanded', state.tradesOpen ? 'true' : 'false');
        if (body) body.hidden = !state.tradesOpen;
        return;
      }
    });
  }

  const fmtMetric = (mt, v, cur) => (!isNum(v) ? '—' : mt.fmt === 'pct' ? fmtPct(v, 1) : mt.fmt === 'x' ? fmtX(v, 1) : fmtMoney(v, cur));
  const shortSym = (s) => s.replace(/\.(NS|BO)$/, '');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function renderPeers(m, cmp, level) {
    const cur = m.currency, nPeers = cmp.rows.length - 1;
    const cols = A.PEER_METRICS.filter((mt) => !(m.isFinancial && mt.key === 'de'));
    const row = (r) => {
      const dom = domainOf(r.website);
      const cell = `<span class="pcell">${r.isMain ? '<span class="you">◉</span>' : ''}${logoHTML(dom, r.name, 'sm', r.symbol)}<span class="ptxt"><b>${esc(shortSym(r.symbol))}</b><span class="pname">${esc(r.name)}</span></span></span>`;
      return `<tr class="${r.isMain ? 'main' : ''}"><td>${r.isMain ? cell : `<a href="#/s/${encodeURIComponent(r.symbol)}">${cell}</a>`}</td>${cols.map((c) => `<td>${fmtMetric(c, r[c.key], cur)}</td>`).join('')}</tr>`;
    };
    const avgTr = `<tr class="avg"><td><span class="pcell"><span class="ptxt"><b>Industry average</b><span class="pname">${nPeers} industry peers</span></span></span></td>${cols.map((c) => `<td>${fmtMetric(c, cmp.avgRow[c.key], cur)}</td>`).join('')}</tr>`;
    const table = `<div class="peer-table-wrap"><table class="peer-table">
      <thead><tr><th>Company</th>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${cmp.rows.map(row).join('')}${avgTr}</tbody></table></div>
      <div class="scroll-hint">← Swipe the table to see all columns →</div>`;
    const btns = cols.filter((c) => c.key !== 'marketCap').map((c, i) => `<button data-k="${c.key}" class="${i === 0 ? 'on' : ''}">${c.name.toUpperCase()}</button>`).join('');
    const cn = countryName(marketOf(m.symbol)), loc = cn ? `, ${esc(cn)}` : '';
    const rule = '<b>#1</b> = best (lowest wins for Debt &amp; P/E).';
    const intro = level === 'industry'
      ? `Vs <b>${nPeers}</b> closest-size peers in <b>${esc(m.industry)}</b>${loc}. ${rule}`
      : level === 'sector'
        ? `Vs <b>${nPeers}</b> peers from the wider <b>${esc(m.sector)}</b> sector${loc}. ${rule}`
        : `Vs <b>${nPeers}</b> similar companies suggested by Yahoo. ${rule}`;
    $('#peerWrap').innerHTML = `
      <p class="peer-intro">${intro}</p>
      <div class="chart-card wide peer-chart">
        <h3>Head to Head<div class="toggle" id="peerToggle">${btns}</div></h3>
        <div class="chart-box" id="box-chPeer"><canvas id="chPeer"></canvas></div>
      </div>
      ${table}
      <div class="peer-cmp"><a class="cmp-go" href="#/compare/${[m.symbol].concat(cmp.rows.filter((r) => !r.isMain).slice(0, 3).map((r) => r.symbol)).map(encodeURIComponent).join(',')}">${ico('scale')}<span>Compare these side by side</span></a></div>`;
    const draw = (key) => {
      resetBox('chPeer');
      const mt = A.PEER_METRICS.find((x) => x.key === key);
      const rows = [...cmp.rows, ...(isNum(cmp.avgRow[key]) ? [cmp.avgRow] : [])].filter((r) => isNum(r[key]))
        .sort((a, b) => (mt.better === 'high' ? b[key] - a[key] : a[key] - b[key]));
      if (!rows.length) return noData('chPeer');
      const val = (v) => (mt.fmt === 'pct' ? +(v * 100).toFixed(2) : +v.toFixed(2));
      const unit = mt.fmt === 'pct' ? '%' : '×';
      const C = tc(), bg = (r) => (r.isMain ? C.accent : r.isAvg ? C.accent2 : C.line2);
      mk('chPeer', { type: 'bar',
        data: { labels: rows.map((r) => (r.isAvg ? 'Industry average' : clip(r.name, isMobile() ? 16 : 28))), datasets: [{ label: mt.label, data: rows.map((r) => val(r[key])),
          backgroundColor: rows.map(bg), borderColor: rows.map((r) => (r.isMain ? C.accent : r.isAvg ? C.accent2 : C.dim)), borderWidth: 1, borderRadius: 2, maxBarThickness: 26 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${mt.label}: ${x.parsed.x}${unit}` } } },
          scales: { x: { ticks: { maxTicksLimit: isMobile() ? 4 : 8, callback: (v) => v + unit } }, y: { grid: { display: false }, ticks: { color: C.text, autoSkip: false } } } } });
    };
    draw(cols.find((c) => c.key !== 'marketCap').key);
    window.__plutusPeerRedraw = () => { const on = $('#peerToggle button.on'); if (on && $('#box-chPeer')) draw(on.dataset.k); };
    $('#peerToggle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('#peerToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.k); });
  }

  /* ---------- charts ---------- */
  // Chart colours come from the same CSS tokens as the page (css/style.css), so they follow the light / dark theme
  let tcCache = null;
  function tc() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    if (tcCache && tcCache.theme === theme) return tcCache;
    const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    return (tcCache = { theme, accent: v('--accent'), accent2: v('--accent-2'), good: v('--good'), warn: v('--warn'), bad: v('--bad'),
      text: v('--text'), hi: v('--hi'), muted: v('--muted'), dim: v('--dim'), line2: v('--line-2'), grid: v('--grid'), tipBg: v('--tip-bg'), pub: v('--pub') });
  }
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
  // Rebuild every chart for the current theme / screen size, keeping the toggles the visitor picked
  function redrawCharts() {
    if (!state.model || $('#dashContent').classList.contains('hidden')) return;
    const on = (id, k) => { const b = $(`#${id} button.on`); return b ? b.dataset[k] : undefined; };
    const vs = valSel();
    const sel = { price: on('priceToggle', 'r'), period: on('periodToggle', 'p'), val: vs.metric, vr: vs.range };
    destroyCharts(); drawCharts(state.model, sel);
    if (state.shp) drawShpCharts();
    if (window.__plutusPeerRedraw) window.__plutusPeerRedraw();
  }
  function setupChartDefaults() {
    if (!window.Chart) return;
    const mob = isMobile(), C = tc();
    Chart.defaults.color = C.muted;
    Chart.defaults.font.family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    Chart.defaults.font.size = mob ? 10 : 11;
    Chart.defaults.borderColor = C.grid;
    Chart.defaults.plugins.legend.position = 'top';
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.padding = mob ? 8 : 12;
    Chart.defaults.plugins.tooltip.backgroundColor = C.tipBg;
    Chart.defaults.plugins.tooltip.titleColor = C.text;
    Chart.defaults.plugins.tooltip.bodyColor = C.text;
    Chart.defaults.plugins.tooltip.borderColor = C.accent;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.responsive = true;
  }
  const grad = (hex, a1 = 0.35) => (ctx) => {
    const { chart } = ctx; const { ctx: g, chartArea } = chart;
    if (!chartArea) return 'transparent';
    const gr = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gr.addColorStop(0, hex + Math.round(a1 * 255).toString(16).padStart(2, '0')); gr.addColorStop(1, hex + '00');
    return gr;
  };
  const dLabel = (t, withDay) => new Date(t).toLocaleDateString('en-GB', withDay ? { day: '2-digit', month: 'short', year: '2-digit' } : { month: 'short', year: '2-digit' });
  function resetBox(id) {
    const old = state.charts.find((x) => x.canvas && x.canvas.id === id);
    if (old) { old.destroy(); state.charts = state.charts.filter((x) => x !== old); }
    const box = document.getElementById('box-' + id); if (box) box.innerHTML = `<canvas id="${id}"></canvas>`;
  }
  function setTake(id, text) { const el = document.getElementById('tk-' + id); if (!el) return; el.textContent = text || ''; el.classList.toggle('hidden', !text); }
  function noData(id, msg) {
    const cv = document.getElementById(id); if (!cv) return;
    cv.parentElement.innerHTML = `<div class="nodata">${esc(msg || 'No data available')}</div>`;
  }
  function mk(id, cfg) {
    const cv = document.getElementById(id); if (!cv || !window.Chart) return null;
    const ch = new Chart(cv, cfg); state.charts.push(ch); return ch;
  }
  const anyNum = (arr) => (arr || []).some(isNum);
  const findChart = (id) => state.charts.find((c) => c.canvas && c.canvas.id === id);

  // Industry-average overlay on the P/E chart (added once the peers have loaded)
  const peIndDataset = (len, v) => ({ label: 'Industry avg P/E', data: Array.from({ length: len }, () => +v.toFixed(2)), borderColor: tc().good, borderDash: [2, 4], borderWidth: 1.3, pointRadius: 0, isInd: true });
  const marginIndDataset = (labels, v) => ({ label: 'Industry net margin', data: labels.map(() => +(v * 100).toFixed(2)), borderColor: tc().hi, borderDash: [5, 5], borderWidth: 1, pointRadius: 0, isInd: true });
  function refreshIndustryCharts() { syncCompareCharts(); }

  /* ====================== v15: VALUATION HISTORY ======================
     One card, a drop-down for what to show and a time range:
       P/E · Sales & Margin · EV / EBITDA · Price to Book · Market Cap / Sales      ×      1M · 6M · 1Y · 3Y
     Ratios are worked out for every price point: the share price on that day ÷ the latest ANNUAL figure the company had
     published by then (EPS, book value, EBITDA, sales), so the line moves with the price and steps when a new year's
     accounts arrive. The supported history is deliberately capped at three years. */
  const VAL_METRICS = [['pe', 'P/E'], ['sales', 'Sales & Margin'], ['evebitda', 'EV / EBITDA'], ['pb', 'Price to Book'], ['mcs', 'Market Cap / Sales']];
  const VAL_RANGES = [['1m', '1M', 30], ['6m', '6M', 182], ['1y', '1Y', 365], ['3y', '3Y', 1096]];
  const VAL_WHAT = {
    pe: 'How many years of profit investors pay for in the share price (price ÷ latest annual earnings per share). Dashed line = median over the period shown.',
    sales: 'Yearly or quarterly sales (bars) and the operating profit margin, OPM % (line): out of every 100 of sales, how much is left as operating profit (EBITDA).',
    evebitda: 'Enterprise value (market cap + debt − cash) ÷ yearly operating profit (EBITDA). Compares companies fairly whatever their debt. Dashed line = median over the period.',
    pb: 'Share price ÷ book value (net worth) per share: how much investors pay for each 1 of the company’s net assets. Dashed line = median over the period.',
    mcs: 'Market value of all shares ÷ yearly sales: what investors pay for each 1 of revenue. Useful when profits are small or negative. Dashed line = median over the period.'
  };
  function valCardHTML(m) {
    const sel = `<label class="val-sel"><span class="vh">Show</span><select id="valMetric" aria-label="Which history to show">${VAL_METRICS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>`;
    const rng = `<div class="toggle" id="valRange" role="group" aria-label="Time range">${VAL_RANGES.map(([k, l]) => `<button type="button" data-r="${k}"${k === '3y' ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`;
    return `<div class="chart-card wide val-card">
      <h3><span>Valuation History</span>${sel}${rng}</h3>
      <p class="what" id="valWhat">${VAL_WHAT.pe}</p>
      <div class="chart-box" id="box-chPE"><canvas id="chPE"></canvas></div>
      <div class="takeaway ${m.takeaways.pe ? '' : 'hidden'}" id="tk-chPE">${esc(m.takeaways.pe || '')}</div>
    </div>`;
  }
  const valSel = () => ({ metric: ($('#valMetric') || {}).value || 'pe', range: (($('#valRange button.on') || {}).dataset || {}).r || '3y' });
  // price points for a supported range
  function valPrice(m, r) {
    const days = (VAL_RANGES.find((x) => x[0] === r) || [])[2];
    let src = r === '1m' || r === '6m' || r === '1y' ? m.priceDaily : m.priceWeekly;
    if (!src) return null;
    if (days) { const t0 = Date.now() - days * 864e5; src = src.filter((p) => p.t >= t0); }
    return src;
  }
  // the company's annual figures as a step series: the latest year published on or before t
  function annualRows(m) {
    const A0 = m.annual, sharesNow = isNum(m.marketCap) && isNum(m.price) && m.price > 0 ? m.marketCap / m.price : null;
    return A0.dates.map((d, i) => ({ t: Date.parse(d), eps: A0.eps[i], rev: A0.revenue[i], ebitda: isNum(A0.ebitda[i]) ? A0.ebitda[i] : null, eq: A0.equity[i],
      debt: A0.debt[i], cash: A0.cash[i], sh: isNum(A0.sharesOut[i]) && A0.sharesOut[i] > 0 ? A0.sharesOut[i] : sharesNow })).filter((r) => isNum(r.t));
  }
  function ratioAt(metric, price, r) {
    if (!r || !isNum(price)) return null;
    const mc = isNum(r.sh) ? price * r.sh : null;
    switch (metric) {
      case 'pe': return isNum(r.eps) && r.eps > 0 ? price / r.eps : null;
      case 'pb': return isNum(mc) && isNum(r.eq) && r.eq > 0 ? mc / r.eq : null;
      case 'mcs': return isNum(mc) && isNum(r.rev) && r.rev > 0 ? mc / r.rev : null;
      case 'evebitda': { if (!isNum(mc) || !isNum(r.ebitda) || r.ebitda <= 0) return null; const ev = mc + (isNum(r.debt) ? r.debt : 0) - (isNum(r.cash) ? r.cash : 0); return ev > 0 ? ev / r.ebitda : null; }
      default: return null;
    }
  }
  function ratioSeries(m, metric, pts) {
    const rows = annualRows(m), cap = metric === 'pe' ? 400 : metric === 'evebitda' ? 300 : 200;
    let j = -1;
    return pts.map((p) => {
      while (j + 1 < rows.length && rows[j + 1].t <= p.t) j++;
      const v = j >= 0 ? ratioAt(metric, p.v, rows[j]) : null;
      return { t: p.t, v: isNum(v) && v > 0 && v < cap ? v : null };
    });
  }
  const fmtValTick = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}×`;
  };
  function drawValuation(m, metric, range) {
    resetBox('chPE');
    const what = $('#valWhat'); if (what) what.textContent = VAL_WHAT[metric] || '';
    const C = tc(), mob = isMobile();
    if (metric === 'sales') return drawSalesMargin(m, range);
    if (!m.sameCur) { setTake('chPE', ''); return noData('chPE', 'Hidden — the statements are in a different currency from the share price'); }
    if (metric === 'pe' && m.negEarnings && !m.annual.eps.some((v) => isNum(v) && v > 0)) { setTake('chPE', 'Earnings are negative, so P/E is not meaningful right now.'); return noData('chPE', 'Not meaningful — company has losses'); }
    const pts = valPrice(m, range);
    if (!pts) {
      setTake('chPE', '');
      return noData('chPE', 'Price history isn’t available for this period');
    }
    const ser = ratioSeries(m, metric, pts).filter((p, i, a) => isNum(p.v) || (i > 0 && isNum(a[i - 1].v)));
    const vals = ser.map((p) => p.v).filter(isNum);
    if (vals.length < 2) { setTake('chPE', ''); return noData('chPE', metric === 'evebitda' ? 'EBITDA isn’t published for this company' : 'Not enough company figures for this period'); }
    const first = ser.findIndex((p) => isNum(p.v)), shown = ser.slice(first);
    const med = (() => { const v = vals.slice().sort((a, b) => a - b), k = Math.floor(v.length / 2); return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2; })();
    const label = (VAL_METRICS.find((x) => x[0] === metric) || [])[1];
    const daily = range === '1m' || range === '6m' || range === '1y';
    const col = { pe: C.accent2, evebitda: C.accent, pb: C.good, mcs: C.warn }[metric] || C.accent2;
    const sets = [
      { label, data: shown.map((p) => (isNum(p.v) ? +p.v.toFixed(2) : null)), borderColor: col, backgroundColor: grad(col, 0.22), fill: true, borderWidth: 1.6, pointRadius: 0, tension: 0.15, spanGaps: true },
      { label: 'Median', data: shown.map(() => +med.toFixed(2)), borderColor: C.muted, borderDash: [6, 6], borderWidth: 1, pointRadius: 0 }
    ];
    if (metric === 'pe' && cmpActive() && state.ind && isNum(state.ind.avg.pe)) sets.push(peIndDataset(shown.length, state.ind.avg.pe));
    mk('chPE', { type: 'line', data: { labels: shown.map((p) => dLabel(p.t, daily)), datasets: sets },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}×` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: mob ? 4 : 8, maxRotation: 0 } }, y: { position: 'right', ticks: { maxTicksLimit: mob ? 5 : 8, precision: 2, callback: fmtValTick } } } } });
    const now = vals[vals.length - 1];
    let t = `Now ${fmtX(now, 1)} vs a median of ${fmtX(med, 1)} over this period — ${Math.abs(now / med - 1) < 0.05 ? 'close to' : now > med ? 'above' : 'below'} its usual level.`;
    if (first > 0 && pts.length && shown.length) t += ` Company figures on Yahoo Finance start in ${dLabel(shown[0].t)}, so the line begins there.`;
    setTake('chPE', t);
  }
  function drawSalesMargin(m, range) {
    const C = tc(), mob = isMobile(), c = m.finCurrency;
    const quarterly = ['1m', '6m', '1y', '3y'].includes(range) && m.quarterly.revenue.some(isNum);
    const D = quarterly ? m.quarterly : m.annual;
    const n = quarterly ? (range === '3y' ? 12 : 4) : 3;
    const idx = D.labels.map((_, i) => i).filter((i) => isNum(D.revenue[i])).slice(-n);
    if (idx.length < 1) { setTake('chPE', ''); return noData('chPE', 'No sales figures published'); }
    const opmS = quarterly ? D.revenue.map((r, i) => { const e = isNum(D.ebitda && D.ebitda[i]) ? D.ebitda[i] : D.opIncome[i]; return isNum(e) && isNum(r) && r > 0 ? e / r : null; }) : D.opmS;
    const L = idx.map((i) => D.labels[i]), rev = idx.map((i) => D.revenue[i]), opm = idx.map((i) => (isNum(opmS[i]) ? +(opmS[i] * 100).toFixed(2) : null));
    mk('chPE', { type: 'bar', data: { labels: L, datasets: [
      { type: 'bar', label: 'Sales', data: rev, backgroundColor: C.accent, borderRadius: 2, maxBarThickness: mob ? 22 : 40, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'OPM %', data: opm, borderColor: C.accent2, backgroundColor: C.accent2, borderWidth: 2, pointRadius: mob ? 2 : 3, tension: 0.25, spanGaps: true, yAxisID: 'y1', order: 1 }] },
      options: { interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (x) => (x.dataset.yAxisID === 'y1' ? `OPM: ${x.parsed.y.toFixed(1)}%` : `Sales: ${fmtMoney(x.parsed.y, c)}`) } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }, y: { position: 'left', ticks: { maxTicksLimit: 6, callback: (v) => fmtMoney(v, c) } },
          y1: { position: 'right', grid: { display: false }, ticks: { maxTicksLimit: 6, callback: (v) => v + '%' } } } } });
    const r0 = rev[0], r1 = rev[rev.length - 1], o = opm.filter(isNum);
    let t = `${quarterly ? 'Last ' + L.length + ' quarters' : L.length + ' financial years'}: sales ${isNum(r0) && r0 > 0 && L.length > 1 ? `${r1 >= r0 ? 'up' : 'down'} ${fmtPct(Math.abs(r1 / r0 - 1), 0)} (${L[0]} → ${L[L.length - 1]})` : fmtMoney(r1, c)}`;
    if (o.length) t += `, operating margin ${o.length > 1 ? `${o[0].toFixed(1)}% → ${o[o.length - 1].toFixed(1)}%` : o[0].toFixed(1) + '%'}`;
    if (['1m', '6m'].includes(range)) t += ' (sales are reported quarterly, so short ranges show the last 4 quarters)';
    setTake('chPE', t + '.');
  }
  function wireValuation(m) {
    const sel = $('#valMetric'), rg = $('#valRange');
    if (sel) sel.onchange = () => { const s = valSel(); drawValuation(m, s.metric, s.range); };
    if (rg) rg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; rg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); const s = valSel(); drawValuation(m, s.metric, s.range); };
  }

  /* ---------- share-price ranges ---------- */
  const PRICE_RANGES = [
    ['ytd', 'YTD', 'Year to date: since the last close of last year'],
    ['1y', '1Y', 'Last 12 months, daily'],
    ['5y', '5Y', 'Last 5 years, weekly'],
    ['max', 'MAX', 'All the price history available']
  ];
  function pricePoints(m, range) {
    if (range === '1y') return m.priceDaily;
    if (range === '5y') return m.priceWeekly;
    if (range === 'max') return state.priceMax[m.symbol] || null;
    // YTD: this year's daily closes, starting from the last close of last year (the usual base for a YTD figure)
    const d = m.priceDaily, y0 = new Date(new Date().getFullYear(), 0, 1).getTime();
    const i = d.findIndex((p) => p.t >= y0);
    return i < 0 ? [] : d.slice(Math.max(0, i - 1));
  }
  // range=max: Yahoo picks the step itself (monthly, or quarterly for very long histories)
  const maxInflight = {};
  function loadMaxPrice(m) {
    const k = m.symbol;
    if (state.priceMax[k]) return Promise.resolve(state.priceMax[k]);
    if (!maxInflight[k]) {
      maxInflight[k] = Yahoo.chart(k, 'max', '1mo', { prio: PRIO.main }).then((r) => {
        const c = A.parseChart(r);
        let pts = c ? c.pts : [];
        // a young listing: the 1-year daily or 5-year weekly series already covers its whole history, in more detail
        const first = pts.length ? pts[0].t : Infinity, covers = (s) => s.length > 1 && s[0].t <= first + 45 * 864e5;
        if (covers(m.priceDaily)) pts = m.priceDaily; else if (covers(m.priceWeekly)) pts = m.priceWeekly;
        if (pts.length < 2) throw new Error('no history');
        state.priceMax[k] = pts;
        return pts;
      }).finally(() => { delete maxInflight[k]; });
    }
    return maxInflight[k];
  }
  function applyMaxStats(m, pts) {
    if (!pts || pts.length < 2) return;
    const vs = pts.map((p) => p.v).filter(isNum);
    m.allTimeHigh = Math.max(...vs, isNum(m.high52) ? m.high52 : -Infinity); m.allTimeLow = Math.min(...vs, isNum(m.low52) ? m.low52 : Infinity);
    const end = pts[pts.length - 1], t0 = end.t - 10 * 365.25 * 864e5;
    if (pts[0].t <= t0 + 45 * 864e5) { let s0 = pts[0]; for (const p of pts) { if (p.t <= t0) s0 = p; else break; } if (s0.v > 0) m.priceCAGR10 = Math.pow(end.v / s0.v, 1 / 10) - 1; }
    if (loadExtra().some((k) => k === 'hlall' || k === 'prc10')) renderKpiWrap();
  }
  const monYear = (t) => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  function priceTakeaway(pts, range, logY) {
    const a = pts[0], b = pts[pts.length - 1];
    if (!(a.v > 0) || !isNum(b.v)) return '';
    const ch = b.v / a.v - 1, pct = fmtPct(Math.abs(ch), Math.abs(ch) < 0.1 ? 1 : 0);
    const when = { ytd: 'so far this year', '1y': 'over the last 12 months', '5y': 'over the last 5 years', max: `since ${monYear(a.t)} (the earliest price Yahoo Finance has)` }[range] || '';
    let t = `Share price is ${ch >= 0 ? 'up' : 'down'} ${pct} ${when}.`;
    const yrs = (b.t - a.t) / (365.25 * 864e5);
    if ((range === 'max' || range === '5y') && yrs >= 3) t += ` That’s about ${fmtPct(Math.pow(b.v / a.v, 1 / yrs) - 1, 1, true)} a year on average (dividends not included).`;
    if (logY) t += ' The scale is logarithmic: the same % move looks the same size in any decade, so the early years stay visible.';
    return t;
  }

  // sel: which toggles are selected ({ price: 'ytd'|'1y'|'5y'|'max', period: 'annual'|'quarterly' }) — kept when charts are redrawn
  function drawCharts(m, sel) {
    sel = sel || {};
    setupChartDefaults();
    const pc = m.currency, mob = isMobile(), C = tc();
    const hasInd = !!state.ind;
    // Price: YTD · 1Y (daily) · 5Y (weekly) · MAX (all history, fetched the first time it's picked)
    const drawPrice = (range) => {
      resetBox('chPrice');
      if (range === 'max' && !state.priceMax[m.symbol]) {
        const box = document.getElementById('box-chPrice');
        if (box) box.innerHTML = '<div class="chart-wait"><div class="orbit sm"><span></span></div><span>Loading the full price history…</span></div>';
        setTake('chPrice', '');
        loadMaxPrice(m).then(() => { if (state.model === m && priceSel() === 'max') drawPrice('max'); },
          () => { if (state.model === m && priceSel() === 'max') { noData('chPrice', 'The full price history couldn’t be loaded right now — try again in a moment'); } });
        return;
      }
      const pts = pricePoints(m, range);
      if (!pts || pts.length < 2) { setTake('chPrice', ''); return noData('chPrice', range === 'ytd' ? 'Not enough trading days this year yet' : 'No data available'); }
      const up = pts[pts.length - 1].v >= pts[0].v, col = up ? C.good : C.bad;
      const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
      const logY = range === 'max' && lo > 0 && hi / lo > 25;  // decades of growth: a log scale keeps the early years visible
      const daily = range === '1y' || range === 'ytd';
      mk('chPrice', {
        type: 'line',
        data: { labels: pts.map((p) => dLabel(p.t, daily)), datasets: [{ label: 'Price', data: pts.map((p) => p.v), borderColor: col, backgroundColor: grad(col, 0.28), fill: true, borderWidth: 1.6, pointRadius: 0, tension: 0.15 }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => fmtPrice(x.parsed.y, pc) } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: mob ? 4 : 8, maxRotation: 0 } },
            y: { type: logY ? 'logarithmic' : 'linear', position: 'right', ticks: { maxTicksLimit: mob ? 5 : 8, callback: (v) => fmtPrice(v, pc).replace(/\.00$/, '') } } } }
      });
      setTake('chPrice', priceTakeaway(pts, range, logY));
    };
    const priceSel = () => { const b = $('#priceToggle button.on'); return b ? b.dataset.r : '5y'; };
    drawPrice(sel.price || '5y');
    const tg = $('#priceToggle');
    // onclick (not addEventListener): a redraw (theme switch, breakpoint change) replaces the handler instead of stacking another
    if (tg) tg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); drawPrice(b.dataset.r); };
    // Valuation history (P/E · Sales & Margin · EV/EBITDA · P/B · Market cap / Sales) over 1M … 3Y
    const vm = $('#valMetric'); if (vm && sel.val) vm.value = sel.val;
    if (sel.vr) { const rg = $('#valRange'); if (rg) rg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.r === sel.vr)); }
    const vs = valSel(); drawValuation(m, vs.metric, vs.range); wireValuation(m);

    drawBusiness(m, sel.period || 'annual');
    const pt = $('#periodToggle');
    if (pt) pt.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pt.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      drawBusiness(m, b.dataset.p);
    };
  }

  function quarterTakeaways(m) {
    const q = m.quarterly, t = {}, c = m.finCurrency, n = q.revenue.length;
    const yoy = (arr) => (n >= 5 && isNum(arr[n - 1]) && isNum(arr[n - 5]) && arr[n - 5] > 0 ? arr[n - 1] / arr[n - 5] - 1 : null);
    if (n) {
      const rg = yoy(q.revenue), ng = yoy(q.netIncome);
      t.revenue = `Latest quarter (${q.labels[n - 1]}): revenue ${fmtMoney(q.revenue[n - 1], c)}, net profit ${fmtMoney(q.netIncome[n - 1], c)}` +
        (isNum(rg) ? ` · revenue ${fmtPct(rg, 1, true)} vs same quarter last year` : '') + (isNum(ng) ? `, profit ${fmtPct(ng, 1, true)}` : '') + '.';
      if (isNum(q.netMarginS[n - 1])) t.margins = `Net margin in the latest quarter: ${fmtPct(q.netMarginS[n - 1])}${n >= 5 && isNum(q.netMarginS[n - 5]) ? ` (same quarter last year ${fmtPct(q.netMarginS[n - 5])})` : ''}.`;
      if (isNum(q.eps[n - 1])) t.eps = `Latest quarterly EPS: ${q.eps[n - 1].toFixed(2)} ${c}${n >= 5 && isNum(q.eps[n - 5]) ? ` vs ${q.eps[n - 5].toFixed(2)} a year earlier` : ''}.`;
    }
    t.cash = anyNum(q.ocf) ? '' : 'Many companies (including most Indian listings) publish cash flow only half-yearly or yearly — switch to Yearly.';
    t.debt = anyNum(q.debt) ? '' : 'Quarterly balance-sheet data isn’t published for this company — switch to Yearly.';
    return t;
  }

  function drawBusiness(m, period) {
    const c = m.finCurrency, mob = isMobile(), C = tc();
    const D = period === 'quarterly' ? m.quarterly : m.annual, L = D.labels;
    const moneyTick = { maxTicksLimit: mob ? 5 : 7, callback: (v) => fmtMoney(v, c) };
    const moneyTip = { callbacks: { label: (x) => `${x.dataset.label}: ${fmtMoney(x.parsed.y, c)}` } };
    const xs = { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } };
    const bar = mob ? 18 : 34;
    ['chRev', 'chMargin', 'chEPS', 'chCash', 'chDebt'].forEach(resetBox);
    const note = $('#periodNote');
    if (note) note.textContent = period === 'quarterly' ? `Quarterly · last ${L.length} reported quarters` : `Yearly · last ${L.length} financial years`;
    const T = period === 'quarterly' ? quarterTakeaways(m) : m.takeaways;
    setTake('chRev', T.revenue); setTake('chMargin', T.margins); setTake('chEPS', T.eps); setTake('chCash', T.cash); setTake('chDebt', T.debt);
    const nd = period === 'quarterly' ? 'No quarterly data published' : 'No data available';
    const negCol = (arr, pos) => arr.map((v) => (isNum(v) && v < 0 ? C.bad : pos));

    if (anyNum(D.revenue) || anyNum(D.netIncome)) mk('chRev', { type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Revenue', data: D.revenue, backgroundColor: C.accent, borderRadius: 2, maxBarThickness: bar },
        { label: 'Net Profit', data: D.netIncome, backgroundColor: negCol(D.netIncome, C.good), borderRadius: 2, maxBarThickness: bar }] },
      options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    else noData('chRev', nd);

    const pctData = (arr) => arr.map((v) => (isNum(v) ? +(v * 100).toFixed(2) : null));
    const mSets = [['Gross', D.grossMarginS, C.accent2], ['Operating', D.opMarginS, C.accent], ['Net', D.netMarginS, C.good]]
      .filter(([, a]) => anyNum(a)).map(([l, a, col]) => ({ label: l, data: pctData(a), borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: mob ? 2 : 3, tension: 0.25, spanGaps: true }));
    if (cmpActive() && state.ind && period === 'annual' && isNum(state.ind.avg.nm) && mSets.length) {
      mSets.push(marginIndDataset(L, state.ind.avg.nm));
    }
    if (mSets.length) mk('chMargin', { type: 'line', data: { labels: L, datasets: mSets },
      options: { plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}%` } } }, scales: { x: xs, y: { ticks: { maxTicksLimit: 6, callback: (v) => v + '%' } } } } });
    else noData('chMargin', nd);

    if (anyNum(D.eps)) mk('chEPS', { type: 'bar',
      data: { labels: L, datasets: [{ label: 'EPS (' + c + ')', data: D.eps, backgroundColor: negCol(D.eps, C.accent2), borderRadius: 2, maxBarThickness: mob ? 24 : 40 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: xs, y: { ticks: { maxTicksLimit: 6 } } } } });
    else noData('chEPS', nd);

    if (anyNum(D.ocf) || anyNum(D.fcf)) mk('chCash', { type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Operating Cash Flow', data: D.ocf, backgroundColor: C.accent, borderRadius: 2, maxBarThickness: bar },
        { label: 'Free Cash Flow', data: D.fcf, backgroundColor: negCol(D.fcf, C.good), borderRadius: 2, maxBarThickness: bar }] },
      options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    else noData('chCash', nd);

    // Debt vs Equity: this card is full-width, so with a fixed max bar width Chart.js would centre each bar in a much
    // wider slot and leave a big gap between the pair. Sizing the group to the bar width keeps the two bars side by
    // side, exactly like Revenue vs Net Profit.
    if (anyNum(D.debt) || anyNum(D.equity)) {
      const boxW = (document.getElementById('box-chDebt') || {}).clientWidth || 600;
      const slot = Math.max(40, (boxW - 70) / Math.max(1, L.length));
      const barPct = 0.9;
      const catPct = Math.min(0.8, Math.max(0.2, (2 * bar) / (barPct * slot)));
      mk('chDebt', { type: 'bar',
        data: { labels: L, datasets: [
          { label: 'Total Debt', data: D.debt, backgroundColor: C.bad, borderRadius: 2, maxBarThickness: bar, barPercentage: barPct, categoryPercentage: catPct },
          { label: 'Shareholders’ Equity', data: D.equity, backgroundColor: C.good, borderRadius: 2, maxBarThickness: bar, barPercentage: barPct, categoryPercentage: catPct }] },
        options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    } else noData('chDebt', nd);
  }

  // Redraw charts when crossing the mobile/desktop breakpoint (rotation, window resize)
  let lastMob = null, rT = null;
  window.addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      const mob = isMobile();
      if (lastMob !== null && mob !== lastMob) redrawCharts();
      lastMob = mob;
    }, 200);
  });

  /* ====================== THEME (light / dark) ======================
     Light is the default. index.html sets data-theme on <html> before the page is drawn (from the saved choice);
     this switch flips it, remembers it, and redraws the charts in the new colours. */
  const THEME_KEY = 'plutus.theme.v1';
  const THEME_BAR = { light: '#f6f3ec', dark: '#000000' }; // browser / phone status-bar colour
  function setTheme(t, save) {
    const root = document.documentElement;
    root.classList.add('theme-switching'); // no colour transitions mid-switch
    root.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', THEME_BAR[t]);
    const b = $('#themeBtn');
    if (b) { const next = t === 'dark' ? 'light' : 'dark'; b.setAttribute('aria-label', `Switch to ${next} mode`); b.dataset.tip = next === 'dark' ? 'Dark mode' : 'Light mode'; }
    if (save) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode: just not remembered */ } }
    redrawCharts();
    try { window.dispatchEvent(new CustomEvent('plutus:theme', { detail: t })); } catch (e) { /* very old browser */ }
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }
  function initThemeSwitch() {
    const b = $('#themeBtn'); if (!b) return;
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
    b.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true));
  }

  /* ====================== INIT ====================== */
  function init() {
    lastMob = isMobile();
    initThemeSwitch();
    attachSearch($('#mainSearch'), $('#mainSuggest'));
    attachSearch($('#miniSearch'), $('#miniSuggest'));
    const mini = $('#miniSearch'), mq = window.matchMedia('(max-width: 640px)');
    const ph = () => { mini.placeholder = mq.matches ? 'Search…' : 'Search another company…'; };
    ph(); if (mq.addEventListener) mq.addEventListener('change', ph);
    initCompareSwitch();
    $('#quickChips').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (b) location.hash = '#/s/' + encodeURIComponent(b.dataset.s); });
    window.addEventListener('hashchange', route);
    route();
  }
  /* ---------- shared with js/compare.js (the stock comparison page) ---------- */
  // one company's full model, fetched and computed exactly like the dashboard's
  async function loadModel(symbol) {
    const o = { prio: PRIO.main };
    const [c5, c1, ts, sum] = await Promise.allSettled([Yahoo.chart(symbol, '5y', '1wk', o), Yahoo.chart(symbol, '1y', '1d', o), Yahoo.timeseries(symbol, o), Yahoo.summary(symbol, o)]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const ok = (r) => { const v = val(r); return v && v.chart && v.chart.result && v.chart.result[0]; };
    if (!ok(c5) && !ok(c1)) {
      const err = [c1, c5].map((r) => (r.status === 'rejected' ? r.reason : null)).find(Boolean) || new Error('Yahoo Finance has no price data for this symbol.');
      if (!err.status && !err.cancelled && !/no price/i.test(err.message)) err.message = explain(err);
      throw err;
    }
    const model = A.buildModel(symbol, val(c5), val(c1), val(ts), val(sum), state.lastHits[symbol]);
    const d = domainOf(model.website); if (d) saveDom(symbol, d);
    return model;
  }
  // a model the dashboard already built (the stock just viewed, or one of its industry peers): no need to fetch it again
  function cachedModel(sym) {
    if (state.model && state.model.symbol === sym) return state.model;
    return (state.ind && state.ind.models.find((x) => x.symbol === sym)) || null;
  }
  // the industry peers found for a stock on its dashboard (suggestions on the Compare page)
  const peersOf = (sym) => (state.model && state.model.symbol === sym && state.ind ? state.ind.models.map((x) => ({ symbol: x.symbol, name: x.name, website: x.website })) : []);
  window.PlutusApp = { loadModel, cachedModel, peersOf, attachSearch, logoHTML, domainOf, knownDomain: (sym) => domCache[sym] || SEED_DOMAINS[sym] || '', shortName, tc, isMobile, ico, esc,
    pushRecent, isIndian, dLabel, setupChartDefaults, observeReveal };

  document.addEventListener('DOMContentLoaded', init);
})();
