// ==UserScript==
// @name         APEX Close All Buffers
// @namespace    pu-stokovich
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js
// @description  Затваря наведнъж всички плаващи буфери в APEX (плочките в основния екран остават). Стартира се от бутон "XA" в левия сайдбар, от командата XIT XA (или XA) и с Ctrl+Shift+X.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Настройки
  // ------------------------------------------------------------------
  const VERSION = '1.0';

  // Клавишна комбинация. ВНИМАНИЕ: Ctrl+Shift+W е резервирана от Chrome
  // (затваря прозореца) и НЕ може да се прихване от страницата.
  const HOTKEY = { ctrl: true, shift: true, alt: false, code: 'KeyX' };

  // Команди, които стартират затварянето. "XIT XA" е надеждната -
  // XIT е валидна команда, така че буферът се създава и се разпознава.
  // "XA" работи само когато е напечатана в командния ред на буфер.
  const TRIGGER_COMMANDS = ['XIT XA', 'XA'];

  // Бутон в левия сайдбар (Refined PrUn). false => без бутон.
  const ADD_SIDEBAR_BUTTON = true;
  const SIDEBAR_LABEL = 'XA';

  // Кратко съобщение долу вляво след затваряне.
  const SHOW_TOAST = true;

  // ------------------------------------------------------------------
  // Помощни
  // ------------------------------------------------------------------
  document.documentElement.dataset.puCloseAllVersion = VERSION;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Класовете на APEX са CSS-modules: "<File>__<key>___<hash>".
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
  // Плаващи буфери
  // ------------------------------------------------------------------
  // Плаващият буфер е .Window__window. Плочките от основния екран живеят
  // в .MainState__tileContainer и нямат Window__window предшественик -
  // затова остават непокътнати.
  function getWindows() {
    return queryModule(document, 'Window__window');
  }

  function findCloseButton(win) {
    const buttons = queryModule(win, 'Window__button');
    // Заглавният ред е "- x"; бутонът за затваряне е този с текст "x".
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
        toast('Няма отворени буфери');
        return 0;
      }

      for (let pass = 0; pass < 25; pass++) {
        const wins = getWindows();
        if (wins.length === 0) break;

        let clicked = 0;
        // отзад напред - най-горният буфер пръв
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
          ? 'Затворени ' + closed + ' ' + (closed === 1 ? 'буфер' : 'буфера')
          : 'Затворени ' + closed + ', останаха ' + remaining,
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
  // Стартиране 1: команда (буфер с command XIT XA / XA)
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
        // изчакваме буферът да се закачи напълно, после затваряме всичко
        setTimeout(() => void closeAllBuffers(), 120);
      }
    }
  }

  // Стартиране 2: Enter в командния ред със стойност XA
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

  // Стартиране 3: клавишна комбинация
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
  // Стартиране 4: бутон в левия сайдбар
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
    btn.title = 'Затвори всички плаващи буфери';

    const label = btn.querySelector('[class*="Frame__toggleLabel"]');
    if (label) label.textContent = SIDEBAR_LABEL;

    // индикаторът да е неутрален (без pulse/active)
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
  // Наблюдение
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

  // ръчно от конзолата: puCloseAllBuffers()
  window.puCloseAllBuffers = closeAllBuffers;
})();
