// ==UserScript==
// @name         APEX LOC Filter
// @namespace    pu-stokovich
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-loc-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-loc-filter.user.js
// @description  A Location screen variable that can also mean "everywhere". For every Location variable (e.g. LOC) the script keeps a hidden twin (LOCX) that buffers use instead: %LOCX% is the picked planet, or nothing at all when the LOC field is left empty - so XIT BURN %LOCX%, XIT PROD %LOCX% and INV %LOCX% show every planet.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* Why a twin and not LOC itself (verified live 07.10.2026):
     - a buffer command takes a screen variable as %NAME%, the game substitutes it
       and re-runs the buffer when the value changes;
     - the game never stores an empty value: clearing the LOC field leaves the old
       location in place, so %LOC% cannot mean "all";
     - a STRING variable holding a single space can: "INV  ", "XIT BURN  " and
       "XIT PROD  " all show every planet. ("ALL" works for XIT, but INV ALL says
       "No inventory found!".)
     So the twin is a STRING variable, hidden from the bar, written by this script:
     the natural id of the picked location, or " " when the LOC field is empty. */

  const SUFFIX = 'X';
  const ALL = ' ';
  const TICK = 500;
  const RESEND_AFTER = 4000;   // the server echoes a write back; do not repeat it while it is on the way

  // ── Access to the game store (React fiber -> Redux Provider) ──
  // Firefox: when the script runs in the sandbox, page properties are behind an
  // Xray wrapper; wrappedJSObject returns the raw object. Absent in Chrome -> no-op.
  function unwrap(o) {
    try { return (o && o.wrappedJSObject) || o; } catch (e) { return o; }
  }
  let store = null;
  function findStore() {
    const c = unwrap(document.getElementById('container'));
    if (!c) return null;
    const key = Object.keys(c).find(k => k.indexOf('__reactContainer') === 0);
    if (!key) return null;
    const stack = [c[key]];
    let guard = 0;
    while (stack.length && guard < 50000) {
      const f = stack.pop(); guard++;
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && p.store && typeof p.store.getState === 'function') return p.store;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }
  function getStore() {
    if (store) { try { store.getState(); return store; } catch (e) { store = null; } }
    store = findStore();
    return store;
  }

  // An object handed to the page from the Firefox sandbox has to be cloned into it.
  function toPage(obj) {
    if (typeof cloneInto === 'function') return cloneInto(obj, unwrap(window));
    return obj;
  }

  function dispatch(type, data) {
    const s = getStore();
    if (!s) return false;
    s.dispatch(toPage({ type: type, data: data, meta: { remote: true, actionId: crypto.randomUUID() } }));
    return true;
  }

  function currentScreenId() {
    const m = location.hash.match(/screen=([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  function screenVariables(screenId) {
    const s = getStore();
    if (!s) return null;
    const v = s.getState().getIn(['ui', 'screens', 'variables', screenId]);
    return v ? v.toJS() : null;
  }

  // What %LOC% stands for: the natural id of the most precise line (planet, station...).
  function locationId(value) {
    const lines = value && value.lines;
    if (!lines || !lines.length) return null;
    const e = lines[lines.length - 1].entity;
    return (e && e.naturalId) || null;
  }

  // The bar element of a variable, by the name in its label. Exact match only:
  // LOC must not pick up LOCX.
  function barItem(name) {
    const bar = document.querySelector('[class*="ScreenVariableControls__bar"]');
    if (!bar) return null;
    for (const item of bar.children) {
      const label = item.querySelector('label');
      if (label && label.textContent.trim() === name) return item;
    }
    return null;
  }

  // Empties the LOC field the way a user does, so the field shows "everywhere"
  // when the twin already says so. The game answers with an empty value, which
  // the server drops - the stored location stays, exactly as after a manual clear.
  function clearField(input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const pending = {};   // twin id -> { value, at }  our write on its way to the server
  const seen = {};      // twin id -> { want, twin }  what this tab saw on the last tick
  const creating = {};  // screenId|name -> time

  function sync() {
    const screenId = currentScreenId();
    if (!screenId) return;
    const vars = screenVariables(screenId);
    if (!vars) return;

    for (const loc of vars) {
      if (loc.type !== 'LOCATION') continue;
      const twinName = loc.name + SUFFIX;
      const twin = vars.find(v => v.name === twinName);

      if (!twin) {
        // Created once; the server answers with the new variable and the next tick finds it.
        const k = screenId + '|' + twinName;
        if (!creating[k] || Date.now() - creating[k] > 10000) {
          creating[k] = Date.now();
          dispatch('UI_SCREENS_VARIABLE_ADD', { screenId: screenId, type: 'STRING', name: twinName, options: [] });
        }
        continue;
      }
      if (twin.type !== 'STRING') continue;   // a user variable of another type with that name - not ours

      const twinItem = barItem(twinName);
      if (twinItem && twinItem.style.display !== 'none') twinItem.style.display = 'none';

      const locItem = barItem(loc.name);
      const input = locItem && locItem.querySelector('input');
      if (!input) continue;
      if (input.title !== 'Empty = every planet') input.title = 'Empty = every planet';
      if (document.activeElement === input) continue;   // still typing - wait for the pick or the blur

      let want;
      if (input.value.trim() === '') {
        want = ALL;
      } else {
        want = locationId(loc.value);
        if (!want) continue;   // no usable location - leave the twin alone rather than guess
      }

      // The twin is shared by every tab and device of the account, so a tab writes
      // it only when ITS field changes. Holding the twin to the field on every tick
      // would make two tabs that show different fields overwrite each other forever.
      // A field that is new to us (page load, screen switch - the bar is drawn
      // again) has not been touched by the user, so it says nothing: the twin is the
      // truth and only the field is brought in line with it.
      const last = seen[twin.id] && seen[twin.id].input === input ? seen[twin.id] : null;
      const p = pending[twin.id];
      const ownEcho = !!(p && twin.value === p.value);
      if (ownEcho) delete pending[twin.id];
      seen[twin.id] = { want: want, twin: twin.value, input: input };

      if (!last) {
        // A fresh field shows the stored location. With "everywhere" stored it is
        // emptied; otherwise (a twin never written yet, or LOC changed by a tab
        // without this script) the twin takes the field below.
        if (twin.value === ALL) {
          if (want !== ALL) { clearField(input); seen[twin.id].want = ALL; }
          continue;
        }
      } else if (last.twin !== twin.value && !ownEcho && !pending[twin.id]) {
        // Changed elsewhere (another tab or device). Follow "everywhere" in the field;
        // a new location arrives through LOC itself.
        if (twin.value === ALL && want !== ALL) { clearField(input); seen[twin.id].want = ALL; }
        continue;
      } else if (last.want === want) {
        continue;   // nothing changed in this tab
      }

      if (twin.value === want) continue;
      if (p && p.value === want && Date.now() - p.at < RESEND_AFTER) continue;
      if (dispatch('UI_SCREENS_VARIABLE_SET_VALUE', { screenId: screenId, variableId: twin.id, value: want })) {
        pending[twin.id] = { value: want, at: Date.now() };
      }
    }
  }

  setInterval(function () {
    try { sync(); } catch (e) { /* the game is still loading or the layout changed - try again next tick */ }
  }, TICK);
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

  var NAME = 'LOC Filter';
  var URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-loc-filter.user.js';
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
      '<span style="margin-left:auto;cursor:pointer;padding:0 6px;" title="Hide for a day">×</span>';
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
