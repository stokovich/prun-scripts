// ==UserScript==
// @name         APEX CXPO Corp Price (CP)
// @namespace    https://prosperousuniverse.com/
// @version      1.2
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/cxpo-cp-price.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/cxpo-cp-price.user.js
// @description  Shows Corp Price (CP) from Google Sheets in the CXPO Place Order form
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SHID = '1Fwy1S4fBs0-MqOzX3fgaILqBHXtXIzbZvaGJONA0uGw';
  const SHN  = 'DI-CP';

  // Cache CP prices per session to avoid repeated Sheets fetches
  let cpCache = null;
  let cpFetchPromise = null;

  function fetchCP() {
    if (cpCache) return Promise.resolve(cpCache);
    if (cpFetchPromise) return cpFetchPromise;

    const url = `https://docs.google.com/spreadsheets/d/${SHID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHN)}&tq=${encodeURIComponent('SELECT A,J')}`;

    cpFetchPromise = fetch(url)
      .then(r => r.text())
      .then(text => {
        // gviz wraps response: google.visualization.Query.setResponse({...});
        const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
        if (!match) return {};
        const data = JSON.parse(match[1]);
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

  function getTicker(form) {
    // Walk up to find the tile header: "PLACE ORDER (MG.NC1)"
    let el = form;
    for (let i = 0; i < 15; i++) {
      el = el?.parentElement;
      if (!el) break;
      const header = el.querySelector('[class*="TileFrame__header"]');
      if (header) {
        // tile.parameter is the full ticker like "MG.NC1" — extract material part before dot
        const match = header.textContent?.match(/PLACE ORDER\s+\(([^.]+)/i);
        return match?.[1]?.trim() ?? null;
      }
    }
    return null;
  }

  function formatCP(price) {
    return Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function handleForm(form) {
    const ticker = getTicker(form);
    if (!ticker) return;

    // Avoid duplicate injection
    if (form.querySelector('#pu-cp-display')) return;

    // Create CP display element styled like APEX static fields
    const cpDiv = document.createElement('div');
    cpDiv.id = 'pu-cp-display';
    cpDiv.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:flex-end',
      'padding:4px 8px',
      'font-family:"Roboto Mono",monospace',
      'font-size:12px',
      'color:#c8a44a',
      'letter-spacing:1px',
      'gap:8px',
    ].join(';');

    const label = document.createElement('span');
    label.style.cssText = 'color:#6c7086;text-transform:uppercase;font-size:10px;letter-spacing:2px';
    label.textContent = 'Corp Price';

    const value = document.createElement('span');
    value.style.cssText = 'color:#c8a44a;font-weight:bold';
    value.textContent = '…';

    cpDiv.appendChild(label);
    cpDiv.appendChild(value);
    // Append directly to form (after BUY/SELL row)
    form.appendChild(cpDiv);

    // Fetch and display CP
    const cpMap = await fetchCP();
    const cp = cpMap[ticker];
    if (cp != null) {
      value.textContent = formatCP(cp) + ' NCC';
    } else {
      value.textContent = '—';
      value.style.color = '#6c7086';
    }
  }

  const seen = new WeakSet();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const candidates = [];
        if (node.className?.includes?.('ComExPlaceOrderForm__form')) candidates.push(node);
        if (node.querySelectorAll) {
          candidates.push(...node.querySelectorAll('[class*="ComExPlaceOrderForm__form"]'));
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
