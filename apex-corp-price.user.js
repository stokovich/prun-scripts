// ==UserScript==
// @name         APEX Corp Price (CP) — CXPO, CXM, MAT & CXOB
// @namespace    https://prosperousuniverse.com/
// @version      3.9
// @description  Shows the corp price (CP) for both regions, MOR and HUB, in Place Order (CXPO), CX Material Info (CXM), Material (MAT) and Order Book (CXOB)
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-corp-price.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-corp-price.user.js
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  // Version marker for easy diagnostics from the console:
  // document.documentElement.dataset.puCpVersion
  document.documentElement.dataset.puCpVersion = '3.9';

  const SHID = '1bK512U_uLjW-BIqCiP4U3X7Q4eTDZhopm9rnUtp4-nI';
  // One entry per region; each is a tab of the export spreadsheet holding
  // nothing but ticker + price. The order here is the order on screen.
  const REGIONS = [
    { key: 'MOR', sheet: 'MOR' },
    { key: 'HUB', sheet: 'HUB' },
  ];

  /* ── CP fetch, all regions, cached per session ───────────────── */

  // A price list counts only if it looks whole. The export tabs are fed by
  // import formulas that now and then come back empty or cut short; such a
  // list used to be kept as a success, so every ticker read "-" until F5
  // (16.11.2026). Same rules and same remembered counts as PU CONTRACT.
  const CP_MIN_N = 300;        // tickers; the game has ~364 materials
  const CP_MAX_NULL = 0.02;    // share of tickers with no price
  const CP_MIN_SHARE = 0.95;   // of the count of the last whole list
  const CP_N_AGE = 3 * 24 * 3600 * 1000;  // an older remembered count is ignored
  function cpLastN(src) {
    try {
      const o = JSON.parse(localStorage.getItem('pu-cp-n-' + src) || 'null');
      return o && Date.now() - o.t < CP_N_AGE ? o.n : 0;
    } catch (e) { return 0; }
  }
  function cpSaveN(src, n) {
    try { localStorage.setItem('pu-cp-n-' + src, JSON.stringify({ n: n, t: Date.now() })); } catch (e) {}
  }
  function cpCheck(data, lastN) {
    // "Loading..." in A1 of the tab (import formula stuck) comes back as
    // status "error" (NO_COLUMN: B) - seen on HUB, 16.11.2026
    if (!data || data.status !== 'ok' || !data.table) return { ok: false, err: 'not available (sheet ' + ((data && data.status) || 'no answer') + ')' };
    const m = {};
    let n = 0, nul = 0;
    (data.table.rows || []).forEach(row => {
      const t = row && row.c && row.c[0] && row.c[0].v;
      if (t == null || t === '') return;
      n++;
      const p = row.c[1] && row.c[1].v;
      if (p == null) nul++; else m[t] = p;
    });
    if (n < CP_MIN_N) return { ok: false, err: 'incomplete (' + n + ' tickers)' };
    if (nul > n * CP_MAX_NULL) return { ok: false, err: 'incomplete (' + nul + ' of ' + n + ' tickers without price)' };
    if (lastN && n < lastN * CP_MIN_SHARE) return { ok: false, err: 'incomplete (' + n + ' tickers, last time ' + lastN + ')' };
    return { ok: true, m: m, n: n };
  }

  function fetchRegion(r) {
    const url =
      `https://docs.google.com/spreadsheets/d/${SHID}/gviz/tq?tqx=out:json` +
      `&sheet=${encodeURIComponent(r.sheet)}&tq=${encodeURIComponent('SELECT A,B')}`;
    return fetch(url)
      .then(res => res.text())
      .then(text => {
        const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
        if (!m) return { ok: false, err: 'not available (no answer)' };
        const res = cpCheck(JSON.parse(m[1]), cpLastN(r.key));
        if (res.ok) cpSaveN(r.key, res.n);
        return res;
      })
      .catch(e => ({ ok: false, err: String(e && e.message || e) }));
  }

  // Each region on its own: a whole list is kept for the session, a failed
  // one is asked again after CP_RETRY_MS, and one failing leaves the other
  // usable. On screen: "?" = the region failed, "-" = no such ticker.
  const CP_RETRY_MS = 60 * 1000;
  const cpState = {};
  function regionCP(r) {
    const s = cpState[r.key];
    if (s && (s.pending || s.res.ok || Date.now() - s.t < CP_RETRY_MS)) return s.p;
    const e = { pending: true, t: Date.now() };
    e.p = fetchRegion(r).then(res => {
      e.pending = false; e.t = Date.now(); e.res = res;
      return res;
    });
    cpState[r.key] = e;
    return e.p;
  }
  function fetchCP() {
    return Promise.all(REGIONS.map(regionCP)).then(rs => {
      const byRegion = {};
      REGIONS.forEach((r, i) => { byRegion[r.key] = rs[i]; });
      return byRegion;
    });
  }

  function formatCP(price) {
    return Number(price).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /* ── Extract ticker from tile header text ───────────────────────────
     Header examples:
       "CX Material Info: Durable Casing MCXM DCM"  → DCM
       "Material: Durable Casing MMAT DCM"           → DCM
       "PLACE ORDER (MG.NC1)..."                     → handled separately
     Strategy: find the LAST all-caps word (1-6 chars) in the header.
  ──────────────────────────────────────────────────────────────────── */
  function tickerFromHeader(headerEl) {
    const words = (headerEl?.textContent ?? '').trim().split(/\s+/);
    return [...words].reverse().find(w => /^[A-Z][A-Z0-9]{0,5}$/.test(w)) ?? null;
  }

  /* ── CP display widget factory ──────────────────────────────────────── */
  function makeCPWidget(id) {
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.cssText = [
      'margin-left:auto',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'padding:3px 12px',
      'border:1px solid #2a2d3e',
      'background:#0d0f1a',
      'font-family:"Roboto Mono",monospace',
      'font-size:12px',
      'letter-spacing:1px',
      'flex-shrink:0',
    ].join(';');

    const DIM = 'color:#6c7086;font-size:10px;letter-spacing:2px;';

    const lbl = document.createElement('span');
    lbl.textContent = 'CP';
    lbl.style.cssText = DIM + 'text-transform:uppercase;';
    wrap.appendChild(lbl);

    // One horizontal row: MOR : 1,234.56 / HUB : 1,300.00 NCC
    const cells = {};
    REGIONS.forEach((r, i) => {
      if (i) {
        const slash = document.createElement('span');
        slash.textContent = '/';
        slash.style.cssText = 'color:#2a2d3e;';
        wrap.appendChild(slash);
      }
      const tag = document.createElement('span');
      tag.textContent = r.key + ' :';
      tag.style.cssText = DIM;
      wrap.appendChild(tag);

      const val = document.createElement('span');
      val.textContent = '…';
      val.style.cssText = 'color:#c8a44a;font-weight:bold;';
      wrap.appendChild(val);
      cells[r.key] = val;
    });

    const unit = document.createElement('span');
    unit.textContent = 'NCC';
    unit.style.cssText = DIM;
    wrap.appendChild(unit);

    return { wrap, cells };
  }

  // A failed region shows "?" and the widget asks again once a minute while
  // it is on screen (at most CP_TRIES times), so a short outage heals itself.
  const CP_TRIES = 10;
  async function fillCP(cells, ticker, tries) {
    tries = tries || 0;
    const byRegion = await fetchCP();
    let failed = false;
    for (const r of REGIONS) {
      const el = cells[r.key];
      if (!el) continue;
      const res = byRegion[r.key];
      const cp = res && res.ok ? res.m[ticker] : null;
      if (cp != null) {
        el.textContent = formatCP(cp);
        el.title = '';
        el.style.color = '#c8a44a';
        el.style.fontWeight = 'bold';
      } else {
        if (!(res && res.ok)) failed = true;
        el.textContent = res && res.ok ? '-' : '?';
        el.title = res && res.ok ? 'not in the ' + r.key + ' price list'
          : r.key + ' price list ' + ((res && res.err) || 'failed') + ' - asking again in a minute';
        el.style.color = '#6c7086';
        el.style.fontWeight = 'normal';
      }
    }
    if (failed && tries + 1 < CP_TRIES) {
      setTimeout(() => {
        if (Object.values(cells).some(el => el.isConnected)) fillCP(cells, ticker, tries + 1);
      }, CP_RETRY_MS + 500);
    }
  }

  /* ══ HANDLER 1: CXPO — Place Order form ════════════════════════════ */
  async function handleCXPO(form) {
    if (form.querySelector('#pu-cp-cxpo')) return;

    // Ticker from tile header: "PLACE ORDER (MG.NC1)" → material before the dot
    let ticker = null;
    let el = form;
    for (let i = 0; i < 15; i++) {
      el = el?.parentElement;
      if (!el) break;
      const h = el.querySelector('[class*="TileFrame__header"]');
      if (h) {
        const m = h.textContent?.match(/PLACE ORDER\s+\(([^.]+)/i);
        ticker = m?.[1]?.trim() ?? null;
        break;
      }
    }
    if (!ticker) return;

    const { wrap, cells } = makeCPWidget('pu-cp-cxpo');
    wrap.style.cssText += ';border:none;background:transparent;padding:4px 8px;justify-content:flex-end;';
    form.appendChild(wrap);
    fillCP(cells, ticker);
  }

  /* ══ HANDLER 2: CXM — CX Material Info header ══════════════════════
     Targets: ComExMaterialInfo__header (confirmed via DOM inspection)
     Tile root carries class: rp-command-CXM
  ═══════════════════════════════════════════════════════════════════ */
  // The material screens keep the icon, the name and the description in one
  // flex row, so a widget dropped inside it takes width from the description
  // and squeezes it into a narrow column. The prices get a row of their own
  // right under the header instead, where nothing competes with them.
  function addRowBelowHeader(header, id, ticker) {
    const parent = header.parentElement;
    if (!parent || parent.querySelector('#' + id)) return;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;width:100%;padding:2px 0 4px;';

    const { wrap, cells } = makeCPWidget(id);
    wrap.style.marginLeft = '0';
    row.appendChild(wrap);

    header.insertAdjacentElement('afterend', row);
    fillCP(cells, ticker);
  }

  async function handleCXMHeader(header) {
    const tile = header.closest('[class*="TileFrame__frame"]');
    const ticker = tickerFromHeader(tile?.querySelector('[class*="TileFrame__header"]'));
    if (!ticker) return;
    addRowBelowHeader(header, 'pu-cp-cxm', ticker);
  }

  /* ══ HANDLER 3: MAT — Material Info header ══════════════════════════
     Targets: MaterialInformation__header (confirmed via DOM inspection)
     Tile root carries class: rp-command-MAT
  ═══════════════════════════════════════════════════════════════════ */
  async function handleMATHeader(header) {
    const tile = header.closest('[class*="TileFrame__frame"]');
    const ticker = tickerFromHeader(tile?.querySelector('[class*="TileFrame__header"]'));
    if (!ticker) return;
    addRowBelowHeader(header, 'pu-cp-mat', ticker);
  }

  /* ══ HANDLER 4: CXOB — Order Book tile header ═══════════════════════
     Widget goes into the TileFrame__header itself (right side, before
     the tile controls). Ticker from TileFrame__cmd: "CXOB THP.NC1" → THP
  ═══════════════════════════════════════════════════════════════════ */
  async function handleCXOB(tile) {
    const header = tile.querySelector('[class*="TileFrame__header"]');
    if (!header) return;

    const cmdText = tile.querySelector('[class*="TileFrame__cmd"]')?.textContent ?? '';
    const ticker = cmdText.match(/CXOB\s+([A-Z0-9]+)\./i)?.[1]?.toUpperCase() ?? null;
    if (!ticker) return; // cmd not populated yet — retried on next mutation

    const existing = header.querySelector('#pu-cp-cxob');
    if (existing && existing.dataset.ticker === ticker) return; // up to date
    existing?.remove(); // material changed → rebuild

    header.style.display = 'flex';
    header.style.alignItems = 'center';

    const { wrap, cells } = makeCPWidget('pu-cp-cxob');
    wrap.dataset.ticker = ticker;
    // Reserve space for the tile controls (min/max/close) overlaying the
    // right edge of the header.
    const ctrl = tile.querySelector('[class*="TileFrame__controls"]');
    const ctrlW = ctrl ? Math.ceil(ctrl.getBoundingClientRect().width) : 72;
    wrap.style.marginRight = (ctrlW || 72) + 'px';
    wrap.style.padding = '1px 12px';
    header.appendChild(wrap);
    fillCP(cells, ticker);
  }

  /* ── MutationObserver ───────────────────────────────────────────────── */
  const seen = new WeakSet();

  function process(node) {
    if (node.nodeType !== 1) return;

    const check = (selector, handler) => {
      const els = [];
      if (node.matches?.(selector)) els.push(node);
      node.querySelectorAll?.(selector).forEach(e => els.push(e));
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);
        handler(el);
      }
    };

    // ① CXPO: Place Order form
    check('[class*="ComExPlaceOrderForm__form"]', handleCXPO);

    // ② CXM: CX Material Info header (ComExMaterialInfo__header)
    check('[class*="ComExMaterialInfo__header"]', handleCXMHeader);

    // ③ MAT: Material info header (MaterialInformation__header)
    check('[class*="MaterialInformation__header"]', handleMATHeader);

    // ④ CXOB: Order Book tile — NOT routed through `check`/`seen`:
    // the tile appears before its cmd text is populated, and the material
    // can change inside the same tile element, so it must be re-evaluated
    // on every mutation touching it. handleCXOB itself is idempotent.
    const cxobTiles = new Set();
    if (node.matches?.('.rp-command-CXOB')) cxobTiles.add(node);
    node.querySelectorAll?.('.rp-command-CXOB').forEach(t => cxobTiles.add(t));
    const cxobAncestor = node.closest?.('.rp-command-CXOB');
    if (cxobAncestor) cxobTiles.add(cxobAncestor);
    cxobTiles.forEach(handleCXOB);
  }

  const observer = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) process(node);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan: tiles restored automatically on page load (e.g. saved
  // buffers) are already in the DOM before the observer starts.
  process(document.body);
  setTimeout(() => process(document.body), 3000);
})();


