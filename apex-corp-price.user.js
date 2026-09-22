// ==UserScript==
// @name         APEX Corp Price (CP) — CXPO, CXM, MAT & CXOB
// @namespace    https://prosperousuniverse.com/
// @version      3.5
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-corp-price.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-corp-price.user.js
// @description  Shows Corp Price (CP) from Google Sheets in Place Order (CXPO), CX Material Info (CXM), Material (MAT) and Order Book (CXOB) screens
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  // Version marker for easy diagnostics from the console:
  // document.documentElement.dataset.puCpVersion
  document.documentElement.dataset.puCpVersion = '3.5';

  const SHID = '1bK512U_uLjW-BIqCiP4U3X7Q4eTDZhopm9rnUtp4-nI';
  const SHN  = 'MOR';

  /* ── CP fetch (cached per session) ─────────────────────────────────── */
  let cpCache = null;
  let cpFetchPromise = null;

  function fetchCP() {
    if (cpCache) return Promise.resolve(cpCache);
    if (cpFetchPromise) return cpFetchPromise;
    const url =
      `https://docs.google.com/spreadsheets/d/${SHID}/gviz/tq?tqx=out:json` +
      `&sheet=${encodeURIComponent(SHN)}&tq=${encodeURIComponent('SELECT A,B')}`;
    cpFetchPromise = fetch(url)
      .then(r => r.text())
      .then(text => {
        const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
        if (!m) return {};
        const data = JSON.parse(m[1]);
        const map = {};
        (data.table?.rows || []).forEach(row => {
          const ticker = row.c?.[0]?.v;
          const price  = row.c?.[1]?.v;
          if (ticker != null && price != null) map[ticker] = price;
        });
        cpCache = map;
        return map;
      })
      .catch(() => ({}));
    return cpFetchPromise;
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

    const lbl = document.createElement('span');
    lbl.textContent = 'CP';
    lbl.style.cssText = 'color:#6c7086;text-transform:uppercase;font-size:10px;letter-spacing:2px;';

    const val = document.createElement('span');
    val.textContent = '…';
    val.style.cssText = 'color:#c8a44a;font-weight:bold;';

    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return { wrap, val };
  }

  async function fillCP(valEl, ticker) {
    const map = await fetchCP();
    const cp = map[ticker];
    if (cp != null) {
      valEl.textContent = formatCP(cp) + ' NCC';
    } else {
      valEl.textContent = '—';
      valEl.style.color = '#6c7086';
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

    const { wrap, val } = makeCPWidget('pu-cp-cxpo');
    wrap.style.cssText += ';border:none;background:transparent;padding:4px 8px;justify-content:flex-end;';
    form.appendChild(wrap);
    fillCP(val, ticker);
  }

  /* ══ HANDLER 2: CXM — CX Material Info header ══════════════════════
     Targets: ComExMaterialInfo__header (confirmed via DOM inspection)
     Tile root carries class: rp-command-CXM
  ═══════════════════════════════════════════════════════════════════ */
  async function handleCXMHeader(header) {
    if (header.querySelector('#pu-cp-cxm')) return;

    const tile = header.closest('[class*="TileFrame__frame"]');
    const tileHeader = tile?.querySelector('[class*="TileFrame__header"]');
    const ticker = tickerFromHeader(tileHeader);
    if (!ticker) return;

    // Ensure header stretches full width so margin-left:auto pushes widget to the right edge
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.width = '100%';

    const { wrap, val } = makeCPWidget('pu-cp-cxm');
    header.appendChild(wrap);
    fillCP(val, ticker);
  }

  /* ══ HANDLER 3: MAT — Material Info header ══════════════════════════
     Targets: MaterialInformation__header (confirmed via DOM inspection)
     Tile root carries class: rp-command-MAT
  ═══════════════════════════════════════════════════════════════════ */
  async function handleMATHeader(header) {
    if (header.querySelector('#pu-cp-mat')) return;

    const tile = header.closest('[class*="TileFrame__frame"]');
    const tileHeader = tile?.querySelector('[class*="TileFrame__header"]');
    const ticker = tickerFromHeader(tileHeader);
    if (!ticker) return;

    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.width = '100%';

    const { wrap, val } = makeCPWidget('pu-cp-mat');
    header.appendChild(wrap);
    fillCP(val, ticker);
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

    const { wrap, val } = makeCPWidget('pu-cp-cxob');
    wrap.dataset.ticker = ticker;
    // Reserve space for the tile controls (min/max/close) overlaying the
    // right edge of the header.
    const ctrl = tile.querySelector('[class*="TileFrame__controls"]');
    const ctrlW = ctrl ? Math.ceil(ctrl.getBoundingClientRect().width) : 72;
    wrap.style.marginRight = (ctrlW || 72) + 'px';
    wrap.style.padding = '1px 12px';
    header.appendChild(wrap);
    fillCP(val, ticker);
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
