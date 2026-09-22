// ==UserScript==
// @name         PrUn – SHPT Marquee Select
// @namespace    https://prosperousuniverse.com/
// @version      2.0.0
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
