// ==UserScript==
// @name         PU – Fulfill All
// @namespace    https://apex.prosperousuniverse.com
// @version      2.0.0
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/pu-fulfill-all.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/pu-fulfill-all.user.js
// @description  Adds a "✓ FULFILL ALL" button to CONT buffers in Prosperous Universe — presses every FULFILL button that the game actually allows.
// @author       Stokovich
// @match        https://apex.prosperousuniverse.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var VERSION = '2.0.0';
  document.documentElement.dataset.puFulfillAllVersion = VERSION;

  var BTN_CLASS = 'pu-fa-btn';
  var SCAN_DEBOUNCE_MS = 200;   // мутациите в APEX идват на серии
  var SAFETY_SCAN_MS = 5000;    // резервно сканиране, ако observer-ът пропусне нещо
  var CLICK_GAP_MS = 150;

  /* ── CSS ── */
  var style = document.createElement('style');
  style.textContent =
    '.' + BTN_CLASS + '{padding:4px 12px;background:#11111b;border:1px solid #a6e3a1;' +
    'color:#a6e3a1;font:bold 11px "Roboto Mono",monospace;letter-spacing:1px;cursor:pointer;' +
    'white-space:nowrap;margin-left:4px;}' +
    '.' + BTN_CLASS + ':hover:not(:disabled){background:#1c2e1c;color:#c3f0a0;}' +
    '.' + BTN_CLASS + ':disabled{color:#45475a;border-color:#45475a;cursor:not-allowed;}';
  document.head.appendChild(style);

  /* ── помощни ── */
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // textContent вместо innerText: innerText кара браузъра да преизчисли оформлението.
  // Измерено в живия APEX — 432 бутона: innerText 2.8 ms, textContent 0.07 ms.
  // Внимание: заради това текстът идва СУРОВ ("fulfill", а не "FULFILL" — главните
  // букви са от CSS text-transform), затова всяко сравнение е без оглед на регистъра.
  function label(el) {
    return el.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // Играта прави бутона неактивен чрез КЛАС, а не чрез атрибута disabled —
  // b.disabled е false дори когато бутонът е сив и не прави нищо.
  function isDisabled(b) {
    return b.disabled || /Button__disabled/.test(b.className);
  }

  function clk(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function getTile(el) {
    var cur = el.parentElement;
    while (cur && cur !== document.body) {
      if (cur.className && String(cur.className).indexOf('TileFrame__frame') >= 0) return cur;
      cur = cur.parentElement;
    }
    return document.body;
  }

  /* ── натиска само реално активните FULFILL бутони в текущия тайл ── */
  async function fulfillAll(btn) {
    btn.disabled = true;
    var original = '✓ FULFILL ALL';
    btn.textContent = '⏳ …';

    var scope = getTile(btn);
    var candidates = [].slice.call(scope.querySelectorAll('button')).filter(function (b) {
      return label(b) === 'FULFILL' && !isDisabled(b);
    });

    if (!candidates.length) {
      btn.textContent = '— nothing';
      await sleep(1500);
      btn.textContent = original;
      btn.disabled = false;
      return;
    }

    var done = 0, skipped = 0;
    for (var i = 0; i < candidates.length; i++) {
      var b = candidates[i];
      // състоянието може да се е променило, докато вървим по списъка
      if (!b.isConnected || isDisabled(b) || !b.offsetParent) { skipped++; continue; }
      clk(b);
      done++;
      btn.textContent = '⏳ ' + done + '/' + candidates.length;
      await sleep(CLICK_GAP_MS);
    }

    btn.textContent = '✓ ' + done + ' done' + (skipped ? ' (' + skipped + ' skipped)' : '');
    await sleep(2000);
    btn.textContent = original;
    btn.disabled = false;
  }

  /* ── инжектиране до бутона REQUEST TERMINATION ── */
  function scan() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var termBtn = buttons[i];
      if (label(termBtn) !== 'REQUEST TERMINATION') continue;

      var next = termBtn.nextElementSibling;
      if (next && next.classList && next.classList.contains(BTN_CLASS)) continue;
      if (!termBtn.offsetParent) continue;   // невидим — проверява се последно, защото чете layout

      var btn = document.createElement('button');
      btn.className = BTN_CLASS;
      btn.type = 'button';
      btn.textContent = '✓ FULFILL ALL';
      btn.title = 'Press every FULFILL button the game allows in this contract';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        fulfillAll(e.currentTarget);
      });

      termBtn.insertAdjacentElement('afterend', btn);
    }
  }

  /* ── стартиране ── */
  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, SCAN_DEBOUNCE_MS);
  }

  new MutationObserver(function (mutations) {
    // интересуват ни само добавени възли — иначе всяко тиктакане на число вдига сканиране
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length) { schedule(); return; }
    }
  }).observe(document.body, { childList: true, subtree: true });

  setInterval(scan, SAFETY_SCAN_MS);
  setTimeout(scan, 1000);

  window.PU_FULFILL_ALL = {
    version: VERSION,
    scan: scan,
    // какво вижда в отворените буфери
    inspect: function () {
      return [].slice.call(document.querySelectorAll('button'))
        .filter(function (b) { return label(b) === 'FULFILL'; })
        .map(function (b) { return { text: b.textContent.trim(), disabled: isDisabled(b) }; });
    }
  };
})();
