/* ============================================================
   PLUTUS — Compare stocks (side by side)
   ------------------------------------------------------------
   Address: #/compare/AAPL,MSFT,NVDA  (2 to 4 companies; the list
   lives in the address, so a comparison can be bookmarked / shared).
   Every company is loaded and scored exactly like its dashboard
   (js/app.js → PlutusApp.loadModel, js/analysis.js), then shown as:
     • a card per company (price, Health score, headline numbers)
     • highlights in plain English ("Highest net margin: …")
     • share-price performance on one chart (rebased to 100),
       the six Health Scan stats as a radar, net margin by year
     • a full table, grouped, with ★ on the best figure of each
       line (where "best" has a clear meaning) and a tally of how
       often each company comes out on top.
   Money amounts are only compared between companies that report
   in the same currency. Facts only — never a buy / sell / hold.
   Entry points: "Compare with other stocks" on a dashboard,
   "Compare these side by side" under the Peer Arena table, and
   "Compare stocks" on the home page.
   ============================================================ */
(function () {
  'use strict';
  const MAX = 4;
  const $ = (s, r) => (r || document).querySelector(s);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  let P = null, A = null, built = false;
  const st = { syms: [], models: new Map(), errors: new Map(), loading: new Set(), charts: [], range: '1y' };

  // one colour per company (6-digit hex: the chart fills append an alpha byte)
  const PALETTE = { light: ['#2447c4', '#c2620a', '#0a875a', '#b0277a'], dark: ['#3ea6ff', '#ffc857', '#2ee6a6', '#ff7ab6'] };
  const colors = () => PALETTE[P.tc().theme === 'dark' ? 'dark' : 'light'];

  const QUICK = [
    ['Indian IT', 'TCS.NS,INFY.NS,HCLTECH.NS,WIPRO.NS'],
    ['Indian private banks', 'HDFCBANK.NS,ICICIBANK.NS,KOTAKBANK.NS,AXISBANK.NS'],
    ['Indian FMCG', 'HINDUNILVR.NS,ITC.NS,NESTLEIND.NS,BRITANNIA.NS'],
    ['US big tech', 'AAPL,MSFT,GOOGL,NVDA'],
    ['US banks', 'JPM,BAC,WFC,C']
  ];

  /* ---------------------------------------------------------------- what is compared
     better: 'high' / 'low' = which end is better (gets the ★); null = no "better" (size, beta …).
     f: how to show it. cur: money in the trading ('px') or reporting ('fin') currency. */
  const pillar = (k) => (m) => { const p = m.scores.pillars.find((x) => x.key === k); return p ? p.score : null; };
  const GROUPS = [
    { g: 'Size', rows: [
      { k: 'mc', label: 'Market value', get: (m) => m.marketCap, f: 'money', cur: 'px', better: null },
      { k: 'rev', label: 'Revenue (latest year)', get: (m) => m.revLast, f: 'money', cur: 'fin', better: null },
      { k: 'ni', label: 'Net profit (latest year)', get: (m) => m.niLast, f: 'money', cur: 'fin', better: null }
    ] },
    { g: 'Growth', rows: [
      { k: 'revYoY', plus: true, label: 'Revenue growth, last year', get: (m) => m.revYoY, f: 'pct', better: 'high', hl: 'Fastest-growing sales last year' },
      { k: 'revCAGR', plus: true, label: 'Revenue growth per year (up to 5 yrs)', get: (m) => m.revCAGR, f: 'pct', better: 'high' },
      { k: 'niYoY', plus: true, label: 'Profit growth, last year', get: (m) => m.niYoY, f: 'pct', better: 'high' },
      { k: 'niCAGR', plus: true, label: 'Profit growth per year (up to 5 yrs)', get: (m) => m.niCAGR, f: 'pct', better: 'high' }
    ] },
    { g: 'Profitability', rows: [
      { k: 'nm', label: 'Net margin', get: (m) => m.netMargin, f: 'pct', better: 'high', hl: 'Keeps the most of each sale as profit' },
      { k: 'om', label: 'Operating margin', get: (m) => (m.isFinancial ? null : m.opMargin), f: 'pct', better: 'high' },
      { k: 'roe', label: 'Return on equity (ROE)', get: (m) => m.roe, f: 'pct', better: 'high', hl: 'Most profit per unit of shareholders’ money' }
    ] },
    { g: 'Valuation', rows: [
      { k: 'pe', label: 'P/E ratio', get: (m) => (m.negEarnings ? null : A.validPe(m.pe)), f: 'x', better: 'low', hl: 'Lowest price for each unit of profit (P/E)', na: (m) => (m.negEarnings ? 'loss' : '') },
      { k: 'pb', label: 'Price / book value', get: (m) => (isNum(m.pb) && m.pb > 0 ? m.pb : null), f: 'x', better: 'low' },
      { k: 'dy', label: 'Dividend yield', get: (m) => m.divYield, f: 'pct2', better: 'high', hl: 'Highest dividend yield' }
    ] },
    { g: 'Financial strength', rows: [
      { k: 'de', label: 'Debt / equity', get: (m) => (m.isFinancial ? null : m.de), f: 'x2', better: 'low', hl: 'Least debt for its size', na: (m) => (m.isFinancial ? 'n/a (financial)' : '') },
      { k: 'cr', label: 'Current ratio', get: (m) => (m.isFinancial ? null : m.currentRatio), f: 'x2', better: 'high', na: (m) => (m.isFinancial ? 'n/a (financial)' : '') },
      { k: 'fcfm', label: 'Free cash flow ÷ revenue', get: (m) => m.fcfMargin, f: 'pct', better: 'high' },
      { k: 'eqa', label: 'Equity ÷ assets', get: (m) => m.equityToAssets, f: 'pct', better: 'high' }
    ] },
    { g: 'Share price', rows: [
      { k: 'r1', plus: true, label: 'Return, last 12 months', get: (m) => m.ret1y, f: 'pct', better: 'high', hl: 'Best share-price return over 12 months' },
      { k: 'r5', plus: true, label: 'Return, last 5 years', get: (m) => m.ret5y, f: 'pct', better: 'high' },
      { k: 'vol', label: 'Volatility (yearly)', get: (m) => m.vol, f: 'pct0', better: 'low', hl: 'Calmest share price' },
      { k: 'dd', label: 'Biggest fall in 12 months', get: (m) => m.maxDD, f: 'pct0', better: 'high' },
      { k: 'pos', label: 'Position in 52-week range', get: (m) => m.pos52, f: 'pct0', better: null },
      { k: 'beta', label: 'Beta (vs. the market)', get: (m) => m.beta, f: 'x2', better: null }
    ] },
    { g: 'Health Scan (0–100)', score: true, rows: [
      { k: 'overall', label: 'Overall health score', get: (m) => m.scores.overall, f: 'pts', better: 'high', hl: 'Highest overall Health score' },
      { k: 'p_growth', label: 'Growth', get: pillar('growth'), f: 'pts', better: 'high' },
      { k: 'p_profit', label: 'Profitability', get: pillar('profit'), f: 'pts', better: 'high' },
      { k: 'p_strength', label: 'Balance sheet', get: pillar('strength'), f: 'pts', better: 'high' },
      { k: 'p_value', label: 'Price tag', get: pillar('value'), f: 'pts', better: 'high' },
      { k: 'p_stability', label: 'Stability', get: pillar('stability'), f: 'pts', better: 'high' },
      { k: 'p_track', label: 'Track record', get: pillar('track'), f: 'pts', better: 'high' }
    ] },
    { g: 'Governance', rows: [
      { k: 'gov', label: 'Governance risk (ISS, 1 = lowest)', get: (m) => (m.gov && m.gov.risk ? m.gov.risk.overall : null), f: 'risk', better: 'low' }
    ] }
  ];

  function fmt(row, v, m) {
    if (!isNum(v)) return '—';
    switch (row.f) {
      case 'money': return A.fmtMoney(v, row.cur === 'px' ? m.currency : m.finCurrency);
      case 'pct': return A.fmtPct(v, 1, !!row.plus);
      case 'pct2': return A.fmtPct(v, 2);
      case 'pct0': return A.fmtPct(v, 0);
      case 'x': return A.fmtX(v, 1);
      case 'x2': return A.fmtX(v, 2);
      case 'pts': return String(Math.round(v));
      case 'risk': return `${Math.round(v)}/10`;
      default: return String(v);
    }
  }
  const curOf = (row, m) => (row.cur === 'px' ? m.currency : m.finCurrency);
  // the ★: best value(s) of a line, if "better" makes sense and the values can be compared
  function bestOf(row, models) {
    if (!row.better) return { best: new Set(), cmp: false };
    const vals = models.map((m) => row.get(m));
    const ok = vals.map(isNum);
    if (ok.filter(Boolean).length < 2) return { best: new Set(), cmp: false };
    // money in different currencies can't be ranked
    if (row.f === 'money' && new Set(models.filter((m, i) => ok[i]).map((m) => curOf(row, m))).size > 1) return { best: new Set(), cmp: false };
    const top = vals.reduce((b, v, i) => (!ok[i] ? b : b == null ? v : row.better === 'high' ? Math.max(b, v) : Math.min(b, v)), null);
    const best = new Set(models.filter((m, i) => ok[i] && Math.abs(vals[i] - top) < 1e-9).map((m) => m.symbol));
    return { best: best.size === models.length ? new Set() : best, cmp: true };
  }

  /* ---------------------------------------------------------------- page shell (built once) */
  function build() {
    const view = $('#viewCompare'); if (!view || built) return;
    built = true;
    view.innerHTML = `
      <section class="cx-head">
        <p class="eyebrow">Side by side</p>
        <h1>Compare stocks</h1>
        <p class="cx-sub">Pick 2 to 4 companies. Every number is worked out exactly as on each company’s own page. ★ marks the best figure on a line — a fact, not a recommendation.</p>
        <div class="cx-picker">
          <ul class="cx-chips" id="cxChips" aria-label="Companies being compared"></ul>
          <div class="cx-add" id="cxAddWrap">
            <svg class="mini-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input id="cxSearch" type="text" placeholder="Add a company…" autocomplete="off" spellcheck="false" aria-label="Add a company to the comparison" />
            <ul class="suggest" id="cxSuggest" role="listbox"></ul>
          </div>
        </div>
        <div class="cx-quick" id="cxQuick"><span class="chips-label">Try</span>${QUICK.map(([l, v]) => `<button type="button" data-set="${v}">${P.esc(l)}</button>`).join('')}</div>
      </section>
      <div id="cxBody"></div>`;
    P.attachSearch($('#cxSearch'), $('#cxSuggest'), (it) => add(it.symbol));
    $('#cxQuick').addEventListener('click', (e) => { const b = e.target.closest('button[data-set]'); if (b) go(b.dataset.set.split(',')); });
    $('#cxChips').addEventListener('click', (e) => { const b = e.target.closest('button[data-rm]'); if (b) go(st.syms.filter((x) => x !== b.dataset.rm)); });
    view.addEventListener('click', (e) => {
      const rm = e.target.closest('.cx-err [data-rm]'); if (rm) { go(st.syms.filter((x) => x !== rm.dataset.rm)); return; }
      const r = e.target.closest('[data-retry]'); if (r) { st.errors.delete(r.dataset.retry); load(r.dataset.retry); renderBody(); return; }
      const a = e.target.closest('[data-add]'); if (a) { add(a.dataset.add); return; }
      const rg = e.target.closest('#cxRange button[data-r]'); if (rg) { st.range = rg.dataset.r; $('#cxRange').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === rg)); drawPrice(); }
    });
    window.addEventListener('plutus:theme', () => { if (!view.classList.contains('hidden')) drawCharts(); });
  }
  function go(list) {
    const uniq = [...new Set(list.map((x) => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, MAX);
    location.hash = '#/compare/' + uniq.map(encodeURIComponent).join(',');
  }
  function add(sym) {
    sym = String(sym || '').toUpperCase(); if (!sym) return;
    if (st.syms.includes(sym)) { flash(`${sym} is already in the comparison.`); return; }
    if (st.syms.length >= MAX) { flash(`Up to ${MAX} companies at a time — remove one first.`); return; }
    go(st.syms.concat(sym));
  }
  let flashT = 0;
  function flash(text) {
    const t = $('#cmpToast'); if (!t) return;
    t.innerHTML = `<span class="tg-t">${P.esc(text)}</span>`; t.classList.add('in');
    clearTimeout(flashT); flashT = setTimeout(() => t.classList.remove('in'), 2600);
  }

  /* ---------------------------------------------------------------- data */
  function load(sym) {
    if (st.models.has(sym) || st.loading.has(sym)) return;
    const seeded = P.cachedModel(sym);
    if (seeded) { st.models.set(sym, seeded); return; }
    st.loading.add(sym);
    P.loadModel(sym).then((m) => { st.models.set(sym, m); st.errors.delete(sym); },
      (e) => { st.errors.set(sym, (e && e.message) || 'Couldn’t load this company.'); })
      .finally(() => { st.loading.delete(sym); if (st.syms.includes(sym)) { renderChips(); renderBody(); } });
  }
  function show(syms) {
    if (!window.PlutusApp || !window.Analysis) return;
    P = window.PlutusApp; A = window.Analysis;
    build();
    st.syms = [...new Set(syms)].slice(0, MAX);
    st.syms.forEach(load);
    renderChips();
    renderBody();
    const input = $('#cxSearch');
    if (input) input.placeholder = st.syms.length >= MAX ? `Up to ${MAX} companies` : st.syms.length ? 'Add another company…' : 'Add a company…';
    if (st.syms.length < 2 && input && !P.isMobile()) setTimeout(() => input.focus(), 60);
  }

  /* ---------------------------------------------------------------- rendering */
  const nameOf = (sym) => { const m = st.models.get(sym); return m ? P.shortName(m.name) : sym; };
  function renderChips() {
    const el = $('#cxChips'); if (!el) return;
    const cs = colors();
    el.innerHTML = st.syms.map((s, i) => {
      const m = st.models.get(s);
      return `<li class="cx-chip" style="--c:${cs[i]}">${P.logoHTML(m ? P.domainOf(m.website) : P.knownDomain(s), m ? m.name : s, 'sm', s)}
        <span class="cx-cn">${P.esc(nameOf(s))}</span><span class="cx-cs">${P.esc(s)}</span>
        ${st.loading.has(s) ? '<span class="s-spin" aria-label="loading"></span>' : ''}
        <button type="button" class="cx-rm" data-rm="${P.esc(s)}" aria-label="Remove ${P.esc(nameOf(s))}">×</button></li>`;
    }).join('');
  }
  function destroyCharts() { st.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } }); st.charts = []; }

  function renderBody() {
    const body = $('#cxBody'); if (!body) return;
    destroyCharts();
    const errs = st.syms.filter((s) => st.errors.has(s));
    const errHTML = errs.map((s) => `<div class="notice cx-err">Couldn’t load <b>${P.esc(s)}</b>: ${P.esc(st.errors.get(s))}
      <button type="button" class="pv-link" data-retry="${P.esc(s)}">Try again</button> · <button type="button" class="pv-link" data-rm="${P.esc(s)}">Remove</button></div>`).join('');
    const have = st.syms.filter((s) => st.models.has(s));
    const waiting = st.syms.filter((s) => st.loading.has(s));
    if (st.syms.length < 2) { body.innerHTML = errHTML + emptyHTML(); return; }
    if (waiting.length) {
      body.innerHTML = errHTML + `<div class="peer-loading cx-loading"><div class="orbit sm"><span></span></div><span>Loading ${have.length + 1} of ${st.syms.length - errs.length} · ${P.esc(waiting.map(nameOf).join(', '))}…</span></div>`;
      return;
    }
    if (have.length < 2) { body.innerHTML = errHTML + emptyHTML(); return; }
    const models = have.map((s) => st.models.get(s));
    const cs = colors();
    const colorOf = (m) => cs[st.syms.indexOf(m.symbol)];
    body.innerHTML = errHTML + cardsHTML(models, colorOf) + highlightsHTML(models) + chartsHTML() + tableHTML(models, colorOf) +
      `<p class="cx-foot">Source: Yahoo Finance, as on each company’s page. Money amounts are shown in each company’s own currency and are only ranked against companies that report in the same currency. ★ = best on that line where “better” has a clear meaning — compare like with like (a bank and a software company are built differently). Not investment advice.</p>`;
    drawCharts();
    if (P.observeReveal) P.observeReveal();
  }
  function emptyHTML() {
    const one = st.syms.length === 1 ? st.syms[0] : '';
    const peers = one ? P.peersOf(one).filter((p) => p.symbol !== one).slice(0, 6) : [];
    return `<div class="cx-empty panel">
        <h2>${one ? `Add at least one more company to compare with <b>${P.esc(nameOf(one))}</b>` : 'Add two or more companies to compare them'}</h2>
        <p>Search above, or pick a ready-made set under “Try”.</p>
        ${peers.length ? `<div class="cx-sugg"><span class="chips-label">Same industry</span>${peers.map((p) => `<button type="button" class="cx-sg" data-add="${P.esc(p.symbol)}">${P.logoHTML(P.domainOf(p.website), p.name, 'sm', p.symbol)}<span>${P.esc(P.shortName(p.name))}</span></button>`).join('')}</div>` : ''}
      </div>`;
  }

  function ringSVG(score, color) {
    const C = 2 * Math.PI * 34, v = isNum(score) ? score : 0;
    return `<svg class="cx-ring" viewBox="0 0 80 80" aria-hidden="true"><circle class="track" cx="40" cy="40" r="34"/><circle class="bar" cx="40" cy="40" r="34" style="stroke:${color}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - v / 100)).toFixed(1)}"/></svg><b class="cx-rn">${isNum(score) ? Math.round(score) : '—'}</b>`;
  }
  const scoreColor = (s) => (s == null ? 'var(--dim)' : s >= 70 ? 'var(--good)' : s >= 45 ? 'var(--warn)' : 'var(--bad)');
  function cardsHTML(models, colorOf) {
    return `<section class="cx-cards" style="--n:${models.length}">${models.map((m) => {
      const chg = isNum(m.changePct) ? `<span class="${m.changePct > 0 ? 'good' : m.changePct < 0 ? 'bad' : 'muted'}">${A.fmtPct(m.changePct, 2, true)}</span>` : '';
      return `<article class="cx-card panel" style="--c:${colorOf(m)}">
        <div class="cx-ct">${P.logoHTML(P.domainOf(m.website), m.name, 'md', m.symbol)}<div class="cx-cid"><b>${P.esc(P.shortName(m.name))}</b><span>${P.isIndian(m.symbol) ? '<b class="in-tag">IN</b>' : ''}${P.esc(m.symbol)} · ${P.esc(m.exchange)}</span></div></div>
        <div class="cx-px"><span class="cx-pv">${A.fmtPrice(m.price, m.currency)}</span>${chg}</div>
        <div class="cx-score"><span class="cx-ringw">${ringSVG(m.scores.overall, scoreColor(m.scores.overall))}</span><span><b class="cx-tier ${m.scores.tier.cls}">${P.esc(m.scores.tier.label)}</b><small>Health score, out of 100</small></span></div>
        <dl class="cx-kv">
          <div><dt>Market value</dt><dd>${A.fmtMoney(m.marketCap, m.currency)}</dd></div>
          <div><dt>P/E</dt><dd>${m.negEarnings ? 'loss' : A.fmtX(m.pe, 1)}</dd></div>
          <div><dt>Net margin</dt><dd>${A.fmtPct(m.netMargin)}</dd></div>
          <div><dt>1-yr return</dt><dd class="${isNum(m.ret1y) ? (m.ret1y >= 0 ? 'good' : 'bad') : ''}">${A.fmtPct(m.ret1y, 1, true)}</dd></div>
        </dl>
        <p class="cx-ind">${P.esc(m.industry || m.sector || '')}</p>
        <a class="cx-open" href="#/s/${encodeURIComponent(m.symbol)}">Open full analysis →</a>
      </article>`;
    }).join('')}</section>`;
  }
  // plain-English highlights: who leads on the measures most people look at first, with the figure
  function highlightsHTML(models) {
    const lines = [];
    GROUPS.forEach((g) => g.rows.forEach((row) => {
      if (!row.hl) return;
      const { best, cmp } = bestOf(row, models); if (!cmp || !best.size || best.size > 1) return;
      const m = models.find((x) => best.has(x.symbol));
      const others = models.filter((x) => x !== m && isNum(row.get(x))).map((x) => `${P.esc(P.shortName(x.name))} ${fmt(row, row.get(x), x)}`).join(', ');
      lines.push(`<li><span class="cx-hl-k">${P.esc(row.hl)}</span><span class="cx-hl-v"><b>${P.esc(P.shortName(m.name))}</b> · ${fmt(row, row.get(m), m)}${others ? `<small> (vs ${others})</small>` : ''}</span></li>`);
    }));
    // how often each company has the best figure (lines where "better" is clear, Health Scan sub-scores left out)
    const tally = models.map((m) => ({ m, n: 0 })); let total = 0;
    GROUPS.forEach((g) => { if (g.score) return; g.rows.forEach((row) => { const { best, cmp } = bestOf(row, models); if (!cmp) return; total++; tally.forEach((t) => { if (best.has(t.m.symbol)) t.n++; }); }); });
    const cs = colors(), max = Math.max(1, ...tally.map((t) => t.n));
    const bars = total ? `<div class="cx-tally"><div class="panel-title">Best figure on ${total} comparable lines</div>${tally.map((t) => `<div class="cx-tr"><span class="cx-tn">${P.esc(P.shortName(t.m.name))}</span><span class="cx-tb"><i style="width:${(t.n / max * 100).toFixed(0)}%;background:${cs[st.syms.indexOf(t.m.symbol)]}"></i></span><b>${t.n}</b></div>`).join('')}
      <p class="cx-note">A count of ★s in the table below — every line weighs the same, so read the lines that matter to you.</p></div>` : '';
    if (!lines.length && !bars) return '';
    return `<section class="section cx-sec reveal"><div class="section-head"><span class="idx">01</span><h2>Highlights</h2><p>Who stands out, in plain words</p></div>
      <div class="cx-hl">${lines.length ? `<div class="panel"><div class="panel-title">At a glance</div><ul class="cx-hl-l">${lines.join('')}</ul></div>` : ''}${bars ? `<div class="panel">${bars}</div>` : ''}</div></section>`;
  }
  function chartsHTML() {
    return `<section class="section cx-sec reveal"><div class="section-head"><span class="idx">02</span><h2>Side-by-side charts</h2><p>Tap a name in a legend to hide or show it</p></div>
      <div class="charts">
        <div class="chart-card wide"><h3>Share price performance<div class="toggle" id="cxRange" role="group" aria-label="Time range"><button type="button" data-r="1y" class="${st.range === '1y' ? 'on' : ''}">1Y</button><button type="button" data-r="5y" class="${st.range === '5y' ? 'on' : ''}">5Y</button></div></h3>
          <p class="what">Each share price set to 100 at the start, so the lines show percentage moves and can be compared whatever the price or currency (dividends not included).</p>
          <div class="chart-box" id="cxBoxPrice"><canvas id="cxPrice"></canvas></div><div class="takeaway hidden" id="cxTkPrice"></div></div>
        <div class="chart-card"><h3>Health Scan</h3><p class="what">The six power stats (0–100) from each company’s Health Scan. Bigger shape = stronger on more fronts.</p><div class="chart-box" id="cxBoxRadar"><canvas id="cxRadar"></canvas></div></div>
        <div class="chart-card"><h3>Net margin by year</h3><p class="what">Out of every 100 of sales, how much was left as profit after all costs.</p><div class="chart-box" id="cxBoxMargin"><canvas id="cxMargin"></canvas></div></div>
      </div></section>`;
  }
  /* "Every number": one set of data, two layouts (CSS shows one of them)
     • wider screens: a table whose header row (the company names) sticks under the top bar while this section scrolls
       (the table is not inside a sideways-scrolling box there, which is what stopped the header from sticking);
     • phones: a card per measure, with one line per company (colour dot · name · value), so nothing has to be swiped. */
  function tableHTML(models, colorOf) {
    const head = `<tr><th scope="col">Measure</th>${models.map((m) => `<th scope="col" style="--c:${colorOf(m)}"><span class="cx-th">${P.logoHTML(P.domainOf(m.website), m.name, 'sm', m.symbol)}<span class="cx-thn"><b>${P.esc(P.shortName(m.name))}</b><small>${P.esc(m.symbol)}</small></span></span></th>`).join('')}</tr>`;
    let rows = '', cards = '';
    GROUPS.forEach((g) => {
      const lines = g.rows.filter((row) => models.some((m) => isNum(row.get(m))));
      if (!lines.length) return;
      rows += `<tr class="cx-g"><td colspan="${models.length + 1}">${P.esc(g.g)}</td></tr>`;
      let gc = '';
      lines.forEach((row) => {
        const { best } = bestOf(row, models);
        const mixedCur = row.f === 'money' && new Set(models.filter((m) => isNum(row.get(m))).map((m) => curOf(row, m))).size > 1;
        const tip = row.better === 'high' ? 'Higher is better' : row.better === 'low' ? 'Lower is better' : mixedCur ? 'Different currencies — not ranked' : 'No “better” here — for context';
        const val = (m) => { const v = row.get(m), na = row.na && !isNum(v) ? row.na(m) : ''; return isNum(v) ? fmt(row, v, m) : `<span class="muted">${P.esc(na || '—')}</span>`; };
        rows += `<tr><th scope="row"><span>${P.esc(row.label)}</span><small>${tip}</small></th>${models.map((m) => {
          const b = best.has(m.symbol);
          return `<td class="${b ? 'best' : ''}">${b ? '<i class="cx-star" aria-label="best">★</i>' : ''}${val(m)}</td>`;
        }).join('')}</tr>`;
        gc += `<li class="cx-mc"><div class="cx-mh"><b>${P.esc(row.label)}</b><small>${tip}</small></div><ul class="cx-mv">${models.map((m) => {
          const b = best.has(m.symbol);
          return `<li class="${b ? 'best' : ''}" style="--c:${colorOf(m)}"><span class="cx-mn"><i class="cx-dot"></i>${P.esc(P.shortName(m.name))}</span><span class="cx-mval">${b ? '<i class="cx-star" aria-label="best">★</i>' : ''}${val(m)}</span></li>`;
        }).join('')}</ul></li>`;
      });
      cards += `<div class="cx-mg"><h3 class="cx-mgh">${P.esc(g.g)}</h3><ul class="cx-ml">${gc}</ul></div>`;
    });
    const legend = `<div class="cx-mleg" aria-hidden="true">${models.map((m) => `<span style="--c:${colorOf(m)}"><i class="cx-dot"></i>${P.esc(P.shortName(m.name))}</span>`).join('')}</div>`;
    return `<section class="section cx-sec cx-every reveal"><div class="section-head"><span class="idx">03</span><h2>Every number</h2><p>★ = best on that line</p></div>
      <div class="cx-tw"><table class="peer-table cx-table" style="--n:${models.length}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
      <div class="cx-mobile">${legend}${cards}</div></section>`;
  }

  /* ---------------------------------------------------------------- charts */
  const ready = () => st.syms.filter((s) => st.models.has(s)).map((s) => st.models.get(s));
  function mk(id, cfg) { const cv = document.getElementById(id); if (!cv || !window.Chart) return null; const c = new Chart(cv, cfg); st.charts.push(c); return c; }
  function dropChart(id) { const i = st.charts.findIndex((c) => c.canvas && c.canvas.id === id); if (i >= 0) { st.charts[i].destroy(); st.charts.splice(i, 1); } }
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const weekKey = (t) => { const d = new Date(t); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }; // Monday of that week
  function drawPrice() {
    dropChart('cxPrice');
    const models = ready(); if (models.length < 2) return;
    const cs = colors(), mob = P.isMobile(), daily = st.range === '1y';
    const key = daily ? dayKey : weekKey;
    const maps = models.map((m) => { const mp = new Map(); (daily ? m.priceDaily : m.priceWeekly).forEach((p) => mp.set(key(p.t), p.v)); return mp; });
    const start = maps.map((mp) => [...mp.keys()].sort()[0]).filter(Boolean).sort().pop(); // the latest first date: every line starts together
    const keys = [...new Set(maps.flatMap((mp) => [...mp.keys()]))].filter((k) => k >= start).sort();
    const box = $('#cxBoxPrice');
    if (keys.length < 2) { if (box) box.innerHTML = '<div class="nodata">Not enough price history</div>'; return; }
    if (box && !box.querySelector('canvas')) box.innerHTML = '<canvas id="cxPrice"></canvas>';
    const sets = models.map((m, i) => {
      const mp = maps[i]; let base = null;
      const data = keys.map((k) => { const v = mp.get(k); if (!isNum(v)) return null; if (base == null) base = v; return base > 0 ? +(v / base * 100).toFixed(2) : null; });
      const col = cs[st.syms.indexOf(m.symbol)];
      return { label: P.shortName(m.name), data, borderColor: col, backgroundColor: col, borderWidth: 1.8, pointRadius: 0, tension: 0.15, spanGaps: true };
    });
    mk('cxPrice', { type: 'line', data: { labels: keys.map((k) => P.dLabel(Date.parse(k), daily)), datasets: sets },
      options: { interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y >= 100 ? '+' : ''}${(x.parsed.y - 100).toFixed(1)}%` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: mob ? 4 : 8, maxRotation: 0 } },
          y: { position: 'right', ticks: { maxTicksLimit: mob ? 5 : 7, callback: (v) => v } } } } });
    const ends = sets.map((s) => { const d = s.data.filter(isNum); return { n: s.label, r: d.length ? d[d.length - 1] / 100 - 1 : null }; }).filter((x) => isNum(x.r)).sort((a, b) => b.r - a.r);
    const tk = $('#cxTkPrice');
    if (tk && ends.length) {
      tk.textContent = `Over ${daily ? 'the last 12 months' : 'the last 5 years'}: ` + ends.map((e) => `${e.n} ${e.r >= 0 ? '+' : ''}${(e.r * 100).toFixed(e.r * 100 > -10 && e.r * 100 < 10 ? 1 : 0)}%`).join(' · ') + '.';
      tk.classList.remove('hidden');
    }
  }
  function drawCharts() {
    const models = ready(); if (models.length < 2 || !window.Chart) return;
    if (P.setupChartDefaults) P.setupChartDefaults();
    st.charts.slice().forEach((c) => c.destroy()); st.charts = [];
    const cs = colors(), C = P.tc(), mob = P.isMobile();
    drawPrice();
    // radar: the six Health Scan stats
    const names = models[0].scores.pillars.map((p) => p.name);
    mk('cxRadar', { type: 'radar',
      data: { labels: names, datasets: models.map((m) => { const col = cs[st.syms.indexOf(m.symbol)]; return { label: P.shortName(m.name), data: m.scores.pillars.map((p) => (isNum(p.score) ? p.score : null)), borderColor: col, backgroundColor: col + '22', pointBackgroundColor: col, borderWidth: 1.8, pointRadius: mob ? 2 : 3, spanGaps: true }; }) },
      options: { scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent', color: C.dim, display: !mob }, grid: { color: C.grid }, angleLines: { color: C.grid }, pointLabels: { color: C.muted, font: { size: mob ? 10 : 11 } } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.r}` } } } } });
    // net margin by fiscal year (labels like FY23 … FY25)
    const labels = [...new Set(models.flatMap((m) => m.annual.labels))].sort();
    const msets = models.map((m) => {
      const col = cs[st.syms.indexOf(m.symbol)];
      return { label: P.shortName(m.name), data: labels.map((l) => { const i = m.annual.labels.indexOf(l); const v = i >= 0 ? m.annual.netMarginS[i] : null; return isNum(v) ? +(v * 100).toFixed(2) : null; }),
        borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: mob ? 2 : 3, tension: 0.25, spanGaps: true };
    });
    if (labels.length && msets.some((s) => s.data.some(isNum))) {
      mk('cxMargin', { type: 'line', data: { labels, datasets: msets },
        options: { plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}%` } } },
          scales: { x: { grid: { display: false } }, y: { ticks: { maxTicksLimit: 6, callback: (v) => v + '%' } } } } });
    } else { const b = $('#cxBoxMargin'); if (b) b.innerHTML = '<div class="nodata">No yearly figures published</div>'; }
  }

  window.PlutusCompare = { show, _state: st };
})();
