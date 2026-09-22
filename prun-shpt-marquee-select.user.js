// ==UserScript==
// @name         PrUn – SHPT Marquee Select
// @namespace    https://prosperousuniverse.com/
// @version      2.1.0
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/prun-shpt-marquee-select.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/prun-shpt-marquee-select.user.js
// @description  Allows SHPT (Shipment) items to be included in drag (marquee) multi-selection in INV/SHPI panels.
// @author       Stokovich
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getFiberKey(el) {
    return Object.keys(el).find(k => k.startsWith('__reactFiber'));
  }

  function walkFiber(el, predicate) {
    const fiberKey = getFiberKey(el);
    if (!fiberKey) return null;
    let fiber = el[fiberKey];
    while (fiber) {
      if (predicate(fiber.stateNode)) return fiber.stateNode;
      fiber = fiber.return;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // PATCH 1 – InventoryView.computeMarqueeSelection
  //
  // Root cause: the game checks  item.type === 'INVENTORY'  before adding an
  // item to the selection Set, which silently excludes all SHIPMENT (SHPT) items.
  //
  // Fix: temporarily remap SHIPMENT → INVENTORY while the rectangle-intersection
  // logic runs, then restore the original items array.
  // ---------------------------------------------------------------------------

  function patchInventoryView(instance) {
    if (instance._rp_shpt_inv_patched) return;

    const original = instance.computeMarqueeSelection.bind(instance);

    instance.computeMarqueeSelection = function () {
      const origItems = this.props.items;

      this.props = {
        ...this.props,
        items: origItems.map(it =>
          it.type === 'SHIPMENT' ? { ...it, type: 'INVENTORY' } : it
        ),
      };

      const result = original.call(this);   // synchronous – safe to mutate + restore

      this.props = { ...this.props, items: origItems };

      return result;
    };

    instance._rp_shpt_inv_patched = true;
    console.log('[SHPT-Marquee] InventoryView patched.');
  }

  // ---------------------------------------------------------------------------
  // PATCH 2 – StoreView._handleItemTransfer
  //
  // Root cause: when the transfer is initiated with a mixed selection
  // (INVENTORY + SHIPMENT items), the game sets
  //   transferDetailsPending = { item: n[0] }
  // where n[0] may be a SHIPMENT item. The transfer dialog then reads
  //   item.quantity.amount  → undefined → crash → "All" button broken.
  //
  // The game already has a CORRECT single-SHPT path:
  //   transferItem(sourceId, targetId, shipmentId)   (no dialog, direct call)
  //
  // Fix: before calling the original handler, split n into SHIPMENT and
  // INVENTORY items. Transfer each SHIPMENT item directly via the game's own
  // transferItem prop, then let the original handle the remaining INVENTORY items.
  // ---------------------------------------------------------------------------

  function patchStoreView(instance) {
    if (instance._rp_shpt_store_patched) return;
    if (typeof instance._handleItemTransfer !== 'function') return;

    const originalHandler = instance._handleItemTransfer;

    instance._handleItemTransfer = function (targetStoreId, items, r, o) {
      const shipmentItems = items.filter(it => it.type === 'SHIPMENT');
      const inventoryItems = items.filter(it => it.type !== 'SHIPMENT');

      // Transfer each SHPT item via the game's own direct path.
      if (shipmentItems.length > 0) {
        const sourceStorageId = instance.props.storage.id;
        shipmentItems.forEach(shipItem => {
          instance.props.transferItem(sourceStorageId, targetStoreId, shipItem.id);
        });
        console.log(`[SHPT-Marquee] Transferred ${shipmentItems.length} SHPT item(s) directly.`);
      }

      // Pass remaining INVENTORY items through the normal handler.
      if (inventoryItems.length > 0) {
        originalHandler.call(instance, targetStoreId, inventoryItems, r, o);
      }
    };

    instance._rp_shpt_store_patched = true;
    console.log('[SHPT-Marquee] StoreView patched.');
  }

  // ---------------------------------------------------------------------------
  // DOM observer
  // ---------------------------------------------------------------------------

  const INV_SELECTOR   = '[class*="InventoryView__container"]';
  const STORE_SELECTOR = '[class*="StoreView__container"]';

  function tryPatch(el) {
    if (el.matches(INV_SELECTOR)) {
      const inv = walkFiber(el, inst => inst && typeof inst.computeMarqueeSelection === 'function');
      if (inv) patchInventoryView(inv);
    }

    if (el.matches(STORE_SELECTOR)) {
      const store = walkFiber(el, inst => inst && typeof inst._handleItemTransfer === 'function');
      if (store) patchStoreView(store);
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        tryPatch(node);
        node.querySelectorAll(`${INV_SELECTOR}, ${STORE_SELECTOR}`).forEach(tryPatch);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Patch panels already present on load.
  document.querySelectorAll(`${INV_SELECTOR}, ${STORE_SELECTOR}`).forEach(tryPatch);

  console.log('[SHPT-Marquee] v2 loaded.');
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

  var NAME = 'SHPT Marquee';
  var URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/prun-shpt-marquee-select.user.js';
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
