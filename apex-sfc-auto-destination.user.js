// ==UserScript==
// @name         APEX SFC Auto-Destination
// @namespace    https://prosperousuniverse.com/
// @version      1.4
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-sfc-auto-destination.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-sfc-auto-destination.user.js
// @description  SFC: always enables Unload on arrival. (Auto-filling the destination with MOR was removed in 1.4 - the MOR chip in SFC and the MOR button in FLT do that on demand.)
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// История: до 1.3 скриптът и попълваше MOR в Destination, когато корабът е кацнал
// другаде. На 20.09.2026 Стокич го махна - „да не се попълва повече MOR по
// подразбиране, като не сме на тази станция; вече има други два начина бързо да се
// избира" (чипът MOR в SFC от Refined PrUn и бутонът MOR във FLT). Остана само
// Unload on arrival. Кодът за Unload е същият като в 1.3, само е махнато другото.

(function () {
  'use strict';

  // Find the "Unload on arrival" button — it's a clickable button with matching text
  function findUnloadButton(scope) {
    // Look for any button/div/span with "Unload on arrival" text
    const all = scope.querySelectorAll('button, [role="button"], [class*="btn"], [class*="Btn"]');
    for (const el of all) {
      if (/unload/i.test(el.textContent || '')) return el;
    }
    // Fallback: any clickable element with "Unload" text
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (/unload/i.test(node.textContent || '') &&
          node.children.length === 0 &&
          getComputedStyle(node).cursor === 'pointer') {
        return node;
      }
    }
    return null;
  }

  // Click "Unload on arrival" — always, regardless of ship location
  async function enableUnload(form) {
    // Try immediately
    const btn = findUnloadButton(form);
    if (btn) {
      btn.click();
      return;
    }
    // Wait for it to appear (form may render it asynchronously)
    await new Promise(resolve => {
      const obs = new MutationObserver(() => {
        const el = findUnloadButton(form);
        if (el) {
          obs.disconnect();
          el.click();
          resolve();
        }
      });
      obs.observe(form, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(); }, 3000);
    });
  }

  async function handleForm(form) {
    await enableUnload(form);
  }

  const seen = new WeakSet();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const candidates = [];
        if (node.className?.includes?.('FlightControlView__form')) candidates.push(node);
        if (node.querySelectorAll) {
          candidates.push(...node.querySelectorAll('[class*="FlightControlView__form"]'));
        }
        for (const form of candidates) {
          if (seen.has(form)) continue;
          seen.add(form);
          handleForm(form);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
