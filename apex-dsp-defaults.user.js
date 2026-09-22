// ==UserScript==
// @name         APEX XIT DSP Defaults
// @namespace    pu-stokovich
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-dsp-defaults.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-dsp-defaults.user.js
// @description  XIT DSP: закача лявата колона с корабите да не изчезва при скролване, прави буфера по-висок и налага твоите стойности по подразбиране (BUY изключен, Rep >= 65, Adv 3, Days 30 за избрани бази).
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var VERSION = '1.1';

  // ==================================================================
  //  НАСТРОЙКИ - тук се пипа
  // ==================================================================

  // Как се налагат Rep >=, Adv и CX:
  //   'always' - връщат се обратно винаги, щом ги промени нещо друго.
  //   'once'   - налагат се само веднъж, при отваряне на буфера.
  var ENFORCE = 'always';

  // Days се третира ОТДЕЛНО и по подразбиране е 'once'.
  // Причината: бутонът FIT в DSP смята колко дни се побират в трюма и пише
  // резултата точно в това поле. При 'always' скриптът връщаше 30 обратно
  // за под секунда и изглеждаше, че FIT не работи - измерено: FIT записва
  // 11.14, скриптът пише 30, товарът пак става 25,794t.
  //   'once'   - 30 дни при отваряне на буфера, после FIT е свободен.
  //   'always' - Days също се налага постоянно (FIT става безсмислен).
  var DAYS_ENFORCE = 'once';

  var CX_BUY = false;   // колона CX (BUY) - изключена по подразбиране
  var REP_MIN = 65;     // колона "Rep >="
  var REP_ADV = 3;      // колона "Adv"

  // Days само за изброените бази. Сравнява се ТОЧНО (без значение главни/малки букви)
  // срещу името в колоната Planet или срещу някой от псевдонимите.
  var DAYS_RULES = [
    { days: 30, names: ['saigo d', 'yi-280d', '280d'] },
    { days: 30, names: ['xg-430b', '430b'] },
    { days: 30, names: ['caradhras', 'qq-082b', '082b'] }
  ];
  var DAYS_DEFAULT = null;   // число => важи за всички останали бази; null => не се пипат

  // Височина на буфера XIT DSP. Стандартната на Refined PrUn е 500.
  var MIN_HEIGHT = 1100;         // в пиксели, минимум - може да го разтегляш нагоре
  var HEIGHT_MARGIN = 60;        // да не излиза извън екрана
  var WINDOW_CHROME = 29;        // заглавната лента на прозореца

  var POOL_MAX_HEIGHT = '70vh';  // ако корабите са много, списъкът си скролира сам
  var POOL_BG = '#222';          // фон на закачената колона (иначе редовете прозират)

  // ==================================================================

  document.documentElement.dataset.puDspDefaultsVersion = VERSION;

  var FRAME_SEL = '[class*="TileFrame__frame"]';
  var CMD_SEL = '[class*="TileFrame__cmd"]';
  var WIN_SEL = '[class*="Window__window"]';
  var BODY_SEL = '[class*="Window__body"]';
  var TABLE_SEL = '[class*="DSP__table"]';
  var POOL_SEL = '[class*="ShipPool__pool"]';
  var IND_SEL = '[class*="RadioItem__indicator"]';
  var CONT_SEL = '[class*="RadioItem__container"]';

  var CMD_RE = /^\s*XIT[\s_]+DSP\b/i;
  var WIN_MARK = 'pu-dsp-window';

  /* ------------------------------------------------------------------
   *  1. CSS - закачена колона + по-висок прозорец
   * ---------------------------------------------------------------- */
  function targetHeight() {
    return Math.max(400, Math.min(MIN_HEIGHT, window.innerHeight - HEIGHT_MARGIN));
  }

  var styleEl = document.createElement('style');
  styleEl.id = 'pu-dsp-defaults-style';
  document.head.appendChild(styleEl);

  function writeStyle() {
    var h = targetHeight();
    styleEl.textContent =
      // Лявата колона с корабите остава залепена за горния край при скролване.
      // Скролващият контейнер е ScrollView__view; DSP__panes няма overflow,
      // затова position:sticky работи директно.
      '.' + WIN_MARK + ' ' + POOL_SEL + '{' +
        'position:sticky !important;top:0 !important;align-self:flex-start !important;' +
        'z-index:5;background:' + POOL_BG + ';' +
        'max-height:' + POOL_MAX_HEIGHT + ';overflow-y:auto;' +
      '}' +
      // Играта задава размера на прозореца с inline style; правило с !important
      // в таблица със стилове е по-силно от inline без !important, затова React
      // не се бори с нас при пререндериране.
      '.' + WIN_MARK + '{min-height:' + h + 'px !important;}' +
      '.' + WIN_MARK + ' > ' + BODY_SEL + '{min-height:' + (h - WINDOW_CHROME) + 'px !important;}';
  }
  writeStyle();
  window.addEventListener('resize', writeStyle);

  /* ------------------------------------------------------------------
   *  2. Помощни
   * ---------------------------------------------------------------- */
  function isDsp(frame) {
    var c = frame.querySelector(CMD_SEL);
    return !!(c && CMD_RE.test(c.textContent));
  }

  function isOn(indicator) {
    return !!indicator && /RadioItem__active/.test(indicator.className);
  }

  // NumberInput на Refined PrUn е обикновен <input type="number"> с v-model.
  // v-model слуша 'input'; сетъра от прототипа е нужен, за да тръгне събитието.
  function setNumber(inp, value) {
    if (inp === document.activeElement) return false;   // точно в него пише човекът
    if (String(inp.value) === String(value)) return false;
    var proto = Object.getPrototypeOf(inp);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(inp, String(value)); else inp.value = String(value);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setRadio(indicator, want) {
    if (isOn(indicator) === want) return false;
    var cont = indicator.closest(CONT_SEL) || indicator.parentElement;
    if (!cont) return false;
    cont.click();
    return true;
  }

  function daysFor(planetName) {
    var n = planetName.trim().toLowerCase();
    for (var i = 0; i < DAYS_RULES.length; i++) {
      var r = DAYS_RULES[i];
      for (var j = 0; j < r.names.length; j++) {
        if (r.names[j] === n) return r.days;
      }
    }
    return DAYS_DEFAULT;
  }

  /* ------------------------------------------------------------------
   *  3. Налагане на стойностите
   * ---------------------------------------------------------------- */
  // Редът в DSP съдържа по три <input type="number"> в този ред:
  //   [0] Days   [1] Rep >=   [2] Adv
  // и по пет RadioItem-а:
  //   [0] Burn (resupply)  [1] Rep (repair)  [2] CX (BUY)  [3] Offload  [4] Agent
  // Кои редове вече са получили своя Days - по буфер, за да може повторно
  // отваряне на XIT DSP пак да сложи стойността.
  var daysDone = new WeakMap();   // frame -> Set(име на планета)

  function daysAlreadySet(frame, planet) {
    var set = daysDone.get(frame);
    return !!(set && set.has(planet));
  }

  function markDaysSet(frame, planet) {
    var set = daysDone.get(frame);
    if (!set) { set = new Set(); daysDone.set(frame, set); }
    set.add(planet);
  }

  function applyRow(frame, tr) {
    var planetCell = tr.children[2];
    if (!planetCell) return 0;
    var planet = planetCell.textContent.trim();

    var nums = tr.querySelectorAll('input[type="number"]');
    var inds = tr.querySelectorAll(IND_SEL);
    if (nums.length < 3 || inds.length < 3) return 0;   // редът още се строи

    var changed = 0;

    var d = daysFor(planet);
    if (d !== null && (DAYS_ENFORCE === 'always' || !daysAlreadySet(frame, planet))) {
      if (setNumber(nums[0], d)) changed++;
      // отбелязваме го чак когато полето наистина показва стойността
      if (String(nums[0].value) === String(d)) markDaysSet(frame, planet);
    }
    if (REP_MIN !== null && setNumber(nums[1], REP_MIN)) changed++;
    if (REP_ADV !== null && setNumber(nums[2], REP_ADV)) changed++;
    if (CX_BUY !== null && setRadio(inds[2], CX_BUY)) changed++;

    return changed;
  }

  var doneOnce = new WeakSet();

  function applyFrame(frame) {
    if (ENFORCE === 'once' && doneOnce.has(frame)) return;

    var win = frame.closest(WIN_SEL);
    if (win) win.classList.add(WIN_MARK);

    var table = frame.querySelector(TABLE_SEL);
    if (!table) return;
    var rows = table.querySelectorAll('tbody tr');
    if (!rows.length) return;

    var changed = 0;
    for (var i = 0; i < rows.length; i++) changed += applyRow(frame, rows[i]);

    if (ENFORCE === 'once') doneOnce.add(frame);
    return changed;
  }

  function scan() {
    var frames = document.querySelectorAll(FRAME_SEL);
    for (var i = 0; i < frames.length; i++) {
      if (isDsp(frames[i])) applyFrame(frames[i]);
    }
  }

  /* ------------------------------------------------------------------
   *  4. Стартиране
   * ---------------------------------------------------------------- */
  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 250);
  }

  new MutationObserver(function (muts) {
    // Пишем само при реална разлика, така че собствените ни промени не въртят цикъл.
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes.length || muts[i].type === 'attributes') { schedule(); return; }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  // В таб на заден план Chrome дроселира таймерите до веднъж на минута,
  // затова се преоценява и щом прозорецът се върне на фокус.
  window.addEventListener('focus', scan);
  document.addEventListener('visibilitychange', scan);

  setInterval(scan, 3000);
  setTimeout(scan, 1000);

  /* ------------------------------------------------------------------
   *  5. Диагностика от конзолата
   * ---------------------------------------------------------------- */
  window.PU_DSP_DEFAULTS = {
    version: VERSION,
    settings: function () {
      return { ENFORCE: ENFORCE, DAYS_ENFORCE: DAYS_ENFORCE, CX_BUY: CX_BUY,
               REP_MIN: REP_MIN, REP_ADV: REP_ADV, DAYS_RULES: DAYS_RULES };
    },
    // налага всичко наново, включително Days - все едно буферът е отворен сега
    apply: function () { doneOnce = new WeakSet(); daysDone = new WeakMap(); scan(); },
    inspect: function () {
      var out = [];
      document.querySelectorAll(FRAME_SEL).forEach(function (f) {
        if (!isDsp(f)) return;
        var table = f.querySelector(TABLE_SEL);
        if (!table) return;
        table.querySelectorAll('tbody tr').forEach(function (tr) {
          var nums = tr.querySelectorAll('input[type="number"]');
          var inds = tr.querySelectorAll(IND_SEL);
          if (nums.length < 3 || inds.length < 3) return;
          out.push({
            planet: tr.children[2].textContent.trim(),
            days: nums[0].value, repMin: nums[1].value, adv: nums[2].value,
            cxBuy: isOn(inds[2])
          });
        });
      });
      return out;
    }
  };
})();
