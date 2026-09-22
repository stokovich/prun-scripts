// ==UserScript==
// @name         APEX PROD Status
// @namespace    pu-stokovich
// @version      2.1
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js
// @description  Shows "All OK" (every production slot is busy) or "Check (N)" (N rows have free slots) in the header of the PROD and XIT PROD buffers in APEX. Updates live as the data changes.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2.1';
  document.documentElement.dataset.puProdStatusVersion = VERSION;

  // Slots are rendered as the text "X / Y" or "X/Y" (busy / total).
  // We read the numbers directly - that is reliable regardless of colour or CSS class.
  const SLOT_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
  const BADGE_ATTR = 'data-pu-prod-status-badge';
  const FRAME_SEL = '[class*="TileFrame__frame"]';
  const HEADER_SEL = '[class*="TileFrame__header"]';
  const CMD_SEL = '[class*="TileFrame__cmd"]';

  function cmdText(frame) {
    const c = frame.querySelector(CMD_SEL);
    return c ? c.textContent.trim() : '';
  }

  // --- supported buffers ---
  // PROD      : native APEX buffer, one row per production line, slot cells ProductionLines__slots*
  // XIT PROD  : Refined PrUn (PMMG) buffer, one row per planet (aggregated), slot cells rp-FracCell__cell*
  const BUFFERS = [
    {
      name: 'PROD',
      match: f => f.classList.contains('rp-command-PROD'),
      slotSelectors: ['[class*="ProductionLines__slots"]'],
      // fallback: any leaf element with the text "X / Y"
      fallback: f => [...f.querySelectorAll('div,span')]
        .filter(e => e.children.length === 0 && SLOT_RE.test(e.textContent))
    },
    {
      name: 'XIT PROD',
      match: f => f.classList.contains('rp-command-XIT') && /^XIT\s+PROD$/i.test(cmdText(f)),
      // FracCell is only the Slots column - this excludes the hidden template row "00/00"
      slotSelectors: ['[class*="FracCell__cell"]', '[class*="FracCell"]'],
      fallback: null
    }
  ];

  function bufferTypeOf(frame) {
    for (const b of BUFFERS) { try { if (b.match(frame)) return b; } catch (e) {} }
    return null;
  }

  // --- computing the state of one buffer ---
  function computeStatus(frame, type) {
    let cells = [];
    for (const sel of type.slotSelectors) {
      cells = [...frame.querySelectorAll(sel)];
      if (cells.length) break;
    }
    if (!cells.length && type.fallback) cells = type.fallback(frame);

    let total = 0, notFull = 0;
    for (const c of cells) {
      const m = c.textContent.match(SLOT_RE);
      if (!m) continue;
      total++;
      if (parseInt(m[1], 10) < parseInt(m[2], 10)) notFull++;
    }
    return { total, notFull };
  }

  // --- creating / styling the badge ---
  function makeBadge() {
    const b = document.createElement('span');
    b.setAttribute(BADGE_ATTR, '1');
    b.style.cssText =
      'margin-left:10px;padding:1px 8px;border-radius:3px;font-size:11px;' +
      'font-weight:bold;letter-spacing:.5px;white-space:nowrap;line-height:16px;' +
      'cursor:default;flex:0 0 auto;';
    return b;
  }

  function paintBadge(b, st, typeName) {
    const unit = typeName === 'XIT PROD' ? 'planets' : 'lines';
    if (st.total === 0) {
      b.textContent = '—';
      b.style.background = '#2a2a2a';
      b.style.color = '#888';
      b.style.border = '1px solid #555';
      b.title = 'No visible slots column in this buffer';
      return;
    }
    if (st.notFull > 0) {
      b.textContent = 'Check (' + st.notFull + ')';
      b.style.background = '#3a1414';
      b.style.color = '#ff6b6b';
      b.style.border = '1px solid #ff6b6b';
      b.title = st.notFull + ' of ' + st.total + ' ' + unit + ' have free slots';
    } else {
      b.textContent = 'All OK';
      b.style.background = '#143a1c';
      b.style.color = '#5fd07a';
      b.style.border = '1px solid #5fd07a';
      b.title = 'All ' + st.total + ' ' + unit + ' are fully busy';
    }
  }

  // --- processing one buffer ---
  function processFrame(frame) {
    const type = bufferTypeOf(frame);
    const head = frame.querySelector(HEADER_SEL);
    if (!head) return;

    let badge = head.querySelector('[' + BADGE_ATTR + ']');

    if (!type) {
      // the buffer changed its command (e.g. XIT PROD -> XIT SHIP) -> remove the badge
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = makeBadge();
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.appendChild(badge); // on the left, next to the command - away from the controls on the right
    }
    paintBadge(badge, computeStatus(frame, type), type.name);
  }

  function scanAll() {
    document.querySelectorAll(FRAME_SEL).forEach(processFrame);
  }

  // --- watching for new buffers AND for live data changes ---
  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; scanAll(); }, 250);
  }

  const obs = new MutationObserver(schedule);
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true // catches the numbers X / Y changing
  });

  scanAll();
})();
