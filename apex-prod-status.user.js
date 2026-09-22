// ==UserScript==
// @name         APEX PROD Status
// @namespace    pu-stokovich
// @version      2.1
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js
// @description  Показва "All OK" (всички производствени слотове са заети) или "Check (N)" (има N реда с незаети слотове) в заглавния ред на PROD и XIT PROD буферите в APEX. Обновява се на живо при промяна на данните.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '2.1';
  document.documentElement.dataset.puProdStatusVersion = VERSION;

  // Слотовете се показват като текст "X / Y" или "X/Y" (заети / общо).
  // Четем числата директно — надеждно е независимо от цвят/CSS клас.
  const SLOT_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
  const BADGE_ATTR = 'data-pu-prod-status-badge';
  const FRAME_SEL = '[class*="TileFrame__frame"]';
  const HEADER_SEL = '[class*="TileFrame__header"]';
  const CMD_SEL = '[class*="TileFrame__cmd"]';

  function cmdText(frame) {
    const c = frame.querySelector(CMD_SEL);
    return c ? c.textContent.trim() : '';
  }

  // --- поддържани буфери ---
  // PROD      : нативен APEX буфер, ред на производствена линия, слот клетки ProductionLines__slots*
  // XIT PROD  : Refined PrUn (PMMG) буфер, ред на планета (агрегирано), слот клетки rp-FracCell__cell*
  const BUFFERS = [
    {
      name: 'PROD',
      match: f => f.classList.contains('rp-command-PROD'),
      slotSelectors: ['[class*="ProductionLines__slots"]'],
      // резервен вариант: всеки лист-елемент с текст "X / Y"
      fallback: f => [...f.querySelectorAll('div,span')]
        .filter(e => e.children.length === 0 && SLOT_RE.test(e.textContent))
    },
    {
      name: 'XIT PROD',
      match: f => f.classList.contains('rp-command-XIT') && /^XIT\s+PROD$/i.test(cmdText(f)),
      // FracCell е само колоната Slots — така се изключва скритият шаблонен ред "00/00"
      slotSelectors: ['[class*="FracCell__cell"]', '[class*="FracCell"]'],
      fallback: null
    }
  ];

  function bufferTypeOf(frame) {
    for (const b of BUFFERS) { try { if (b.match(frame)) return b; } catch (e) {} }
    return null;
  }

  // --- изчисляване на състоянието на един буфер ---
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

  // --- създаване / стилизиране на badge-а ---
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
    const unit = typeName === 'XIT PROD' ? 'планети' : 'линии';
    if (st.total === 0) {
      b.textContent = '—';
      b.style.background = '#2a2a2a';
      b.style.color = '#888';
      b.style.border = '1px solid #555';
      b.title = 'Няма видима колона със слотове в този буфер';
      return;
    }
    if (st.notFull > 0) {
      b.textContent = 'Check (' + st.notFull + ')';
      b.style.background = '#3a1414';
      b.style.color = '#ff6b6b';
      b.style.border = '1px solid #ff6b6b';
      b.title = st.notFull + ' от ' + st.total + ' ' + unit + ' имат незаети слотове';
    } else {
      b.textContent = 'All OK';
      b.style.background = '#143a1c';
      b.style.color = '#5fd07a';
      b.style.border = '1px solid #5fd07a';
      b.title = 'Всички ' + st.total + ' ' + unit + ' са напълно заети';
    }
  }

  // --- обработка на един буфер ---
  function processFrame(frame) {
    const type = bufferTypeOf(frame);
    const head = frame.querySelector(HEADER_SEL);
    if (!head) return;

    let badge = head.querySelector('[' + BADGE_ATTR + ']');

    if (!type) {
      // буферът е сменил командата си (напр. XIT PROD -> XIT SHIP) → махаме badge-а
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = makeBadge();
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.appendChild(badge); // вляво, до командата — далеч от контролите вдясно
    }
    paintBadge(badge, computeStatus(frame, type), type.name);
  }

  function scanAll() {
    document.querySelectorAll(FRAME_SEL).forEach(processFrame);
  }

  // --- наблюдение за нови буфери И за промяна на данните на живо ---
  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; scanAll(); }, 250);
  }

  const obs = new MutationObserver(schedule);
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true // улавя смяната на числата X / Y
  });

  scanAll();
})();
