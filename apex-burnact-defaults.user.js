// ==UserScript==
// @name         APEX BURNACT Defaults
// @namespace    pu-stokovich
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-burnact-defaults.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-burnact-defaults.user.js
// @description  В буферите XIT BURNACT вдига "Skip CX Buy" и избира зададения склад в "From", за да не се настройва всеки път на ръка.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  //  Настройки
  // ------------------------------------------------------------------
  var VERSION = '1.0';

  var SKIP_CX_BUY = true;                        // да се вдига ли "Skip CX Buy"
  var WANT_FROM = 'Moria Station Warehouse';     // какво да се избира в "From" ('' => не се пипа)

  // Опциите в "From" се пълнят чак след като складовете се заредят, а Refined PrUn
  // може да пренапише избора при промяна на списъка. Затова опитваме няколко пъти
  // и спираме, щом се хване — после изборът си е твой.
  var TRY_EVERY_MS = 250;
  var TRY_FOR_MS = 15000;

  // ------------------------------------------------------------------
  document.documentElement.dataset.puBurnActVersion = VERSION;

  var CMD_RE = /^\s*XIT[\s_]+BURNACT\b/i;
  var FRAME_SEL = '[class*="TileFrame__frame"]';
  var CMD_SEL = '[class*="TileFrame__cmd"]';

  // Всеки ред от формата е <div class="FormComponent__containerActive">
  //   <label><span>Skip CX Buy</span></label>
  //   <div class="FormComponent__input"><div class="DynamicInput__dynamic"> ... контролата ... </div></div>
  var ROW_SEL = '[class*="FormComponent__containerActive"]';

  function rowByLabel(scope, wanted) {
    var rows = scope.querySelectorAll(ROW_SEL);
    var want = wanted.toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var lab = rows[i].querySelector('label span') || rows[i].querySelector('label');
      if (lab && lab.textContent.trim().toLowerCase() === want) return rows[i];
    }
    return null;
  }

  // "Skip CX Buy" НЕ е чекбокс, а RadioItem на Refined PrUn: div-контейнер с
  // индикатор, който получава клас RadioItem__active, когато е вдигнат.
  function applySkip(frame) {
    if (!SKIP_CX_BUY) return true;
    var row = rowByLabel(frame, 'Skip CX Buy');
    if (!row) return false;
    var indicator = row.querySelector('[class*="RadioItem__indicator"]');
    if (indicator && /RadioItem__active/.test(indicator.className)) return true;   // вече е вдигнат
    var container = row.querySelector('[class*="RadioItem__container"]');
    if (!container) return false;
    container.click();
    var after = row.querySelector('[class*="RadioItem__indicator"]');
    return !!(after && /RadioItem__active/.test(after.className));
  }

  // "From" е нативен <select> с v-model — реагира на събитие change.
  function applyFrom(frame) {
    if (!WANT_FROM) return true;
    var row = rowByLabel(frame, 'From');
    if (!row) return false;
    var sel = row.querySelector('select');
    if (!sel || !sel.options.length) return false;

    var want = WANT_FROM.trim().toLowerCase();
    var target = null;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].textContent.trim().toLowerCase() === want) { target = sel.options[i]; break; }
    }
    if (!target) {
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].textContent.trim().toLowerCase().indexOf(want) >= 0) { target = sel.options[j]; break; }
      }
    }
    if (!target) return false;                       // складът още не е в списъка
    if (sel.value === target.value) return true;     // вече е избран

    sel.value = target.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value === target.value;
  }

  // ------------------------------------------------------------------
  //  По един опит на буфер, докато се хване
  // ------------------------------------------------------------------
  var handled = new WeakMap();

  function isBurnAct(frame) {
    var c = frame.querySelector(CMD_SEL);
    return !!(c && CMD_RE.test(c.textContent));
  }

  function start(frame) {
    if (handled.has(frame)) return;
    var st = { skip: false, from: false, until: Date.now() + TRY_FOR_MS, timer: null };
    handled.set(frame, st);

    var tick = function () {
      if (!frame.isConnected || Date.now() > st.until) { clearInterval(st.timer); return; }
      if (!st.skip) st.skip = applySkip(frame);
      if (!st.from) st.from = applyFrom(frame);
      if (st.skip && st.from) clearInterval(st.timer);
    };

    tick();
    st.timer = setInterval(tick, TRY_EVERY_MS);
  }

  function scan() {
    var frames = document.querySelectorAll(FRAME_SEL);
    for (var i = 0; i < frames.length; i++) {
      if (isBurnAct(frames[i])) start(frames[i]);
    }
  }

  var pending = null;
  new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });

  scan();

  // Диагностика от конзолата
  window.PU_BURNACT = {
    version: VERSION,
    settings: function () { return { SKIP_CX_BUY: SKIP_CX_BUY, WANT_FROM: WANT_FROM }; },
    // какво вижда скриптът в момента
    inspect: function () {
      var out = [];
      document.querySelectorAll(FRAME_SEL).forEach(function (f) {
        if (!isBurnAct(f)) return;
        var skipRow = rowByLabel(f, 'Skip CX Buy');
        var fromRow = rowByLabel(f, 'From');
        var sel = fromRow && fromRow.querySelector('select');
        var ind = skipRow && skipRow.querySelector('[class*="RadioItem__indicator"]');
        out.push({
          cmd: f.querySelector(CMD_SEL).textContent.trim(),
          skipOn: !!(ind && /RadioItem__active/.test(ind.className)),
          from: sel ? sel.value : null,
          fromOptions: sel ? [].map.call(sel.options, function (o) { return o.textContent.trim(); }) : []
        });
      });
      return out;
    },
    apply: function () {
      document.querySelectorAll(FRAME_SEL).forEach(function (f) {
        if (!isBurnAct(f)) return;
        handled.delete(f);
        start(f);
      });
    }
  };
})();
