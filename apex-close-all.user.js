// ==UserScript==
// @name         APEX Close All Buffers
// @namespace    pu-stokovich
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js
// @description  Closes every floating buffer in APEX at once (tiles on the main screen stay). Runs from the "XA" button in the left sidebar, from the XIT XA (or XA) command and with Ctrl+Shift+X.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------
  const VERSION = '1.0';

  // Hotkey. CAUTION: Ctrl+Shift+W is reserved by Chrome
  // (it closes the window) and CANNOT be intercepted from the page.
  const HOTKEY = { ctrl: true, shift: true, alt: false, code: 'KeyX' };

  // Commands that trigger the close. "XIT XA" is the reliable one -
  // XIT is a valid command, so the buffer is created and recognised.
  // "XA" only works when typed into a buffer's command line.
  const TRIGGER_COMMANDS = ['XIT XA', 'XA'];

  // Button in the left sidebar (Refined PrUn). false => no button.
  const ADD_SIDEBAR_BUTTON = true;
  const SIDEBAR_LABEL = 'XA';

  // Short message in the bottom-left corner after closing.
  const SHOW_TOAST = true;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  document.documentElement.dataset.puCloseAllVersion = VERSION;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // APEX class names are CSS modules: "<File>__<key>___<hash>".
  function hasModuleClass(el, prefix) {
    const cl = el.classList;
    for (let i = 0; i < cl.length; i++) {
      if (cl[i].startsWith(prefix + '___') || cl[i] === prefix) return true;
    }
    return false;
  }

  function queryModule(root, prefix) {
    return [...root.querySelectorAll('[class*="' + prefix + '"]')].filter(el =>
      hasModuleClass(el, prefix),
    );
  }

  // ------------------------------------------------------------------
  // Floating buffers
  // ------------------------------------------------------------------
  // A floating buffer is .Window__window. Tiles from the main screen live
  // in .MainState__tileContainer and have no Window__window ancestor -
  // that is why they are left alone.
  function getWindows() {
    return queryModule(document, 'Window__window');
  }

  function findCloseButton(win) {
    const buttons = queryModule(win, 'Window__button');
    // The header row is "- x"; the close button is the one with the text "x".
    const byText = buttons.find(b => b.textContent.trim().toLowerCase() === 'x');
    if (byText) return byText;
    const byClass = queryModule(win, 'Window__close')[0] || queryModule(win, 'Window__destroy')[0];
    return byClass || null;
  }

  let busy = false;

  async function closeAllBuffers() {
    if (busy) return 0;
    busy = true;
    try {
      const initial = getWindows().length;
      if (initial === 0) {
        toast('No open buffers');
        return 0;
      }

      for (let pass = 0; pass < 25; pass++) {
        const wins = getWindows();
        if (wins.length === 0) break;

        let clicked = 0;
        // back to front - the topmost buffer first
        for (let i = wins.length - 1; i >= 0; i--) {
          const btn = findCloseButton(wins[i]);
          if (btn) {
            btn.click();
            clicked++;
          }
        }
        if (clicked === 0) break;
        await sleep(60);
      }

      const remaining = getWindows().length;
      const closed = initial - remaining;
      toast(
        remaining === 0
          ? 'Closed ' + closed + ' ' + (closed === 1 ? 'buffer' : 'buffers')
          : 'Closed ' + closed + ', ' + remaining + ' left',
      );
      return closed;
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  let toastEl = null;
  let toastTimer = null;

  function toast(text) {
    if (!SHOW_TOAST) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed',
        left: '12px',
        bottom: '12px',
        zIndex: '99999',
        padding: '6px 10px',
        background: 'rgba(20,20,20,0.92)',
        border: '1px solid #3a3a3a',
        color: '#d0d0d0',
        font: '12px/1.3 "Droid Sans Mono", monospace',
        pointerEvents: 'none',
        transition: 'opacity 0.25s',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 2000);
  }

  // ------------------------------------------------------------------
  // Trigger 1: command (a buffer with command XIT XA / XA)
  // ------------------------------------------------------------------
  const TRIGGER_RE = new RegExp(
    '^(' + TRIGGER_COMMANDS.map(c => c.replace(/\s+/g, '\\s+')).join('|') + ')$',
    'i',
  );

  const seenCmdNodes = new WeakSet();

  function scanCommands() {
    for (const cmd of queryModule(document, 'TileFrame__cmd')) {
      if (seenCmdNodes.has(cmd)) continue;
      const text = (cmd.textContent || '').trim();
      if (!text) continue;
      seenCmdNodes.add(cmd);
      if (TRIGGER_RE.test(text)) {
        // wait for the buffer to attach fully, then close everything
        setTimeout(() => void closeAllBuffers(), 120);
      }
    }
  }

  // Trigger 2: Enter in the command line with the value XA
  document.addEventListener(
    'submit',
    e => {
      const form = e.target;
      if (!form || !form.querySelector) return;
      const input = form.querySelector('input');
      if (!input) return;
      if (!TRIGGER_RE.test((input.value || '').trim())) return;
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      void closeAllBuffers();
    },
    true,
  );

  // Trigger 3: hotkey
  document.addEventListener(
    'keydown',
    e => {
      if (e.code !== HOTKEY.code) return;
      if (!!e.ctrlKey !== HOTKEY.ctrl) return;
      if (!!e.shiftKey !== HOTKEY.shift) return;
      if (!!e.altKey !== HOTKEY.alt) return;
      e.preventDefault();
      e.stopPropagation();
      void closeAllBuffers();
    },
    true,
  );

  // ------------------------------------------------------------------
  // Trigger 4: button in the left sidebar
  // ------------------------------------------------------------------
  const BTN_MARK = 'data-pu-close-all-btn';

  function ensureSidebarButton() {
    if (!ADD_SIDEBAR_BUTTON) return;
    const sidebar = queryModule(document, 'Frame__sidebar')[0];
    if (!sidebar) return;
    if (sidebar.querySelector('[' + BTN_MARK + ']')) return;

    const sample = queryModule(sidebar, 'Frame__toggle').find(
      el => !el.hasAttribute(BTN_MARK) && el.querySelector('[class*="Frame__toggleLabel"]'),
    );
    if (!sample) return;

    const btn = sample.cloneNode(true);
    btn.setAttribute(BTN_MARK, '1');
    btn.title = 'Close all floating buffers';

    const label = btn.querySelector('[class*="Frame__toggleLabel"]');
    if (label) label.textContent = SIDEBAR_LABEL;

    // keep the indicator neutral (no pulse/active)
    for (const ind of btn.querySelectorAll('[class*="Frame__toggleIndicator"]')) {
      [...ind.classList].forEach(c => {
        if (/Active|Pulse|shadowPulse/i.test(c)) ind.classList.remove(c);
      });
    }

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void closeAllBuffers();
    });

    sidebar.appendChild(btn);
  }

  // ------------------------------------------------------------------
  // Observation
  // ------------------------------------------------------------------
  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      scanCommands();
      ensureSidebarButton();
    }, 150);
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  scanCommands();
  ensureSidebarButton();

  // manually from the console: puCloseAllBuffers()
  window.puCloseAllBuffers = closeAllBuffers;
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

  var NAME = 'Close All';
  var URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js';
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