/* ── Update bar ──────────────────────────────────────────────────
   A strip at the top of the screen, shared by every script of ours: whichever
   loads first builds it, the rest add a line to it.

   Why it exists: Tampermonkey stops updating a script once it has been edited or
   installed by hand, and its update check then simply reports nothing. The marker
   is not readable from a userscript - verified 22.09.2026: GM_info.scriptWillUpdate
   is true even for a script edited in Tampermonkey's own editor - so the bar goes
   by the symptom instead: a newer version has been published for more than GRACE
   and this copy is still behind. A working auto-update runs daily and takes it
   long before that, so a healthy install never sees the bar.

   The published file is read at most once every EVERY, the answer is kept in
   localStorage, and dismissing the line hushes it for a day.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var NAME = 'Corp Price';
  var URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-corp-price.user.js';
  var KEY = 'pu-upd-' + NAME;
  var EVERY = 6 * 3600 * 1000;
  var GRACE = 36 * 3600 * 1000;
  var HUSH = 24 * 3600 * 1000;

  // Our own version, straight from the script manager - no second literal to
  // forget when the version is bumped. Without it there is nothing to compare.
  var MINE = (function () {
    try {
      if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) return GM_info.script.version || null;
    } catch (e) {}
    return null;
  })();
  if (!MINE) return;

  var latest = null, firstSeen = 0;

  function cmp(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function write(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }

  function bar() {
    var b = document.getElementById('pu-upd-bar');
    if (!b) {
      b = document.createElement('div');
      b.id = 'pu-upd-bar';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;' +
        'background:#2b2718;border-bottom:1px solid #6b5d1f;color:#d9c04a;' +
        'font:12px/1.7 "Roboto Mono",monospace;padding:2px 10px;' +
        'display:flex;flex-direction:column;';
      (document.body || document.documentElement).appendChild(b);
    }
    return b;
  }

  function show() {
    var b = bar();
    if (b.querySelector('[data-pu-upd="' + NAME + '"]')) return;
    var row = document.createElement('div');
    row.setAttribute('data-pu-upd', NAME);
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    row.innerHTML =
      '<span><b>' + NAME + ' ' + latest + '</b> is out and you are running ' + MINE +
      ' - the automatic update is not reaching you.</span>' +
      '<a href="' + URL + '" target="_blank" rel="noopener" ' +
      'style="color:#f0a500;text-decoration:underline;">Install it</a>' +
      '<span style="margin-left:auto;cursor:pointer;padding:0 6px;" title="Hide for a day">\u00d7</span>';
    row.lastChild.addEventListener('click', function () {
      var c = read(); c.hush = Date.now(); write(c);
      row.remove();
      if (!b.children.length) b.remove();
    });
    b.appendChild(row);
  }

  function maybeShow() {
    var c = read();
    if (c.hush && Date.now() - c.hush < HUSH) return;
    if (!latest || cmp(latest, MINE) <= 0) return;
    if (!firstSeen || Date.now() - firstSeen < GRACE) return;
    show();
  }

  function check() {
    var c = read();
    if (c.version) { latest = c.version; firstSeen = c.firstSeen || 0; }
    maybeShow();
    if (c.at && Date.now() - c.at < EVERY) return;
    fetch(URL, { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var m = txt.match(/^\/\/\s*@version\s+(\S+)/m);
        if (!m) return;
        var now = Date.now();
        // The countdown belongs to THIS version, and a version we have caught up
        // with clears it, so installing resets everything.
        if (m[1] !== latest || !firstSeen) firstSeen = now;
        latest = m[1];
        if (cmp(latest, MINE) <= 0) firstSeen = 0;
        c = read();
        c.at = now; c.version = latest; c.firstSeen = firstSeen;
        write(c);
        maybeShow();
      })
      .catch(function () {});   // offline or blocked - the bar simply stays away
  }

  check();
})();
