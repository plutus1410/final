/* ============================================================
   PLUTUS — voice bot ("Ask Plutus")
   A floating button on every stock page opens a small panel where visitors ask about the company's latest
   annual report, by voice or by typing. How it works:
     1. data/reports/<SYMBOL>.json  — the report, pre-split into labelled chunks by the GitHub Actions job
        (scripts/prepare_report.py). If it doesn't exist yet, the Worker is asked to start that job and this
        panel waits for it.
     2. the best passages for the question are found here in the browser (keyword search, BM25)
     3. the Worker (POST /ask) gives only those passages to a free AI model, with strict "answer only from
        these, cite them" rules, and checks every number in the answer against the passages
     4. the answer is shown with its sources and read aloud:
          • "Natural (HD)" voice  — the Worker (POST /speak) turns the spoken answer into natural-sounding audio
          • "This device" voice   — the browser's own speech (used automatically if the HD voice is unavailable)
        The ⚙ button in the panel lets the visitor choose the voice type, the voice and the speed.
     5. an animated orb (canvas) shows what Plutus is doing — idle, listening, thinking or speaking; tapping it starts / stops the mic.
   Everything the AI says is put on the page as plain text (never as HTML).
   v8:
     • patient listening — the mic stays open while you talk and only sends after you pause (Short / Normal / Long, in ⚙);
       tap the mic or the orb to send straight away
     • Indian English — speech is recognised as en-IN; the HD voice is Sarvam AI's Indian voices (Worker /speak), and the
       device fallback prefers the device's Indian-English voices; long answers are read in full, sentence group by group
     • question refining — the Worker (/refine) turns a spoken / vague question into a clear one plus annual-report search
       terms; the passages are searched with those and the visitor sees "Understood as: …"
     • detailed answers — more passages (one search per sub-question), a structured breakdown shown open under the answer
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  if (CFG.VOICE_BOT === false) return;
  const WORKER = String(CFG.WORKER_URL || '').replace(/\/+$/, '');
  const REPORTS = String(CFG.REPORTS_PATH || 'data/reports/').replace(/\/?$/, '/');
  if (!WORKER) return; // everything goes through the Worker

  const POLL_MS = Number(CFG.VOICE_POLL_MS) || 15000, POLL_MAX_MS = 15 * 60 * 1000;
  const HD_ALLOWED = CFG.VOICE_HD !== false;       // set VOICE_HD: false in config.js to use device voices only
  const LANG = String(CFG.VOICE_LANG || 'en-IN');  // speech recognition + preferred device voice (Indian English)
  const K = { speak: 'plutus.voice.speak.v1', engine: 'plutus.voice.engine.v2', hd: 'plutus.voice.hd.v3', dev: 'plutus.voice.dev.v3', rate: 'plutus.voice.rate.v2', wait: 'plutus.voice.wait.v1', brain: 'plutus.voice.brain.v1' };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  // Sarvam AI "Bulbul" Indian-English voices, served by the Worker's /speak
  const HD_VOICES = [['shubh', 'Shubh (male)'], ['aditya', 'Aditya (male)'], ['rahul', 'Rahul (male)'], ['kabir', 'Kabir (male)'],
    ['priya', 'Priya (female)'], ['ritu', 'Ritu (female)'], ['neha', 'Neha (female)'], ['kavya', 'Kavya (female)'], ['shreya', 'Shreya (female)']];
  const SAMPLE = 'Namaste, I\u2019m Plutus. This is how I\u2019ll read out the annual report answers for you.';
  // how long a pause ends your question (after you've started speaking); before the first word Plutus waits FIRST_WORD_MS
  const WAITS = { short: 1500, normal: 2600, long: 4200 };
  const FIRST_WORD_MS = 9000, LISTEN_MAX_MS = 120000;
  const N_EXCERPTS = 9;
  // v9 "never run out": the extra AI call that rewrites questions is off by default (it spent tokens on every question);
  // the answer itself now says how it understood the question. Set VOICE_REFINE: true in config.js to turn it back on.
  const USE_REFINE = CFG.VOICE_REFINE === true;
  const LOCAL_AI = CFG.VOICE_LOCAL_AI !== false;   // on-device answers when the free cloud services are used up
  const FOLLOW_UP = /^(and|also|what about|how about|but|so|then|why)\b|\b(it|that|this|they|those|them|these|its|their)\b/i;
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------------------------------------------------------------- helpers */
  const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_'); // same rule as scripts/prepare_report.py
  function currentSymbol() {
    const m = location.hash.match(/^#\/s\/(.+)$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]).toUpperCase(); } catch (e) { return null; }
  }
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const errX = (code, status) => Object.assign(new Error(code), { code, status });
  const clampRate = (x) => Math.min(1.4, Math.max(0.75, Number(x) || 1));

  /* ---------------------------------------------------------------- state */
  const S = {
    sym: null, report: null, index: null, history: [],
    loadToken: 0, pollTimer: null, askAbort: null,
    speakOn: store.get(K.speak, '1') !== '0',
    engine: HD_ALLOWED && store.get(K.engine, 'hd') !== 'device' ? 'hd' : 'device',
    hdVoice: store.get(K.hd, 'shubh'), devVoice: store.get(K.dev, ''), rate: clampRate(store.get(K.rate, '1')),
    wait: store.get(K.wait, 'normal'),
    brain: store.get(K.brain, 'cloud'),   // 'cloud' (free services, this device as backup once allowed) | 'device' (always on this device)
    speakToken: 0, ttsAbort: null, hdResolve: null, hdBlockedUntil: 0, hdNoted: '', audioUrl: null,
    listening: false, listen: null, speaking: false, busy: false, phase: '', localPct: 0, localText: '', open: false, greeted: false
  };
  if (!HD_VOICES.some((v) => v[0] === S.hdVoice)) S.hdVoice = 'shubh';
  if (!WAITS[S.wait]) S.wait = 'normal';
  if (S.brain !== 'device') S.brain = 'cloud';
  let ui = null;

  /* ---------------------------------------------------------------- search: BM25 over the report's chunks */
  const STOP = new Set(('a an the of and or to in on for with by at from is are was were be been being it its this that these those as than then which who whom what why how did does do ' +
    'has have had not no into over under per about between during after before can could would should will i me my we our you your they their there here so if but also very more most').split(' '));
  const stem = (w) => (w.length > 4 ? w.replace(/(ations?|ments?|ing|ed|es|s)$/, '') : w);
  function tokens(text) {
    return (String(text).toLowerCase().match(/[a-z]+|\d[\d,]*\.?\d*/g) || [])
      .map((t) => (/^\d/.test(t) ? t.replace(/,/g, '').replace(/\.$/, '') : t))
      .filter((t) => t.length > 1 || /\d/.test(t))
      .filter((t) => !STOP.has(t)).map(stem);
  }
  function buildIndex(chunks) {
    const docs = chunks.map((c) => { const t = tokens(c.section + ' ' + c.text); const tf = new Map(); t.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)); return { tf, len: t.length || 1 }; });
    const df = new Map();
    docs.forEach((d) => d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
    return { docs, df, N: docs.length, avg: docs.reduce((a, d) => a + d.len, 0) / Math.max(docs.length, 1) };
  }

  // plain-English questions use different words than annual reports; widen the query a little
  const EXPAND = [
    [/cash[\s-]?flows?/i, 'cash flows operating activities'],
    [/\b(decreas\w*|declin\w*|fall\w*|fell|drop\w*|lower|reduc\w*|down)\b/i, 'decrease decreased decline lower reduction'],
    [/\b(increas\w*|rise|rose|risen|grow\w*|higher|jump\w*|up)\b/i, 'increase increased growth higher'],
    [/\b(revenue|sales|turnover|top[\s-]?line)\b/i, 'revenue sales turnover income from operations'],
    [/\b(profit|earnings|net income|pat|bottom[\s-]?line)\b/i, 'profit net income earnings'],
    [/\b(margin|ebitda)\b/i, 'margin ebitda operating profit'],
    [/\b(debt|borrow\w*|leverage|loans?)\b/i, 'borrowings debt loans liabilities'],
    [/\b(capex|capital expenditure|investments?)\b/i, 'capital expenditure purchase property plant equipment investing'],
    [/\b(dividends?|payout)\b/i, 'dividend paid per share'],
    [/\b(outlook|guidance|future|plans?|strategy|expect\w*)\b/i, 'outlook strategy opportunities expect future'],
    [/\b(risk\w*|threat\w*|concern\w*)\b/i, 'risk factors uncertainties adverse'],
    [/\b(employees?|headcount|workforce|people)\b/i, 'employees headcount workforce'],
    [/\b(tax|taxes)\b/i, 'tax income taxes paid'],
    [/\b(inventory|inventories|working capital|receivables?)\b/i, 'inventories receivables payables working capital'],
    // v9: more annual-report vocabulary (Indian reports especially), so search works well without the AI refining step
    [/\b(npa|bad loans?|asset quality|non[\s-]?performing|defaults?|provisions?)\b/i, 'non-performing assets gross npa net npa provisions provision coverage ratio asset quality'],
    [/\b(casa|deposits?|current account|savings account)\b/i, 'deposits casa current account savings account term deposits'],
    [/\b(nim|net interest|interest income|spread)\b/i, 'net interest income net interest margin interest earned interest expended'],
    [/\b(advances|loan book|lending|credit growth)\b/i, 'advances loans gross advances credit growth loan book'],
    [/\b(capital adequacy|crar|tier ?1|cet ?1)\b/i, 'capital adequacy ratio crar tier 1 cet1 capital'],
    [/\b(order ?book|orders|backlog|pipeline)\b/i, 'order book order inflow backlog remaining performance obligations'],
    [/\b(segments?|division|business units?|verticals?)\b/i, 'segment revenue segment results reportable segments'],
    [/\b(subsidiar\w*|acquisition|merger|demerger)\b/i, 'subsidiaries acquisition merger amalgamation scheme of arrangement'],
    [/\b(promoters?|shareholding|pledge\w*)\b/i, 'promoter shareholding pattern pledged shares'],
    [/\b(net ?worth|equity|book value|reserves)\b/i, 'net worth total equity reserves and surplus other equity'],
    [/\b(eps|earnings per share)\b/i, 'earnings per share basic diluted eps'],
    [/\b(roe|roce|return on)\b/i, 'return on equity return on capital employed roe roce'],
    [/\b(esg|sustainab\w*|carbon|emissions?|climate)\b/i, 'sustainability emissions carbon renewable energy brsr climate'],
    [/\b(ceo|md|chairman|management|leadership|board)\b/i, 'managing director chief executive officer chairman board of directors'],
    [/\b(salary|salaries|remuneration|pay|compensation)\b/i, 'remuneration managerial remuneration employee benefits expense'],
    [/\b(related[\s-]party|rpt)\b/i, 'related party transactions'],
    [/\b(auditor|audit|qualified|qualification)\b/i, 'auditor report opinion key audit matters qualification'],
    [/\b(how is|doing|performance|overall|health|summary|highlights?)\b/i, 'financial performance highlights revenue profit growth key indicators']
  ];
  const TAG_BOOST = [
    [/cash|liquidity/i, { cashflow: 1.6, mdna: 1.3 }],
    [/\b(why|reason|because|driver|cause|explain|due to|led to)\b/i, { mdna: 1.45, directors: 1.2, notes: 1.1 }],
    [/\brisk|threat|uncertaint/i, { risk: 1.7 }],
    [/\b(outlook|strategy|plan|future|business|segment|products?)\b/i, { business: 1.3, mdna: 1.3, directors: 1.2 }],
    [/\b(balance sheet|assets?|liabilit\w*|equity|debt|borrow\w*)\b/i, { balance: 1.5, notes: 1.2 }],
    [/\b(revenue|sales|profit|income|earnings|margin|expenses?)\b/i, { income: 1.4, mdna: 1.3 }]
  ];
  function fyHints(q) {
    const out = [];
    for (const m of q.matchAll(/\bfy\s?'?(\d{2,4})(?:\s?[-–/]\s?(\d{2,4}))?\b|\b(20\d{2})\s?[-–/]\s?(\d{2,4})\b/gi)) {
      const a = m[1] || m[3], b = m[2] || m[4];
      [a, b].forEach((x) => { if (!x) return; out.push(x.length === 2 ? '20' + x : x); });
    }
    return out;
  }
  // BM25 over every chunk for one query. base = the query's own words (weight 1), extra = report-language keywords from the
  // refining step (0.75), plus the built-in EXPAND synonyms (0.45). A chunk must contain at least one base or keyword term.
  function rank(q, extraWords, boostTags) {
    const idx = S.index, chunks = S.report.chunks;
    const base = tokens(q).concat(fyHints(q));
    const kw = tokens((extraWords || []).join(' '));
    if (!base.length && !kw.length) return [];
    const exp = [];
    EXPAND.forEach(([rx, add]) => { if (rx.test(q)) exp.push(...tokens(add)); });
    const weights = new Map();
    base.forEach((t) => weights.set(t, 1));
    kw.forEach((t) => weights.set(t, Math.max(weights.get(t) || 0, 0.75)));
    exp.forEach((t) => { if (!weights.has(t)) weights.set(t, 0.45); });
    const boost = {};
    TAG_BOOST.forEach(([rx, b]) => { if (rx.test(q)) Object.keys(b).forEach((k) => { boost[k] = Math.max(boost[k] || 1, b[k]); }); });
    (boostTags || []).forEach((t) => { boost[t] = Math.max(boost[t] || 1, 1.5); });
    const k1 = 1.4, bb = 0.75, hitSet = new Set(base.concat(kw));
    const scored = [];
    idx.docs.forEach((d, i) => {
      let s = 0, hits = 0;
      weights.forEach((wt, t) => {
        const tf = d.tf.get(t); if (!tf) return;
        const df = idx.df.get(t) || 0;
        const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
        s += wt * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - bb + bb * d.len / idx.avg)));
        if (hitSet.has(t)) hits++;
      });
      if (hits) scored.push({ i, s: s * (boost[chunks[i].tag] || 1) * (1 + 0.08 * Math.min(hits, 6)) });
    });
    return scored.sort((a, b) => b.s - a.s);
  }
  // refined (optional): { question, keywords, sections, aspects } from the Worker's /refine
  function retrieve(question, prevQuestion, refined) {
    const chunks = S.report.chunks;
    let q = question;
    // without the refining step, a follow-up ("and why?", "what about debt?") borrows the topic of the previous question
    if (!refined && prevQuestion && (tokens(question).length < 2 || /^(and|also|what about|how about|but)\b|\b(it|that|this|they|those|them)\b/i.test(question))) q = prevQuestion + ' ' + question;
    const kw = refined ? refined.keywords : [], tags = refined ? refined.sections : [];
    const main = rank(q, kw, tags);
    // one extra search per sub-question, so a detailed answer has material for each angle (figures, reasons, outlook …)
    const sides = (refined && refined.aspects || []).map((a) => rank(a, kw.slice(0, 6), tags).slice(0, 4));
    const picked = [], seen = new Set(), perTag = {};
    const take = (x) => {
      if (!x || seen.has(x.i)) return false;
      const tag = chunks[x.i].tag;
      if ((perTag[tag] || 0) >= 4) return false;
      seen.add(x.i); perTag[tag] = (perTag[tag] || 0) + 1; picked.push(x); return true;
    };
    let mi = 0;
    for (; mi < main.length && picked.length < (sides.length ? 5 : N_EXCERPTS); mi++) take(main[mi]);
    for (let r = 0; r < 4 && picked.length < N_EXCERPTS; r++) sides.forEach((list) => { if (picked.length < N_EXCERPTS) take(list[r]); });
    for (; mi < main.length && picked.length < N_EXCERPTS; mi++) take(main[mi]);
    return picked.map((x) => { const c = chunks[x.i]; return { id: c.id, section: c.section, tag: c.tag, page: c.page, text: c.text.slice(0, 1500) }; });
  }

  /* spoken questions: drop filler words and fix a few terms speech recognition often splits up (the Worker's /refine does the rest) */
  function tidyQuestion(q) {
    return String(q).replace(/\b(?:u+m+|u+h+|e+r+m*|h+m+|a+h+)\b[,.]?\s*/gi, ' ')
      .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')                     // "the the" → "the"
      .replace(/\bcap\s+ex\b/gi, 'capex').replace(/\be\s?bit\s?d\s?a\b/gi, 'EBITDA').replace(/\be\s?bit\b/gi, 'EBIT')
      .replace(/\bf\.?\s?y\.?\s?'?(\d{2,4})\b/gi, 'FY$1').replace(/\br\s?o\s?c\s?e\b/gi, 'ROCE').replace(/\br\s?o\s?e\b/gi, 'ROE')
      .replace(/\be\s?p\s?s\b/gi, 'EPS').replace(/\bn\s?p\s?a\b/gi, 'NPA')
      .replace(/\s+/g, ' ').replace(/^[\s,.]+/, '').trim();
  }
  async function refineQuestion(question, signal) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    const onAbort = () => ctrl.abort(); if (signal) signal.addEventListener('abort', onAbort);
    try {
      const res = await fetch(WORKER + '/refine', {
        method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: S.sym, company: S.report && S.report.company, question, history: S.history.slice(-2) })
      });
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || typeof j.question !== 'string' || !j.question.trim()) return null;
      const arr = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()) : []);
      return { question: j.question.trim().slice(0, 400), keywords: arr(j.keywords).slice(0, 14), sections: arr(j.sections).slice(0, 3), aspects: arr(j.aspects).slice(0, 4) };
    } catch (e) { return null; } // offline, old Worker without /refine, timeout: carry on with the question as asked
    finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
  }
  const sameMeaning = (a, b) => { const n = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return n(a) === n(b); };

  /* "Why did cash flow fall in FY26?" when the newest report we hold is FY25 -> say so instead of guessing */
  function requestedYearEnd(q) {
    let m = q.match(/\bfy\s?'?(\d{2,4})(?:\s?[-–/]\s?(\d{2,4}))?\b/i);
    let a, b;
    if (m) { a = m[1]; b = m[2]; } else if ((m = q.match(/\b(20\d{2})\s?[-–/]\s?(\d{2,4})\b/))) { a = m[1]; b = m[2]; }
    else if ((m = q.match(/\bfiscal\s+(?:year\s+)?'?(\d{2,4})\b/i))) { a = m[1]; }
    if (!a) return null;
    const full = (x) => { x = String(x); return x.length === 2 ? 2000 + Number(x) : Number(x); };
    return full(b || a);
  }
  function periodMismatch(q) {
    const rep = S.report.report || {};
    const want = requestedYearEnd(q);
    if (!want || !rep.fy_end_year) return null;
    if (want <= rep.fy_end_year && want >= rep.fy_end_year - 1) return null; // a report also shows the previous year
    const covers = rep.period_label ? `the ${rep.period_label}` : `fiscal ${rep.fy_end_year}`;
    return `The latest annual report I have for ${S.report.company || S.sym} covers ${covers}, so I can't explain ${want > rep.fy_end_year ? 'a later period' : 'an older period'} like FY${String(want).slice(2)} from it. ` +
      `Ask me about fiscal ${rep.fy_end_year}, or how it compares with the year before.`;
  }

  /* ---------------------------------------------------------------- report loading / preparation */
  async function fetchReport(sym) {
    let res;
    try { res = await fetch(`${REPORTS}${encodeURIComponent(safeName(sym))}.json?t=${Date.now()}`, { cache: 'no-store' }); }
    catch (e) { return { state: 'error' }; }
    if (res.status === 404) return { state: 'missing' };
    if (!res.ok) return { state: 'error' };
    let j; try { j = await res.json(); } catch (e) { return { state: 'missing' }; } // an HTML 404 page served with 200
    if (j && j.status === 'ready' && Array.isArray(j.chunks) && j.chunks.length) return { state: 'ready', data: j };
    if (j && j.status === 'failed') return { state: 'failed', data: j };
    return { state: 'missing' };
  }
  async function requestPrepare(sym, force) {
    try {
      const res = await fetch(WORKER + '/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym, force: !!force }) });
      if (res.ok) return { ok: true };
      let err = ''; try { err = (await res.json()).error; } catch (e) { /* ignore */ }
      return { ok: false, error: err || String(res.status) };
    } catch (e) { return { ok: false, error: 'network' }; }
  }
  function stopPolling() { if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; } }

  async function ensureReport(force) {
    const sym = S.sym; if (!sym) return;
    const token = ++S.loadToken; stopPolling();
    setStatus('checking');
    const r = await fetchReport(sym);
    if (token !== S.loadToken) return;
    if (r.state === 'ready') return adopt(r.data);
    if (r.state === 'error') return setStatus('error');
    if (r.state === 'failed' && !force) return setStatus('failed', r.data);
    // missing (or a retry after a failure): ask the Worker to start the GitHub Actions job, then wait for the file
    const since = Date.now();
    const p = await requestPrepare(sym, force || r.state === 'failed');
    if (token !== S.loadToken) return;
    if (!p.ok) {
      if (p.error === 'not_configured') return setStatus('unconfigured');
      if (p.error === 'rate_limited' || p.error === 'busy') return setStatus('busy');
      return setStatus('error');
    }
    setStatus('preparing', { since });
    const tick = async () => {
      if (token !== S.loadToken) return;
      if (Date.now() - since > POLL_MAX_MS) return setStatus('slow');
      const x = await fetchReport(sym);
      if (token !== S.loadToken) return;
      if (x.state === 'ready') return adopt(x.data);
      if (x.state === 'failed' && Date.parse(x.data.prepared_at || 0) > since - 120000) return setStatus('failed', x.data);
      setStatus('preparing', { since });
      S.pollTimer = setTimeout(tick, POLL_MS);
    };
    S.pollTimer = setTimeout(tick, Math.min(POLL_MS, 8000));
  }
  function adopt(data) {
    S.report = data; S.index = buildIndex(data.chunks);
    setStatus('ready');
    if (!S.greeted) {
      S.greeted = true;
      addBotNote(`Namaste, I'm Plutus. Ask me anything about ${data.company || S.sym}'s annual report — tap the mic and take your time (I'll wait until you pause), or type. I answer only from the report and show you where each point comes from.`);
      if (!SR) addBotNote('Voice input isn’t available in this browser (try Chrome, Edge or Safari). You can still type, and I can read answers aloud.');
    }
    renderChips();
  }

  /* ---------------------------------------------------------------- asking */
  async function ask(question) {
    question = String(question || '').replace(/\s+/g, ' ').trim(); if (!question || S.busy) return;
    unlockAudio(); stopSpeaking(); abortListening();
    const userMsg = addUser(question);
    if (!S.report) { addBotNote('The annual report isn’t ready yet — one moment.'); return; }
    S.busy = true; S.phase = 'understanding'; ui.send.disabled = true; setOrb();
    const typing = addTyping();
    const rep = S.report.report || {};
    const ctrl = new AbortController(); S.askAbort = ctrl;
    const symAtStart = S.sym;
    const stale = () => symAtStart !== S.sym || ctrl.signal.aborted;
    let job = null;
    try {
      // 1. understand: tidy the words (and, only if switched on, let the Worker rewrite the question — that costs tokens)
      const tidy = tidyQuestion(question) || question;
      const refined = USE_REFINE && S.brain !== 'device' ? await refineQuestion(tidy, ctrl.signal) : null;
      if (stale()) return;
      const q2 = refined ? refined.question : tidy;
      if (refined && !sameMeaning(q2, question)) addUnderstood(userMsg, q2);
      const mismatch = periodMismatch(question) || periodMismatch(q2);
      if (mismatch) { typing.remove(); addBotSimple(mismatch); return; }
      // 2. search the report
      S.phase = 'searching'; setOrb();
      const followUp = FOLLOW_UP.test(question) || tokens(question).length < 2;
      const prevQ = followUp && S.history.length ? S.history[S.history.length - 1].q : '';
      const excerpts = retrieve(q2, prevQ, refined);
      if (!excerpts.length) { typing.remove(); addBotSimple('I couldn’t find anything about that in the annual report. Try asking about revenue, profit, cash flow, debt, risks or the outlook.'); return; }
      job = { question, q2, excerpts, userMsg, refined, history: followUp ? S.history.slice(-2) : [] };
      if (S.brain === 'device' && LOCAL_AI) { typing.remove(); await answerLocally(job, stale); return; }
      // 3. write the answer (history only for follow-ups: a stand-alone question can then be served from the Worker's cache)
      S.phase = 'writing'; setOrb();
      const res = await fetch(WORKER + '/ask', {
        method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: S.sym, question, refined: { question: q2, aspects: refined ? refined.aspects : [] }, history: job.history,
          excerpts: excerpts.map((e) => ({ id: e.id, section: e.section, page: e.page, text: e.text })),
          meta: { company: S.report.company, report: { form: rep.form, period_label: rep.period_label, filed: rep.filed, source: rep.source } } })
      });
      typing.remove();
      if (stale()) return;
      let j = null; try { j = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok || !j) {
        // the free cloud services are all used up (or not set up): answer on this device instead
        if (LOCAL_AI && (res.status === 503 || res.status >= 500)) { await localFallback(job, stale, errorText(res.status, j && j.error)); return; }
        addBotSimple(errorText(res.status, j && j.error)); return;
      }
      if (!refined && j.understood && !sameMeaning(j.understood, question)) addUnderstood(userMsg, j.understood);
      finishAnswer(j, excerpts, q2);
    } catch (e) {
      typing.remove();
      if (e.name === 'AbortError' || stale()) return;
      if (LOCAL_AI && job) { await localFallback(job, stale, 'I couldn’t reach the Plutus service.'); return; }
      addBotSimple('I couldn’t reach the Plutus service. Check your connection and try again.');
    } finally {
      typing.remove();
      if (S.askAbort === ctrl) { S.busy = false; S.phase = ''; S.askAbort = null; if (ui) ui.send.disabled = false; setOrb(); }
    }
  }
  function finishAnswer(j, excerpts, q) {
    renderAnswer(j, excerpts);
    S.history.push({ q, a: String(j.spoken || '').slice(0, 400) });
    if (S.history.length > 6) S.history.shift();
    if (j.spoken) speak(j.spoken);
  }
  function errorText(status, code) {
    if (status === 429) return 'You’re asking quickly — give me a minute and try again.';
    if (code === 'not_configured') return 'Voice answers aren’t switched on for this site yet (the Worker has no AI key).';
    if (status === 503) return 'The free AI services are busy or out of quota right now. Please try again in a little while.';
    return 'Something went wrong while answering. Please try again.';
  }

  /* ---------------------------------------------------------------- on-device AI (v9)
     When every free cloud service is used up, the answer can be written by an AI running on the visitor's own device:
       • Chrome's built-in AI (Gemini Nano, "Prompt API") when the browser offers it, or
       • WebLLM (open-source, runs on the graphics chip through WebGPU) with a small Qwen model — a one-time download
         that the browser keeps, then free and unlimited, and works offline.
     It never downloads anything without the visitor's OK (or their choice of "This device" in ⚙). Small on-device models
     are less thorough than the cloud ones, so they get fewer passages and the answer is labelled "on this device". */
  const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
  const LOCAL_OK = 'plutus.voice.localok.v1';
  const LOCAL_SYSTEM = `You are Plutus. You explain ONE company's annual report to an everyday investor in clear, simple English.
Rules:
- Use ONLY facts from the numbered excerpts. Never invent numbers, reasons or facts.
- Copy numbers exactly as written, with their units and currency. Do not calculate anything.
- Keep what management says separate from plain figures.
- Never give buy, sell or hold advice.
- If the excerpts don't answer the question, say exactly: "The annual report excerpts I searched don't explain this."
Reply in exactly this format and nothing else:
SPOKEN: <3 to 5 natural sentences that answer the question first, then the key figures and reasons. No lists, no tags.>
DETAILED:
### <short heading>
- <point> [S1]
- <point> [S2]
### <short heading>
- <point> [S3]
(5 to 8 points in total. End each point with the number of the excerpt it comes from, like [S2].)`;
  const Local = (function () {
    let engine = null, loading = null;
    const LM_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    const modelId = () => ((navigator.deviceMemory || 4) >= 8 && !mobile ? 'Qwen3.5-4B-q4f16_1-MLC' : 'Qwen3.5-2B-q4f16_1-MLC');
    const sizeText = () => (modelId().includes('4B') ? 'about 2.5 GB' : 'about 1 GB');
    async function chromeState() { try { return 'LanguageModel' in self ? await self.LanguageModel.availability(LM_OPTS) : 'no'; } catch (e) { return 'no'; } }
    async function webgpu() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } }
    let lib = null; const getLib = async () => (lib = lib || await import(WEBLLM_URL));
    // 'ready' = works now without a download · 'download' = needs a one-time download · 'none' = this device can't
    async function check() {
      if (engine) return 'ready';
      const c = await chromeState();
      if (c === 'available') return 'ready';
      if (await webgpu()) { try { if (await (await getLib()).hasModelInCache(modelId())) return 'ready'; } catch (e) { /* not cached / offline */ } return 'download'; }
      return c === 'downloadable' || c === 'downloading' ? 'download' : 'none';
    }
    async function load(onProgress) {
      if (engine) return engine;
      if (!loading) loading = (async () => {
        const c = await chromeState();
        if (c === 'available' || ((c === 'downloadable' || c === 'downloading') && !(await webgpu()))) {
          const s = await self.LanguageModel.create({ ...LM_OPTS, monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress(e.loaded, 'Chrome’s built-in AI')); } });
          try { s.destroy(); } catch (e) { /* ignore */ }
          return (engine = { kind: 'chrome' });
        }
        const m = await getLib();
        const e = await m.CreateMLCEngine(modelId(), { initProgressCallback: (r) => onProgress(r.progress, r.text) });
        return (engine = { kind: 'webllm', e });
      })().finally(() => { loading = null; });
      return loading;
    }
    async function generate(system, user) {
      if (engine.kind === 'chrome') {
        const s = await self.LanguageModel.create({ ...LM_OPTS, initialPrompts: [{ role: 'system', content: system }] });
        try { return await s.prompt(user); } finally { try { s.destroy(); } catch (e) { /* ignore */ } }
      }
      const r = await engine.e.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 900, extra_body: { enable_thinking: false } });
      return (((r.choices || [])[0] || {}).message || {}).content || '';
    }
    return { check, load, generate, sizeText, get kind() { return engine ? engine.kind : ''; } };
  })();

  // the same checks the Worker applies to cloud answers: valid [S#] citations, and every number must appear in the passages
  const numTokens = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => String(Number(x.replace(/,/g, '').replace(/\.$/, ''))));
  function parseAnswer(text, ex, allowedText) {
    text = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const m = text.match(/SPOKEN:\s*([\s\S]*?)\s*DETAILED:\s*([\s\S]*)$/i);
    let spoken = m ? m[1].trim() : text.replace(/^SPOKEN:\s*/i, ''), detailed = m ? m[2].trim() : '';
    const strip = (s) => s.replace(/\[S(\d+)\]/g, (all, n) => (+n >= 1 && +n <= ex.length ? all : '')).replace(/\*\*/g, '');
    spoken = strip(spoken).replace(/\[S\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
    detailed = strip(detailed);
    const cites = [...new Set((detailed.match(/\[S(\d+)\]/g) || []).map((x) => +x.slice(2, -1)))].sort((a, b) => a - b);
    const allowed = new Set(numTokens(allowedText)), seen = new Set(), unverified = [];
    (String(spoken + ' ' + detailed).replace(/\[S\d+\]/g, ' ').match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach((raw) => {
      const n = String(Number(raw.replace(/,/g, '').replace(/\.$/, ''))), v = Number(n);
      if (seen.has(n) || !Number.isFinite(v)) return; seen.add(n);
      if ((Number.isInteger(v) && v < 10) || (Number.isInteger(v) && v >= 1990 && v <= 2100)) return;
      if (!allowed.has(n)) unverified.push(raw);
    });
    return { spoken, detailed, cites, unverified, answered: !/don['’]?t explain this/i.test(spoken) };
  }

  async function answerLocally(job, stale) {
    S.busy = true; S.phase = 'local-load'; S.localPct = 0; ui.send.disabled = true; setOrb();
    const typing = addTyping();
    try {
      await Local.load((p, t) => { S.localPct = Math.round((Number(p) || 0) * 100); S.localText = t || ''; setOrb(); });
      if (stale && stale()) return;
      S.phase = 'local'; setOrb();
      // small on-device models have a short memory (≈4,000 tokens): fewer, shorter passages
      const ex = job.excerpts.slice(0, 6).map((e) => ({ ...e, text: e.text.slice(0, 650) }));
      const rep = S.report.report || {};
      const hist = job.history.map((h) => `Earlier question: ${h.q}`).join('\n');
      const user = `Company: ${S.report.company || S.sym}\nReport: ${rep.form || 'Annual report'}${rep.period_label ? ', ' + rep.period_label : ''}\n${hist ? hist + '\n' : ''}` +
        `Question: ${job.q2}\n\nExcerpts:\n` + ex.map((e, i) => `[S${i + 1}] ${e.section}${e.page ? ' · page ' + e.page : ''}\n${e.text}`).join('\n\n');
      const text = await Local.generate(LOCAL_SYSTEM, user);
      if (stale && stale()) return;
      typing.remove();
      const j = parseAnswer(text, ex, ex.map((e) => e.text).join(' ') + ' ' + job.question + ' ' + JSON.stringify(rep));
      j.local = true;
      finishAnswer(j, ex, job.q2);
    } catch (e) {
      typing.remove();
      addBotSimple('I couldn’t run the AI on this device (it needs a recent Chrome, Edge or Safari with enough memory). The free cloud allowance resets every day — please try again later.');
    } finally {
      typing.remove();
      S.busy = false; S.phase = ''; if (ui) ui.send.disabled = false; setOrb();
    }
  }
  // the cloud said no: use this device straight away if that needs no download or the visitor already agreed; otherwise ask once
  async function localFallback(job, stale, cloudMsg) {
    const state = await Local.check();
    if (stale && stale()) return;
    if (state === 'none') { addBotSimple(cloudMsg); return; }
    if (state === 'ready' || store.get(LOCAL_OK, '') === '1') { await answerLocally(job, stale); return; }
    const m = h('div', 'pv-msg bot pv-offer');
    m.appendChild(h('p', 'pv-spoken', 'Today’s free cloud AI allowance is used up. I can answer on this device instead — free, unlimited, and it works offline afterwards.'));
    m.appendChild(h('p', 'pv-offer-sub', `The first time needs a one-time download of ${Local.sizeText()}, which your browser keeps. Best on Wi-Fi.`));
    const row = h('div', 'pv-offer-act');
    const yes = h('button', 'pv-btn', 'Use this device'); yes.type = 'button';
    const no = h('button', 'pv-btn ghost', 'Not now'); no.type = 'button';
    yes.addEventListener('click', () => { if (S.busy) return; store.set(LOCAL_OK, '1'); m.remove(); answerLocally(job); });
    no.addEventListener('click', () => { m.remove(); addBotNote('No problem. The free cloud allowance resets daily — ask me again later.'); });
    row.appendChild(yes); row.appendChild(no); m.appendChild(row);
    ui.log.appendChild(m); scrollLog();
    speak('Today’s free cloud allowance is used up. I can answer on this device instead. Tap “Use this device” to continue.');
  }

  /* ---------------------------------------------------------------- speech out
     Two engines: "hd" (Worker /speak → natural audio, played in one <audio> element) and "device" (browser speech).
     If HD fails (not switched on, daily allowance used, network hiccup, autoplay blocked) the answer is read with the
     device voice instead, and HD is paused for a while so we don't keep asking. */
  let voicesCache = [], audioEl = null, audioUnlocked = false;
  function loadVoices() { try { voicesCache = window.speechSynthesis.getVoices() || []; } catch (e) { voicesCache = []; } }
  function recLang() { return LANG; }
  // device voices: Indian English first (Edge "Neerja / Prabhat Natural", Apple "Rishi / Isha / Veena", Android en-IN …),
  // and within that the most natural-sounding ones (Natural / Neural / Online, then Premium / Enhanced, then Google …)
  const isIndian = (v) => /en[-_]in\b/i.test(v.lang) || /\b(india|indian)\b/i.test(v.name);
  const quality = (v) => (/natural|neural|online/i.test(v.name) ? 0 : /premium|enhanced|siri/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : v.localService === false ? 3 : 4);
  const rankVoice = (v) => (isIndian(v) ? 0 : 10) + quality(v);
  function englishVoices() { return voicesCache.filter((v) => /^en/i.test(v.lang)).sort((a, b) => rankVoice(a) - rankVoice(b) || a.name.localeCompare(b.name)); }
  function pickVoice() {
    if (S.devVoice) { const saved = voicesCache.find((v) => v.voiceURI === S.devVoice || v.name === S.devVoice); if (saved) return saved; }
    return englishVoices()[0] || null;
  }
  // what is read aloud: no citation tags / markdown, and money, years and abbreviations said the way an Indian listener expects
  function speechText(t) {
    return String(t).replace(/\[S\d+\]/g, '').replace(/[*_`#]/g, '')
      .replace(/₹\s?/g, 'rupees ').replace(/\b(?:Rs\.?|INR)\s?(?=\d)/g, 'rupees ')
      .replace(/(\d)\s?(?:Cr|cr)\b\.?/g, '$1 crore').replace(/(\d)\s?(?:bn)\b/gi, '$1 billion').replace(/(\d)\s?(?:mn)\b/gi, '$1 million')
      .replace(/\bFY\s?'?(\d{2,4})\b/g, 'F Y $1').replace(/\bYoY\b/gi, 'year on year').replace(/\bQoQ\b/gi, 'quarter on quarter')
      .replace(/(\d)\s?%/g, '$1 percent').replace(/\bbps\b/gi, 'basis points').replace(/\s*&\s*/g, ' and ')
      .replace(/\s+/g, ' ').trim();
  }
  // split at sentence ends (a full stop followed by a space, so "1,234.5" stays whole), then group sentences up to max characters
  function sentences(t, max) {
    const parts = String(t).replace(/([.!?;])\s+/g, '$1\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);
    const out = []; let cur = '';
    parts.forEach((p) => {
      if (cur && (cur + ' ' + p).length > max) { out.push(cur); cur = ''; }
      if (p.length > max) { p.split(/,\s+/).forEach((q) => { if (cur && (cur + ', ' + q).length > max) { out.push(cur); cur = ''; } cur = cur ? cur + ', ' + q : q; }); }
      else cur = cur ? cur + ' ' + p : p;
    });
    if (cur) out.push(cur);
    return out;
  }
  function silentWav() {
    const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function getAudio() { if (!audioEl && window.Audio) { audioEl = new Audio(); audioEl.preload = 'auto'; } return audioEl; }
  // Phones only let audio start from a tap. The first tap "unlocks" this audio element with a silent clip, so the
  // answer (which arrives a moment later) can then be played without another tap.
  function unlockAudio() {
    if (audioUnlocked || S.engine !== 'hd') return;
    const a = getAudio(); if (!a) return;
    try {
      a.src = silentWav(); audioUnlocked = true;
      const p = a.play(); if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotAllowedError') audioUnlocked = false; });
    } catch (e) { audioUnlocked = false; }
  }
  const hdReady = () => S.engine === 'hd' && HD_ALLOWED && !!window.Audio && Date.now() >= S.hdBlockedUntil;

  async function fetchHD(text, signal) {
    const res = await fetch(WORKER + '/speak', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, speaker: S.hdVoice }) });
    if (!res.ok) { let code = ''; try { code = (await res.json()).error; } catch (e) { /* ignore */ } throw errX(code || 'http', res.status); }
    if (!/^audio\//i.test(res.headers.get('Content-Type') || 'audio/')) throw errX('not_audio'); // e.g. an older Worker without /speak
    const blob = await res.blob();
    if (!blob.size) throw errX('empty');
    return blob;
  }
  function playBlob(blob, token) {
    const a = getAudio();
    if (S.audioUrl) { try { URL.revokeObjectURL(S.audioUrl); } catch (e) { /* ignore */ } }
    S.audioUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      S.hdResolve = resolve;
      a.onended = () => { S.hdResolve = null; resolve(); };
      a.onerror = () => { S.hdResolve = null; reject(errX('decode')); };
      a.defaultPlaybackRate = S.rate; a.src = S.audioUrl; a.playbackRate = S.rate;
      const p = a.play();
      if (p && p.catch) p.catch((e) => { if (token !== S.speakToken) return; S.hdResolve = null; reject(errX(e && e.name === 'NotAllowedError' ? 'autoplay' : 'play')); });
    });
  }
  // The whole answer is read: it is split into groups of sentences; the next group is fetched while the current one plays.
  // If the HD voice fails part-way, the error carries the text not yet spoken (e.rest) so the device voice can finish it.
  async function speakHD(text, token) {
    const parts = sentences(text, 420);
    const ctrl = new AbortController(); S.ttsAbort = ctrl;
    const load = (i) => { const p = fetchHD(parts[i], ctrl.signal); p.catch(() => {}); return p; };
    let next = load(0);
    for (let i = 0; i < parts.length; i++) {
      let blob;
      try { blob = await next; } catch (e) { e.rest = parts.slice(i).join(' '); throw e; }
      if (token !== S.speakToken) return;
      next = i + 1 < parts.length ? load(i + 1) : null;
      try { await playBlob(blob, token); } catch (e) { e.rest = parts.slice(i).join(' '); throw e; }
      if (token !== S.speakToken) return;
    }
  }
  function noteHdFailure(e) {
    const code = (e && e.code) || '', st = (e && e.status) || 0;
    let why;
    if (code === 'not_configured' || code === 'not_audio') { S.hdBlockedUntil = Infinity; why = 'off'; }
    else if (code === 'tts_budget' || st === 429 && code !== 'rate_limited') { S.hdBlockedUntil = Date.now() + 30 * 60e3; why = 'limit'; }
    else if (code === 'rate_limited') { S.hdBlockedUntil = Date.now() + 60e3; why = 'busy'; }
    else if (code === 'autoplay') { S.hdBlockedUntil = Date.now() + 20e3; why = 'autoplay'; }
    else { S.hdBlockedUntil = Date.now() + 2 * 60e3; why = 'error'; }
    if (S.hdNoted !== why && ui) {
      S.hdNoted = why;
      addBotNote({ off: 'The natural Indian HD voice isn’t switched on for this site yet, so I’m using your device’s voice.',
        limit: 'The free natural-voice allowance for today is used up, so I’m using your device’s voice for now.',
        busy: 'The natural voice is busy for a moment, so I’m using your device’s voice.',
        autoplay: 'Your browser blocked automatic audio — tap Listen under an answer to hear it.',
        error: 'The natural voice isn’t available right now, so I’m using your device’s voice.' }[why]);
    }
    if (ui && !ui.set.classList.contains('hidden')) renderSettings();
  }
  function speakDevice(text, token, done) {
    const chunks = sentences(text, 170); if (!chunks.length) { done(); return; }
    const lang = recLang(); const voice = pickVoice();
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = voice ? voice.lang : lang; if (voice) u.voice = voice; u.rate = S.rate;
      const end = () => { if (i === chunks.length - 1 && token === S.speakToken) done(); };
      u.onend = end; u.onerror = end; u.onboundary = () => Orb.pulse(0.9);
      window.speechSynthesis.speak(u);
    });
  }
  function speak(text, force) {
    if (!force && !S.speakOn) return;
    unlockAudio();
    stopSpeaking();
    const clean = speechText(text); if (!clean) return;
    const token = ++S.speakToken;
    S.speaking = true; setOrb(); ui.stop.classList.remove('hidden');
    const finish = () => { if (token !== S.speakToken) return; S.speaking = false; ui.stop.classList.add('hidden'); setOrb(); };
    const device = (t) => { if (TTS) speakDevice(t || clean, token, finish); else finish(); };
    if (hdReady()) {
      speakHD(clean, token).then(finish, (e) => { if (token !== S.speakToken) return; noteHdFailure(e); device(e && e.rest); });
    } else device();
  }
  function stopSpeaking() {
    S.speakToken++;
    if (S.ttsAbort) { try { S.ttsAbort.abort(); } catch (e) { /* ignore */ } S.ttsAbort = null; }
    if (audioEl) { audioEl.onended = null; audioEl.onerror = null; try { audioEl.pause(); } catch (e) { /* ignore */ } }
    if (S.hdResolve) { const r = S.hdResolve; S.hdResolve = null; r(); }
    if (TTS) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    S.speaking = false; if (ui) { ui.stop.classList.add('hidden'); setOrb(); }
  }

  /* ---------------------------------------------------------------- speech in */
  /* Patient listening (v8). The old version used one-shot recognition, which the browser ends after well under a second of
     silence, so a thinking pause cut the question off. Now:
       • recognition runs in continuous mode, and if the browser still ends it by itself (Safari, Android, network blips)
         it is quietly restarted, keeping everything heard so far;
       • a silence timer decides when the question is finished: it restarts on every word, and fires only after a real
         pause (Short 1.5 s / Normal 2.6 s / Long 4.2 s — ⚙ settings). Before the first word Plutus waits 9 s;
       • tapping the mic or the orb again sends at once.  The transcript builds up live in the text box. */
  const joinText = (a, b) => { a = (a || '').trim(); b = (b || '').trim(); return a && b ? a + ' ' + b : a || b; };
  function mergeFinal(acc, t) {
    t = (t || '').trim(); if (!t) return acc; if (!acc) return t;
    const A = acc.toLowerCase(), T = t.toLowerCase();
    if (T.startsWith(A)) return t;    // Android Chrome repeats the whole utterance so far in each new result
    if (A.endsWith(T)) return acc;    // exact repeat
    return acc + ' ' + t;
  }
  const MIC_ERRORS = {
    'not-allowed': 'The microphone is blocked. Allow it in your browser’s site settings, or type your question.',
    'service-not-allowed': 'The microphone is blocked. Allow it in your browser’s site settings, or type your question.',
    'network': 'Voice recognition needs an internet connection. You can type instead.',
    'audio-capture': 'I couldn’t find a microphone.',
    'language-not-supported': 'Voice recognition for Indian English isn’t available in this browser. You can type instead.'
  };
  function setMicUi(on) {
    ui.mic.classList.toggle('on', on); ui.mic.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.mic.title = on ? 'Done — send my question now' : 'Ask by voice'; ui.mic.setAttribute('aria-label', ui.mic.title);
    ui.input.placeholder = on ? 'Listening… take your time' : ui.placeholder;
  }
  function startListening() {
    unlockAudio();
    stopSpeaking(); // tapping the mic interrupts Plutus
    if (!SR) { addBotNote('Voice input isn’t available in this browser (try Chrome, Edge or Safari). Type your question instead.'); ui.input.focus(); return; }
    if (S.listening) { finishListening(true); return; } // second tap = "I'm done, send it"
    if (!S.report || S.busy) { if (!S.report) addBotNote('The annual report isn’t ready yet — one moment.'); return; }
    const L = { committed: '', cur: '', heard: false, started: Date.now(), timer: 0, rec: null, done: false, fatal: false, errNote: '', quickEnds: 0, recStarted: 0 };
    S.listen = L; S.listening = true;
    ui.input.value = ''; setMicUi(true); setOrb();
    armSilence(L);
    openRec(L);
  }
  function openRec(L) {
    let rec;
    try { rec = new SR(); } catch (e) { L.errNote = 'I couldn’t start the microphone.'; L.fatal = true; endListen(L); return; }
    L.rec = rec; L.recStarted = Date.now();
    rec.lang = recLang(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onsoundstart = () => Orb.pulse(0.5);
    rec.onspeechstart = () => { Orb.pulse(0.85); armSilence(L); };
    rec.onresult = (e) => {
      if (L.done || S.listen !== L) return;
      let fin = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i], t = r && r[0] ? r[0].transcript : '';
        if (r.isFinal) fin = mergeFinal(fin, t); else interim = joinText(interim, t);
      }
      L.cur = joinText(fin, interim);
      const text = joinText(L.committed, L.cur);
      if (text) {
        Orb.pulse(0.6 + Math.random() * 0.35); // words are arriving: the orb surges
        ui.input.value = text;
        if (!L.heard) { L.heard = true; setOrb(); }
      }
      armSilence(L);
    };
    rec.onerror = (e) => {
      if (S.listen !== L) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return; // the silence timer decides when to stop
      L.errNote = MIC_ERRORS[e.error] || ''; L.fatal = true;
    };
    rec.onend = () => {
      if (S.listen !== L || L.done) return;
      L.committed = joinText(L.committed, L.cur); L.cur = '';
      if (L.fatal) { endListen(L); return; }
      // the browser stopped by itself: listen again (but don't spin if it keeps ending instantly)
      L.quickEnds = Date.now() - L.recStarted < 600 ? L.quickEnds + 1 : 0;
      if (L.quickEnds >= 3 || Date.now() - L.started > LISTEN_MAX_MS) { finishListening(true); return; }
      openRec(L);
    };
    try { rec.start(); } catch (e) { L.errNote = 'I couldn’t start the microphone.'; L.fatal = true; endListen(L); }
  }
  function endListen(L) { // a microphone problem: send what was heard (if anything) and explain
    const note = L.errNote;
    finishListening(L.heard);
    if (note) addBotNote(note);
  }
  function armSilence(L) {
    clearTimeout(L.timer);
    L.timer = setTimeout(() => {
      if (S.listen !== L || L.done) return;
      if (!L.heard && !joinText(L.committed, L.cur)) { finishListening(false); addBotNote('I didn’t hear anything — tap the mic and try again.'); return; }
      finishListening(true);
    }, L.heard ? WAITS[S.wait] : FIRST_WORD_MS);
  }
  // send = true: the question is complete, ask it. send = false: stop and leave any words in the box to edit.
  function finishListening(send) {
    const L = S.listen; if (!L) return;
    L.done = true; clearTimeout(L.timer); S.listen = null; S.listening = false;
    if (L.rec) { const r = L.rec; r.onresult = r.onend = r.onerror = r.onspeechstart = r.onsoundstart = null; try { r.abort(); } catch (e) { /* ignore */ } }
    const text = joinText(L.committed, L.cur);
    if (ui) { setMicUi(false); setOrb(); }
    if (send && text) { ui.input.value = ''; ask(text); }
  }
  function stopListening() { finishListening(true); }
  function abortListening() { finishListening(false); }

  /* ---------------------------------------------------------------- the orb (canvas animation)
     "Neural Dust" from the approved design preview: a living point cloud that breathes while idle,
     emits listening ripples, gathers tightly while thinking and disperses in speech-like waves while speaking.
     The renderer reads --accent, --accent-2 and --hi from css/style.css, so a theme switch changes the live
     canvas without a reload. It draws only while the panel is open and the tab is visible; reduced-motion users
     receive a still frame. The existing state controller and microphone pulse hooks remain unchanged. */
  const Orb = (function () {
    const TAU = Math.PI * 2;
    const MOODS = ['idle', 'listening', 'thinking', 'speaking'];
    const SPEED = { idle: 0.22, listening: 0.62, thinking: 1.85, speaking: 0.82 };
    const w = { idle: 1, listening: 0, thinking: 0, speaking: 0 };
    const dustSeeds = Array.from({ length: 120 }, (_, i) => ({
      a: (i * 2.399963 + Math.sin(i) * 0.12) % TAU,
      z: 1 - 2 * (i + 0.5) / 120,
      r: 0.25 + 0.75 * ((i * 47) % 101) / 100,
      s: 0.6 + ((i * 29) % 17) / 17
    }));
    let cv = null, g = null, cw = 0, ch = 0, dpr = 1, raf = 0, last = 0, t = 0;
    let mood = 'idle', energy = 0.18, level = 0, broken = false, ro = null, themeObserver = null;
    let paletteKey = '', paletteCache = null;
    const reduce = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
    const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;

    function parseCssColor(value) {
      const v = String(value || '').trim();
      let m = v.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
      if (m) {
        const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }

    function palette() {
      const cs = getComputedStyle(document.documentElement);
      const raw = ['--accent', '--accent-2', '--hi'].map((name) => cs.getPropertyValue(name).trim());
      const key = raw.join('|');
      if (key !== paletteKey || !paletteCache) {
        const next = raw.map(parseCssColor);
        if (next.every(Boolean)) { paletteCache = { a: next[0], b: next[1], hi: next[2] }; paletteKey = key; }
      }
      return paletteCache;
    }

    function fit() {
      if (!cv) return;
      const nw = cv.clientWidth, nh = cv.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.round(nw * dpr), ph = Math.round(nh * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      cw = nw; ch = nh;
      if (!raf) still();
    }

    function mount(canvas) {
      cv = canvas; try { g = cv.getContext('2d'); } catch (e) { g = null; }
      if (!g) { broken = true; return; }
      if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(cv); } else window.addEventListener('resize', fit);
      if (window.MutationObserver) {
        themeObserver = new MutationObserver(() => { paletteKey = ''; if (!raf && cv) still(); });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
      }
      fit();
    }

    function stateEnergy() {
      const idle = 0.18 + 0.045 * Math.sin(t * 1.25);
      const listening = 0.46 + 0.22 * Math.pow(Math.sin(t * 2.7), 4) + 0.08 * Math.sin(t * 8.1) + 0.18 * level;
      const thinking = 0.68 + 0.08 * Math.sin(t * 5.5);
      const speaking = 0.52 + 0.21 * (0.5 + 0.5 * Math.sin(t * 5.1)) + 0.1 * Math.sin(t * 12.8) + 0.12 * level;
      return w.idle * idle + w.listening * listening + w.thinking * thinking + w.speaking * speaking;
    }

    function step(dt) {
      t += dt;
      const k = 1 - Math.exp(-dt * 5);
      MOODS.forEach((m) => { w[m] += ((m === mood ? 1 : 0) - w[m]) * k; });
      const target = stateEnergy();
      energy += (target - energy) * (1 - Math.exp(-dt * (target > energy ? 16 : 6)));
      level = Math.max(0, level - dt * 1.8);
    }

    function draw() {
      const p = palette();
      if (!g || !p || broken || cw < 8 || ch < 8) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
      g.save(); g.translate(cw / 2, ch / 2); g.globalCompositeOperation = 'lighter';

      const base = Math.min(cw, ch) * 0.258;
      const R = base * (1 + energy * 0.086);
      const speed = MOODS.reduce((sum, m) => sum + w[m] * SPEED[m], 0);
      const rot = t * speed;
      const points = [];

      dustSeeds.forEach((d, i) => {
        const rr = Math.sqrt(1 - d.z * d.z);
        const a = d.a + rot * (0.35 + d.r * 0.24);
        const x = Math.cos(a) * rr * R * (0.55 + 0.45 * d.r);
        const y = d.z * R;
        const z = Math.sin(a) * rr;
        const speakingScatter = 1 + w.speaking * 0.16 * Math.sin(t * 7 + i);
        const thinkingGather = 1 - w.thinking * (0.24 - 0.18 * d.r);
        points.push({ x: x * speakingScatter * thinkingGather, y: y * speakingScatter * thinkingGather, z, d, i });
      });

      points.sort((a, b) => a.z - b.z).forEach((q) => {
        const c = q.i % 7 === 0 ? p.b : p.a;
        const alpha = 0.08 + 0.68 * (q.z + 1) / 2;
        const size = 0.35 + q.d.s * 1.05 + energy * 0.35;
        g.fillStyle = rgba(c, alpha);
        g.shadowColor = rgba(c, 0.85); g.shadowBlur = 3 + 4 * q.d.s;
        g.beginPath(); g.arc(q.x, q.y, size, 0, TAU); g.fill();
      });
      g.shadowBlur = 0;

      const coreRadius = R * (0.47 + energy * 0.086);
      const core = g.createRadialGradient(0, 0, 0, 0, 0, coreRadius);
      core.addColorStop(0, rgba(p.hi, 0.32));
      core.addColorStop(0.4, rgba(p.a, 0.12));
      core.addColorStop(1, rgba(p.a, 0));
      g.fillStyle = core; g.beginPath(); g.arc(0, 0, R * 0.56, 0, TAU); g.fill();

      if (w.listening > 0.01) {
        g.strokeStyle = rgba(p.b, 0.3 * w.listening); g.lineWidth = Math.max(0.7, R * 0.011);
        for (let i = 0; i < 2; i++) {
          g.beginPath(); g.arc(0, 0, R + 4 + i * 7.5 + (t * 11 % 7), 0, TAU); g.stroke();
        }
      }
      g.restore();
    }

    function still() {
      MOODS.forEach((m) => { w[m] = m === mood ? 1 : 0; });
      energy = stateEnergy();
      draw();
    }
    function loop(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
      try { step(dt); draw(); } catch (e) { broken = true; raf = 0; return; }
      raf = requestAnimationFrame(loop);
    }
    return {
      mount, fit,
      setMood(m) { if (MOODS.indexOf(m) < 0 || m === mood) return; mood = m; if (!raf && cv) still(); },
      pulse(v) { level = Math.max(level, Math.min(1, v)); },
      start() { if (raf || !cv || broken) return; fit(); if (reduce()) { still(); return; } last = performance.now(); raf = requestAnimationFrame(loop); },
      stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
      get mood() { return mood; }, get running() { return !!raf; }
    };
  })();

  /* ---------------------------------------------------------------- UI */
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-7-6 16-3-6-7-3z"/></svg>',
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="pv-waves" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>'
  };
  function build() {
    const fab = h('button', 'pv-fab hidden'); fab.type = 'button'; fab.id = 'pvFab';
    fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'pvPanel');
    fab.innerHTML = `<span class="pv-orb">${ICON.mic}</span><span class="pv-fab-t">Ask Plutus</span>`;
    const panel = h('section', 'pv-panel hidden'); panel.id = 'pvPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Plutus voice assistant');
    panel.innerHTML =
      `<header class="pv-head"><div class="pv-title"><span class="pv-orb sm" id="pvOrb"></span><b>PLUTUS</b><span class="pv-sub">Annual report</span></div>` +
      `<div class="pv-hbtns"><button type="button" class="pv-ib" id="pvSpeak" aria-pressed="true" aria-label="Read answers aloud" title="Read answers aloud">${ICON.sound}</button>` +
      `<button type="button" class="pv-ib" id="pvGear" aria-expanded="false" aria-controls="pvSet" aria-label="Voice settings" title="Voice settings">${ICON.gear}</button>` +
      `<button type="button" class="pv-ib" id="pvClose" aria-label="Close" title="Close">${ICON.close}</button></div></header>` +
      `<div class="pv-set hidden" id="pvSet" role="group" aria-label="Voice settings"></div>` +
      `<div class="pv-status" id="pvStatus" role="status" aria-live="polite"></div>` +
      `<div class="pv-stage" id="pvStage" data-state="idle"><button type="button" class="pv-orbbtn" id="pvOrbBtn" aria-label="Ask by voice" title="Tap to ask by voice"><canvas id="pvCanvas" aria-hidden="true"></canvas></button>` +
      `<div class="pv-stage-txt" role="status" aria-live="polite"><b class="pv-stt" id="pvStTitle">Ready</b><span class="pv-sth" id="pvStHint"></span></div></div>` +
      `<div class="pv-log" id="pvLog" aria-live="polite"></div>` +
      `<div class="pv-chips" id="pvChips"></div>` +
      `<div class="pv-stoprow"><button type="button" class="pv-stop hidden" id="pvStop">${ICON.stop}<span>Stop speaking</span></button></div>` +
      `<form class="pv-form" id="pvForm" autocomplete="off"><button type="button" class="pv-mic" id="pvMic" aria-pressed="false" aria-label="Ask by voice" title="Ask by voice">${ICON.mic}</button>` +
      `<input id="pvInput" type="text" maxlength="600" placeholder="Ask about the annual report…" enterkeyhint="send" aria-label="Your question" />` +
      `<button type="submit" class="pv-send" id="pvSend" aria-label="Send">${ICON.send}</button></form>` +
      `<p class="pv-foot">Answers come only from the company’s latest annual report. Not investment advice.</p>`;
    document.body.appendChild(fab); document.body.appendChild(panel);
    ui = { fab, panel, orb: $('#pvOrb', panel), status: $('#pvStatus', panel), log: $('#pvLog', panel), chips: $('#pvChips', panel), form: $('#pvForm', panel),
      input: $('#pvInput', panel), mic: $('#pvMic', panel), send: $('#pvSend', panel), stop: $('#pvStop', panel), speak: $('#pvSpeak', panel), close: $('#pvClose', panel),
      gear: $('#pvGear', panel), set: $('#pvSet', panel), stage: $('#pvStage', panel), orbBtn: $('#pvOrbBtn', panel), canvas: $('#pvCanvas', panel), stTitle: $('#pvStTitle', panel), stHint: $('#pvStHint', panel) };
    ui.placeholder = ui.input.placeholder;
    if (!SR) { ui.mic.classList.add('off'); ui.mic.title = 'Voice input isn’t supported in this browser'; }
    syncSpeakBtn();
    fab.addEventListener('click', () => (S.open ? closePanel() : openPanel()));
    ui.close.addEventListener('click', closePanel);
    ui.form.addEventListener('submit', (e) => { e.preventDefault(); const q = ui.input.value; ui.input.value = ''; ask(q); });
    ui.mic.addEventListener('click', startListening);
    ui.orbBtn.addEventListener('click', () => { if (S.speaking) stopSpeaking(); else if (S.listening) stopListening(); else if (!S.busy) startListening(); });
    Orb.mount(ui.canvas); setOrb();
    ui.stop.addEventListener('click', stopSpeaking);
    ui.speak.addEventListener('click', () => { S.speakOn = !S.speakOn; store.set(K.speak, S.speakOn ? '1' : '0'); if (!S.speakOn) stopSpeaking(); syncSpeakBtn(); });
    ui.gear.addEventListener('click', () => toggleSettings());
    ui.chips.addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (b) ask(b.dataset.q); });
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!ui.set.classList.contains('hidden')) { toggleSettings(false); ui.gear.focus(); return; }
      closePanel(); ui.fab.focus();
    });
    // click outside the settings closes them (composedPath: the clicked button may already have been re-rendered away)
    panel.addEventListener('click', (e) => { const path = e.composedPath ? e.composedPath() : []; if (!ui.set.classList.contains('hidden') && !path.includes(ui.set) && !path.includes(ui.gear)) toggleSettings(false); });
    if (TTS) { loadVoices(); if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', () => { loadVoices(); if (!ui.set.classList.contains('hidden')) renderSettings(); }); }
  }
  function syncSpeakBtn() { ui.speak.setAttribute('aria-pressed', S.speakOn ? 'true' : 'false'); ui.speak.classList.toggle('muted', !S.speakOn); ui.speak.title = S.speakOn ? 'Reading answers aloud — tap to mute' : 'Muted — tap to read answers aloud'; }

  /* ---- voice settings (⚙) ---- */
  function toggleSettings(force) {
    const open = typeof force === 'boolean' ? force : ui.set.classList.contains('hidden');
    ui.set.classList.toggle('hidden', !open); ui.gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderSettings();
  }
  function selectRow(label, options, current, onChange) {
    const row = h('div', 'pv-set-row'); const l = h('label', null, label); const id = 'pvSel' + Math.random().toString(36).slice(2, 7); l.htmlFor = id; row.appendChild(l);
    const sel = h('select'); sel.id = id;
    options.forEach(([val, txt]) => { const o = h('option', null, txt); o.value = val; if (val === current) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => onChange(sel.value)); row.appendChild(sel);
    return row;
  }
  function renderSettings() {
    const el = ui.set; el.textContent = '';
    if (HD_ALLOWED) {
      const row = h('div', 'pv-set-row'); row.appendChild(h('div', 'pv-lbl', 'Voice type'));
      const seg = h('div', 'pv-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Voice type');
      [['hd', 'Natural (HD)'], ['device', 'This device']].forEach(([k, t]) => {
        const b = h('button', null, t); b.type = 'button'; b.setAttribute('aria-pressed', S.engine === k ? 'true' : 'false');
        b.addEventListener('click', () => { S.engine = k; store.set(K.engine, k); if (k === 'hd') { S.hdBlockedUntil = 0; S.hdNoted = ''; } renderSettings(); });
        seg.appendChild(b);
      });
      row.appendChild(seg); el.appendChild(row);
    }
    if (S.engine === 'hd') {
      el.appendChild(selectRow('Voice', HD_VOICES, S.hdVoice, (v) => { S.hdVoice = v; store.set(K.hd, v); }));
    } else {
      const vs = englishVoices();
      const cur = (pickVoice() || {}).voiceURI || '';
      const opts = vs.length ? vs.map((v) => [v.voiceURI, `${isIndian(v) ? '🇮🇳 ' : ''}${v.name} (${v.lang})`]) : [['', 'Default voice']];
      el.appendChild(selectRow('Voice', opts, cur, (v) => { S.devVoice = v; store.set(K.dev, v); }));
    }
    if (LOCAL_AI) {
      const row = h('div', 'pv-set-row'); row.appendChild(h('div', 'pv-lbl', 'Answers from'));
      const seg = h('div', 'pv-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Where answers are written');
      [['cloud', 'Free cloud AI'], ['device', 'On-device AI']].forEach(([k, t]) => {
        const b = h('button', null, t); b.type = 'button'; b.setAttribute('aria-pressed', S.brain === k ? 'true' : 'false');
        b.addEventListener('click', () => { S.brain = k; store.set(K.brain, k); if (k === 'device') store.set(LOCAL_OK, '1'); renderSettings(); });
        seg.appendChild(b);
      });
      row.appendChild(seg); el.appendChild(row);
      el.appendChild(h('p', 'pv-set-note', S.brain === 'device'
        ? `Answers are written by an AI on this device: free, unlimited and offline, but shorter than the cloud's. The first question downloads it once (${Local.sizeText()}).`
        : 'Detailed answers from free cloud AI. If today’s free allowance runs out, I can switch to an AI on this device.'));
    }
    if (SR) {
      const row = h('div', 'pv-set-row'); const lbl = h('div', 'pv-lbl', 'When I stop talking, wait '); lbl.appendChild(h('span', null, (WAITS[S.wait] / 1000).toFixed(1) + ' s')); row.appendChild(lbl);
      const seg = h('div', 'pv-seg three'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'How long a pause ends your question');
      [['short', 'Short'], ['normal', 'Normal'], ['long', 'Long']].forEach(([k, t]) => {
        const b = h('button', null, t); b.type = 'button'; b.setAttribute('aria-pressed', S.wait === k ? 'true' : 'false');
        b.addEventListener('click', () => { S.wait = k; store.set(K.wait, k); renderSettings(); });
        seg.appendChild(b);
      });
      row.appendChild(seg); el.appendChild(row);
    }
    const rate = h('div', 'pv-set-row'); const rl = h('label', null, 'Speed '); rl.htmlFor = 'pvRate'; const rv = h('span', null, S.rate.toFixed(2) + '×'); rl.appendChild(rv); rate.appendChild(rl);
    const rng = h('input'); rng.type = 'range'; rng.id = 'pvRate'; rng.min = '0.75'; rng.max = '1.4'; rng.step = '0.05'; rng.value = String(S.rate);
    rng.addEventListener('input', () => { S.rate = clampRate(rng.value); rv.textContent = S.rate.toFixed(2) + '×'; if (audioEl && S.speaking) audioEl.playbackRate = S.rate; });
    rng.addEventListener('change', () => store.set(K.rate, String(S.rate)));
    rate.appendChild(rng); el.appendChild(rate);
    let note, warn = false;
    if (S.engine === 'hd') {
      if (S.hdBlockedUntil === Infinity) { note = 'The natural Indian voice isn’t switched on for this site yet (the Worker needs a Sarvam AI key). I’m using your device’s voice.'; warn = true; }
      else if (Date.now() < S.hdBlockedUntil) { note = 'The natural voice is resting (daily allowance or a short hiccup). I’m using your device’s voice for now.'; warn = true; }
      else note = 'Natural Indian-English voices by Sarvam AI, on a daily allowance. If it runs out, I switch to your device’s voice automatically.';
    } else note = 'Uses the voices installed on this device. Indian-English voices (🇮🇳) come first, then the most natural-sounding ones.';
    const n = h('p', 'pv-set-note' + (warn ? ' warn' : ''), note); el.appendChild(n);
    const act = h('div', 'pv-set-actions');
    const test = h('button', 'pv-btn', 'Play sample'); test.type = 'button';
    test.addEventListener('click', () => { if (S.engine === 'hd') { S.hdBlockedUntil = 0; S.hdNoted = ''; } speak(SAMPLE, true); });
    const done = h('button', 'pv-btn ghost', 'Done'); done.type = 'button'; done.addEventListener('click', () => { toggleSettings(false); ui.gear.focus(); });
    act.appendChild(test); act.appendChild(done); el.appendChild(act);
  }

  // The orb's mood (and the little caption next to it) is worked out from what is actually happening, in one place.
  function setOrb() {
    if (!ui) return;
    const ds = ui.status.dataset.s || '';
    const st = S.listening ? 'listening' : S.speaking ? 'speaking' : (S.busy || ds === 'checking' || ds === 'preparing') ? 'thinking' : 'idle';
    ui.orb.dataset.state = st; ui.fab.dataset.state = st; ui.panel.dataset.state = st; ui.stage.dataset.state = st;
    Orb.setMood(st);
    let title, hint;
    if (st === 'listening') { title = 'Listening'; hint = S.listen && S.listen.heard ? 'Keep going — I’ll send it when you pause, or tap the orb' : 'Go ahead — take your time'; }
    else if (st === 'speaking') { title = 'Speaking'; hint = 'Tap the orb to stop'; }
    else if (S.busy && S.phase === 'local-load') { title = 'Setting up'; hint = `Getting the on-device AI ready${S.localPct ? ` — ${S.localPct}%` : '…'} (one time only)`; }
    else if (S.busy) { title = 'Thinking'; hint = { understanding: 'Understanding your question…', writing: 'Writing a detailed answer…', local: 'Writing the answer on this device…' }[S.phase] || 'Searching the annual report…'; }
    else if (ds === 'checking') { title = 'Checking'; hint = 'Looking for the annual report…'; }
    else if (ds === 'preparing') { title = 'Reading report'; hint = 'First time for this company — a few minutes'; }
    else if (ds === 'ready') { title = 'Ready'; hint = SR ? 'Tap the orb to ask, or type below' : 'Type your question below'; }
    else { title = 'Offline'; hint = 'The annual report isn’t available yet'; }
    if (ui.stTitle.textContent !== title) ui.stTitle.textContent = title;
    if (ui.stHint.textContent !== hint) ui.stHint.textContent = hint;
  }
  function openPanel() {
    if (!S.sym) return;
    S.open = true; ui.panel.classList.remove('hidden'); ui.fab.setAttribute('aria-expanded', 'true'); document.documentElement.classList.add('pv-open');
    if (!S.report && !S.pollTimer && ui.status.dataset.s !== 'preparing') ensureReport();
    Orb.start();
    if (window.matchMedia && window.matchMedia('(hover: hover)').matches) setTimeout(() => ui.input.focus(), 50);
  }
  function closePanel() {
    S.open = false; ui.panel.classList.add('hidden'); ui.fab.setAttribute('aria-expanded', 'false'); document.documentElement.classList.remove('pv-open');
    toggleSettings(false); stopSpeaking(); abortListening(); Orb.stop();
  }

  function setStatus(state, info) {
    const el = ui.status; el.dataset.s = state; el.textContent = ''; el.classList.remove('hidden');
    ui.form.classList.toggle('disabled', state !== 'ready'); ui.input.disabled = state !== 'ready'; ui.send.disabled = state !== 'ready'; ui.mic.disabled = state !== 'ready'; ui.orbBtn.disabled = state !== 'ready';
    const retry = (label, fn) => { const b = h('button', 'pv-link', label); b.type = 'button'; b.addEventListener('click', fn); el.appendChild(b); };
    if (state === 'checking') { el.appendChild(h('span', 'pv-spin')); el.appendChild(h('span', 'pv-st', 'Checking for the annual report…')); }
    else if (state === 'preparing') {
      el.appendChild(h('span', 'pv-spin'));
      const mins = Math.max(0, Math.round((Date.now() - (info && info.since || Date.now())) / 60000));
      el.appendChild(h('span', 'pv-st', `Plutus is reading ${S.sym}’s annual report for the first time — usually 2–6 minutes${mins ? ` (${mins} min so far)` : ''}. Keep this page open.`));
    }
    else if (state === 'ready') {
      const r = S.report.report || {};
      const bits = [r.form || 'Annual report', r.period_label || (r.fy_end_year ? `FY${r.fy_end_year}` : null)].filter(Boolean).join(' · ');
      el.appendChild(h('span', 'pv-doc', 'Source: ' + bits + ' · '));
      if (/^https?:\/\//.test(r.url || '')) { const a = h('a', 'pv-link', (r.source || 'Source') + ' ↗'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; el.appendChild(a); }
      const w = (S.report.quality && S.report.quality.warnings) || [];
      if (w.length) el.appendChild(h('div', 'pv-warnline', 'Heads-up: ' + w.join('; ') + '. Some answers may be less complete.'));
    }
    else if (state === 'failed') {
      el.appendChild(h('span', null, ((info && info.reason) || 'I couldn’t prepare this company’s annual report.') + ' '));
      retry('Try again', () => ensureReport(true));
    }
    else if (state === 'unconfigured') el.appendChild(h('span', null, 'The annual-report assistant isn’t switched on for this site yet (the Worker needs its GitHub settings).'));
    else if (state === 'busy') { el.appendChild(h('span', null, 'Lots of reports are being prepared right now. ')); retry('Try again later', () => ensureReport()); }
    else if (state === 'slow') { el.appendChild(h('span', null, 'This is taking longer than expected. ')); retry('Check again', () => ensureReport()); }
    else if (state === 'error') { el.appendChild(h('span', null, 'I couldn’t load the annual report just now. ')); retry('Try again', () => ensureReport()); }
    setOrb();
  }

  function scrollLog() { ui.log.scrollTop = ui.log.scrollHeight; }
  function addUser(t) { const m = h('div', 'pv-msg user'); m.appendChild(h('p', null, t)); ui.log.appendChild(m); ui.stage.classList.add('compact'); renderChips(); scrollLog(); return m; }
  function addUnderstood(after, q) {
    const n = h('div', 'pv-understood'); n.appendChild(h('span', 'pv-u-k', 'Understood as')); n.appendChild(h('span', 'pv-u-q', q));
    if (after && after.parentNode === ui.log) after.after(n); else ui.log.appendChild(n);
    scrollLog();
  }
  // scroll so the start of a long answer is in view (instead of jumping to its end)
  function scrollToMsg(m) { const d = m.getBoundingClientRect().top - ui.log.getBoundingClientRect().top - 8; ui.log.scrollTop += d; }
  function addBotNote(t) { const m = h('div', 'pv-msg bot note'); m.appendChild(h('p', null, t)); ui.log.appendChild(m); scrollLog(); }
  function listenBtn(text) {
    const play = h('button', 'pv-replay'); play.type = 'button'; play.innerHTML = ICON.play + '<span>Listen</span>';
    play.addEventListener('click', () => { unlockAudio(); speak(text, true); });
    return play;
  }
  function addBotSimple(t) {
    const m = h('div', 'pv-msg bot'); m.appendChild(h('p', 'pv-spoken', t));
    m.appendChild(listenBtn(t)); ui.log.appendChild(m); scrollLog(); speak(t);
  }
  function addTyping() { const m = h('div', 'pv-msg bot typing'); m.innerHTML = '<span></span><span></span><span></span>'; ui.log.appendChild(m); scrollLog(); return m; }
  function pageLabel(p) {
    const k = S.report && S.report.report && S.report.report.page_kind;
    if (!p || !k || k === 'none') return '';
    return k === 'pdf' ? `PDF page ${p}` : `≈ page ${p}`;
  }
  function withCites(text, container, onCite) {
    text.split(/(\[S\d+\])/).forEach((part) => {
      const m = part.match(/^\[S(\d+)\]$/);
      if (m) { const b = h('button', 'pv-cite', 'S' + m[1]); b.type = 'button'; b.setAttribute('aria-label', 'Show source ' + m[1]); b.addEventListener('click', () => onCite(+m[1])); container.appendChild(b); }
      else if (part) container.appendChild(document.createTextNode(part));
    });
  }
  /* The answer: the spoken summary, then the detailed breakdown shown open (headings + points with [S#] source buttons),
     then the sources themselves folded away under "Sources". */
  function renderAnswer(j, excerpts) {
    const m = h('div', 'pv-msg bot answer');
    m.appendChild(h('p', 'pv-spoken', j.spoken || 'I couldn’t put an answer together from the report.'));
    const cites = Array.isArray(j.cites) ? j.cites.filter((n) => n >= 1 && n <= excerpts.length) : [];
    const srcEls = {}; let srcBox = null;
    const showSource = (n) => { if (srcBox) srcBox.open = true; const s = srcEls[n]; if (s) { s.open = true; s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
    const lines = String(j.detailed || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length && (j.answered !== false || cites.length)) {
      const wrap = h('div', 'pv-detail'); let ul = null;
      lines.forEach((l) => {
        const head = l.match(/^#{1,4}\s*(.+?)\s*:?$/) || (!/\[S\d+\]/.test(l) && !/^[-•*]/.test(l) && l.length <= 60 ? l.match(/^\*{0,2}(.+?)\*{0,2}:?$/) : null);
        if (head) { wrap.appendChild(h('h4', 'pv-dh', head[1].replace(/\*\*/g, ''))); ul = null; return; }
        if (!ul) { ul = h('ul', 'pv-det'); wrap.appendChild(ul); }
        const li = h('li'); withCites(l.replace(/^\s*[-•*]\s*/, ''), li, showSource); ul.appendChild(li);
      });
      m.appendChild(wrap);
    }
    if (cites.length) {
      srcBox = h('details', 'pv-more'); srcBox.appendChild(h('summary', null, `Sources from the report (${cites.length})`));
      const box = h('div', 'pv-srcs');
      cites.forEach((n) => {
        const e = excerpts[n - 1];
        const d = h('details', 'pv-src');
        const pg = pageLabel(e.page);
        d.appendChild(h('summary', null, `S${n} · ${e.section}${pg ? ' · ' + pg : ''}`));
        const q = h('blockquote', null, e.text.length > 600 ? e.text.slice(0, 600).replace(/\s+\S*$/, '') + '…' : e.text); d.appendChild(q);
        srcEls[n] = d; box.appendChild(d);
      });
      srcBox.appendChild(box);
      m.appendChild(srcBox);
    }
    if (Array.isArray(j.unverified) && j.unverified.length) {
      m.appendChild(h('p', 'pv-warn', `⚠ I couldn’t match ${j.unverified.length === 1 ? 'this figure' : 'these figures'} (${j.unverified.slice(0, 4).join(', ')}) to the report text — please check the source before relying on ${j.unverified.length === 1 ? 'it' : 'them'}.`));
    }
    const foot = h('div', 'pv-ansfoot'); foot.appendChild(listenBtn(j.spoken || ''));
    if (j.local) foot.appendChild(h('span', 'pv-tag', 'Answered on this device'));
    else if (j.cached) foot.appendChild(h('span', 'pv-tag', 'Saved answer'));
    m.appendChild(foot);
    ui.log.appendChild(m);
    let q = m.previousElementSibling; while (q && !q.classList.contains('user')) q = q.previousElementSibling; // the question it answers
    scrollToMsg(q || m);
  }
  function renderChips() {
    ui.chips.textContent = '';
    if (!S.report || S.history.length || ui.log.querySelector('.pv-msg.user')) return;
    ['Why did cash flow change?', 'How did revenue and profit change?', 'What are the biggest risks?', 'What does management say about the outlook?', 'How much debt does it have?'].forEach((q) => {
      const b = h('button', 'pv-chip', q); b.type = 'button'; b.dataset.q = q; ui.chips.appendChild(b);
    });
  }

  /* ---------------------------------------------------------------- routing */
  function resetForSymbol(sym) {
    S.loadToken++; stopPolling(); stopSpeaking(); abortListening();
    if (S.askAbort) { try { S.askAbort.abort(); } catch (e) { /* ignore */ } }
    S.sym = sym; S.report = null; S.index = null; S.history = []; S.greeted = false; S.busy = false;
    ui.log.textContent = ''; ui.chips.textContent = ''; ui.status.textContent = ''; ui.status.dataset.s = ''; ui.stage.classList.remove('compact');
    ui.send.disabled = false; setOrb();
    if (S.open && sym) ensureReport();
  }
  function onRoute() {
    const sym = currentSymbol();
    ui.fab.classList.toggle('hidden', !sym);
    if (!sym) { if (S.open) closePanel(); if (S.sym) resetForSymbol(null); return; }
    if (sym !== S.sym) resetForSymbol(sym);
  }

  function init() {
    build();
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('pagehide', () => { stopSpeaking(); abortListening(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stopSpeaking(); Orb.stop(); } else if (S.open) Orb.start(); });
    onRoute();
    window.PlutusVoice = { open: openPanel, close: closePanel, ask, _retrieve: retrieve, _state: S, _orb: Orb }; // handy for debugging / tests
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
