// ==UserScript==
// @name         APEX PROD Status
// @namespace    pu-stokovich
// @version      2.2
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

  var NAME = 'PROD Status';
  var URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js';
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
