// ==UserScript==
// @name         APEX Auto-ACT
// @namespace    stokovich
// @version      1.5
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-auto-act.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-auto-act.user.js
// @description  Бутон "Act" в заглавния ред на XIT ACT буферите. Натиска ACT веднага щом стане активен (без таймер, не се дроселира на заден план), стига до избрана дестинация в SFC и спира, за да натиснеш Start сам. След потвърждението продължава автоматично със следващия кораб.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.5';

  // ==================================================================
  //  Настройки
  // ==================================================================

  // Докъде да стига автоматиката при полет:
  //   'before-start' - товари, отваря SFC, избира планетата и СПИРА преди Start.
  //                    След като натиснеш Start + потвърждение, продължава сам
  //                    със следващия кораб и пак спира преди неговия Start.
  //   'before-sfc'   - спира по-рано, още преди да отвори SFC.
  //   'off'          - натиска всичко, включително стъпките по полета.
  const FLIGHT_MODE = 'before-start';

  // Предпазителят срещу двоен клик по един промпт вече не е времеви праг, а
  // „зареждане": след клик скриптът чака бутонът да стане неактивен или да се
  // смени (кликът е приет) и чак тогава натиска пак. Времевият праг (150 ms до 1.3)
  // изпускаше бързите стъпки: новият ACT идваше под 150 ms, проверката го отхвърляше
  // и никой не я подновяваше до резервния таймер - до 1 s, а в таб на заден план
  // Chrome дроселира таймера до веднъж на минута. Стокич: „ръчно е по-бързо" (22.09.2026).
  const REARM_MS = 1500;         // ако бутонът не се смени толкова дълго след клик - зареждаме наново
  const NO_ACT_MS = 8000;        // толкова реално време без ACT бутон => пакетът приключи
  const MAX_RUN_MS = 10 * 60000; // общ предпазен лимит
  const AWAIT_START_MS = 15 * 60000; // колко да чака Start, преди да се откаже

  const WATCHDOG_MS = 1000;      // резервна проверка; основното е през observer-ите

  const FINISH_RE = /press execute|finish|complet|готов|приключ|край/i;

  // Статусите на стъпката OPEN_SFC, измерени на живо:
  //   "Open SFC AVI-05EDB" -> "Opening SFC AVI-05EDB..." -> "Set destination?"
  const SFC_RE = /\bSFC\b/i;
  const SET_DEST_RE = /set destination/i;
  const REG_RE = /\bSFC\s+([A-Za-z0-9-]+)/i;
  // Стъпката за покупка от борсата, както я пише Refined PrUn (CXPO_BUY.description):
  //   "Buy 1 DW on NC1 with price limit 159 (159 total cost)"   |  "Buy 100 RAT on NC1 (no price data yet)"
  //   "Bid for 100 RAT on NC1 at price 120 (12,000 total cost)"
  const BUY_RE = /^(Buy|Bid for)\s+([\d,.]+)\s+([A-Z0-9]+)\s+on\s+([A-Z0-9]+)(?:\s+(?:with price limit|at price)\s+([\d,.]+))?/i;

  // ==================================================================
  const ROOT_SEL = '[class*="rp-ExecuteActionPackage__root"]';
  const HEADER_SEL = '[class*="rp-ExecuteActionPackage__header"]';
  const STATUS_SEL = '[class*="rp-ExecuteActionPackage__status"]';
  const FRAME_SEL = '[class*="TileFrame__frame"]';
  const CMD_SEL = '[class*="TileFrame__cmd"]';
  const SUCCESS_SEL = '[class*="ActionFeedback__success"]';
  const MARK = 'puAutoActBtn';

  const state = new WeakMap();
  let lastState = null;   // за PU_AUTO_ACT.timing() след края на пакета

  function actButton(root) {
    return [...root.querySelectorAll('button')]
      .find(b => !b.dataset[MARK] && b.textContent.trim().toUpperCase() === 'ACT');
  }

  // Играта маркира неактивен бутон и с атрибут, и с клас - гледаме и двете.
  function isDisabled(b) {
    return b.disabled || /Button__disabled/.test(String(b.className));
  }

  function statusText(root) {
    const s = root.querySelector(STATUS_SEL);
    return s ? s.textContent.replace(/^\s*Status:\s*/i, '').trim() : '';
  }

  function visible(el) {
    return el && el.offsetParent !== null;
  }

  // Буферът SFC на конкретния кораб (командата е "SFC <регистрация>").
  function sfcTile(reg) {
    const frames = document.querySelectorAll(FRAME_SEL);
    for (const f of frames) {
      const c = f.querySelector(CMD_SEL);
      if (!c) continue;
      const cmd = c.textContent.trim();
      if (reg ? cmd.toUpperCase() === ('SFC ' + reg).toUpperCase() : /^SFC\b/i.test(cmd)) return f;
    }
    return null;
  }

  function num(txt) {
    const v = parseFloat(String(txt || '').replace(/[,\s\u00a0]/g, ''));
    return isFinite(v) ? v : NaN;
  }

  // Предпазител при покупка от борсата (1.5, след теста на 22.09.2026): RP натиска
  // Buy в CXPO буфера веднага след ACT, а формата там понякога още не е готова -
  // книгата с поръчки не е дошла или играта е занулила цената след попълването
  // (при "allow unfilled" без лимит RP пише "∞" и играта го прави 0). Тогава Buy
  // не прави нищо и пакетът чака обратна връзка до timeout. Затова ACT се натиска
  // чак когато буферът CXPO <тикер>.<борса> показва книгата и количество/цена в
  // формата съвпадат със статуса. Не съвпадат ли - чакаме и го казваме на бутона.
  function cxpoReady(m) {
    const ticker = m[3].toUpperCase(), ex = m[4].toUpperCase();
    const want = 'CXPO ' + ticker + '.' + ex;
    const frames = document.querySelectorAll(FRAME_SEL);
    let tile = null;
    for (const f of frames) {
      const c = f.querySelector(CMD_SEL);
      if (c && c.textContent.trim().toUpperCase() === want) { tile = f; break; }
    }
    if (!tile) return { ok: false, why: want + ' buffer is not open yet' };
    const text = tile.textContent.replace(/\s+/g, ' ');
    if (!/Amt\.\s*Price/.test(text)) return { ok: false, why: want + ': order book not loaded yet' };
    const inputs = tile.querySelectorAll('input');
    const qty = num(inputs[0] && inputs[0].value), price = num(inputs[1] && inputs[1].value);
    if (!(qty > 0)) return { ok: false, why: want + ': quantity is empty' };
    if (!(price > 0)) return { ok: false, why: want + ': price is empty or 0 (RP wrote "∞"? set a price limit or turn off "allow unfilled")' };
    const wantQty = num(m[2]), wantPrice = m[5] != null ? num(m[5]) : NaN;
    if (isFinite(wantQty) && Math.abs(qty - wantQty) > 0.5) return { ok: false, why: want + ': quantity ' + qty + ' differs from status ' + wantQty };
    if (isFinite(wantPrice) && Math.abs(price - wantPrice) > 0.01) return { ok: false, why: want + ': price ' + price + ' differs from status ' + wantPrice };
    return { ok: true };
  }

  function startButton(tile) {
    return [...tile.querySelectorAll('button')]
      .find(b => b.textContent.trim().toLowerCase() === 'start');
  }

  // Полетът е подаден, ако: играта е показала успех в буфера SFC,
  // или буферът се е затворил (Refined PrUn го затваря при успех),
  // или бутонът start вече не е активен, след като сме го видели активен.
  function flightSubmitted(st) {
    const tile = sfcTile(st.ship);
    if (!tile) return st.sfcSeen;          // беше отворен, вече го няма
    st.sfcSeen = true;
    if (tile.querySelector(SUCCESS_SEL)) return true;
    const sb = startButton(tile);
    if (!sb) return st.startArmed;
    if (!isDisabled(sb)) { st.startArmed = true; return false; }
    return st.startArmed;                  // беше активен, вече не е => тръгнал е
  }

  function setLabel(btn, text, title, dim) {
    if (!btn || !document.contains(btn)) return;
    btn.textContent = text;
    btn.title = title;
    btn.style.opacity = dim ? '0.65' : '1';
  }

  function stop(root, reason) {
    const st = state.get(root);
    if (!st || !st.running) return;
    st.running = false;
    if (st.obs) { st.obs.disconnect(); st.obs = null; }
    if (st.docObs) { st.docObs.disconnect(); st.docObs = null; }
    if (st.timer) { clearInterval(st.timer); st.timer = null; }

    const btn = st.btn;
    if (!btn || !document.contains(btn)) return;
    btn.dataset.running = '0';
    if (reason === 'flight') {
      setLabel(btn, 'Act ⏸', 'Спряно преди полета - натисни ACT сам', false);
      setTimeout(() => {
        if (document.contains(btn) && btn.dataset.running === '0') setLabel(btn, 'Act', 'Auto-ACT', false);
      }, 4000);
    } else {
      setLabel(btn, 'Act', 'Auto-ACT', false);
    }
  }

  // Едно решение. Вика се при всяка промяна, не по таймер.
  function evaluate(root) {
    const st = state.get(root);
    if (!st || !st.running) return;

    if (!document.contains(root)) { stop(root, 'gone'); return; }

    const now = Date.now();
    if (now - st.startedAt > MAX_RUN_MS) { stop(root, 'max'); return; }

    // --- чакаме Стокич да натисне Start в SFC ---
    if (st.mode === 'awaitStart') {
      if (flightSubmitted(st)) {
        st.mode = 'run';
        st.ship = null; st.sfcSeen = false; st.startArmed = false;
        setLabel(st.btn, 'Stop', 'Auto-ACT работи - натисни за спиране', false);
        // продължаваме веднага със следващия кораб
      } else {
        if (now - st.awaitSince > AWAIT_START_MS) stop(root, 'awaitTimeout');
        return;
      }
    }

    const status = statusText(root);
    if (FINISH_RE.test(status)) { stop(root, 'status'); return; }

    // запомняме регистрацията от "Open SFC <регистрация>"
    const m = status.match(REG_RE);
    if (m) st.ship = m[1];

    if (FLIGHT_MODE === 'before-sfc' && (SFC_RE.test(status) || SET_DEST_RE.test(status))) {
      stop(root, 'flight');
      return;
    }

    const act = actButton(root);
    if (!act) {
      if (now - st.lastActAt > NO_ACT_MS) stop(root, 'noact');
      return;
    }
    st.lastActAt = now;

    if (isDisabled(act) || !visible(act)) { st.readyAt = 0; st.armed = true; return; }

    // първият момент, в който сме видели бутона активен след предишния клик
    if (!st.readyAt) st.readyAt = now;

    if (!st.armed) {
      if (act !== st.clickedBtn || now - st.lastClickAt > REARM_MS) st.armed = true;
      else return;
    }

    // Избирането на планетата в SFC минава през сървърна заявка и иска
    // фокусиран прозорец - Refined PrUn фокусира полето за търсене.
    // В скрит/нефокусиран таб стъпката увисва, затова изчакваме.
    if (SET_DEST_RE.test(status) && !document.hasFocus()) {
      setLabel(st.btn, '⏸ Focus', 'Чака прозорецът да е на фокус, за да избере планетата', true);
      return;
    }

    const buy = BUY_RE.exec(status);
    if (buy) {
      const r = cxpoReady(buy);
      if (!r.ok) { setLabel(st.btn, '⏸ CXPO', r.why, true); return; }
    }
    if (st.btn && st.btn.textContent !== 'Stop') setLabel(st.btn, 'Stop', 'Auto-ACT работи - натисни за спиране', false);

    const wasSetDest = SET_DEST_RE.test(status);
    if (st.lastClickAt) {
      st.log.push({ at: now, sinceReady: now - st.readyAt, sinceClick: now - st.lastClickAt, status: status.slice(0, 40) });
      if (st.log.length > 300) st.log.shift();
    }
    st.lastClickAt = now;
    st.readyAt = 0;
    st.armed = false;
    st.clickedBtn = act;
    act.click();

    // Точно това натискане избра планетата -> оттук нататък Start е твой.
    if (wasSetDest && FLIGHT_MODE === 'before-start') {
      st.mode = 'awaitStart';
      st.awaitSince = Date.now();
      st.sfcSeen = false;
      st.startArmed = false;
      setLabel(st.btn, '⏸ Start',
        'Дестинацията е избрана. Натисни Start + потвърждение в SFC; после продължава сам.', true);
    }
  }

  function start(root, btn) {
    const now = Date.now();
    const st = {
      running: true, btn, mode: 'run', ship: null, sfcSeen: false, startArmed: false,
      startedAt: now, lastActAt: now, lastClickAt: 0, awaitSince: 0,
      armed: true, clickedBtn: null, readyAt: 0, log: [],
      obs: null, docObs: null, timer: null
    };
    lastState = st;
    state.set(root, st);
    btn.dataset.running = '1';
    setLabel(btn, 'Stop', 'Auto-ACT работи - натисни за спиране', false);

    // Двигателят: реагираме на самите промени. MutationObserver не се дроселира
    // на заден план, за разлика от setInterval.
    st.obs = new MutationObserver(() => evaluate(root));
    st.obs.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'disabled']
    });

    // Буферът SFC е извън ACT буфера - следим и целия документ.
    st.docObs = new MutationObserver(() => evaluate(root));
    st.docObs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class']
    });

    st.timer = setInterval(() => evaluate(root), WATCHDOG_MS);
    evaluate(root);
  }

  function makeButton(root) {
    const header = root.querySelector(HEADER_SEL);
    if (!header || header.dataset[MARK]) return;
    header.dataset[MARK] = '1';

    const sample = actButton(root) || root.querySelector('button');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (sample) btn.className = sample.className.replace(/Button__disabled\S*/g, '').trim();
    btn.textContent = 'Act';
    btn.title = 'Auto-ACT';
    btn.dataset[MARK] = '1';
    btn.dataset.running = '0';
    btn.style.marginLeft = 'auto';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const st = state.get(root);
      if (st && st.running) stop(root, 'manual'); else start(root, btn);
    });

    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.appendChild(btn);
  }

  function scan() {
    document.querySelectorAll(ROOT_SEL).forEach(makeButton);
  }

  let pending = null;
  new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; scan(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  scan();

  // Щом прозорецът се върне на фокус, веднага преоценяваме - таймерите
  // в скрит таб са забавени и не бива да разчитаме на тях.
  const wake = () => document.querySelectorAll(ROOT_SEL).forEach(r => evaluate(r));
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);

  document.documentElement.dataset.puAutoActVersion = VERSION;

  window.PU_AUTO_ACT = {
    version: VERSION,
    settings: () => ({ FLIGHT_MODE, REARM_MS, NO_ACT_MS, AWAIT_START_MS }),
    cxpo: status => { const m = BUY_RE.exec(status || ''); return m ? cxpoReady(m) : { ok: false, why: 'status is not a buy step' }; },
    // Измерено темпо на последния пакет: sinceClick = клик-до-клик (ms),
    // sinceReady = колко след появата на активния бутон е натиснат (реакцията на скрипта).
    timing: () => {
      const st = lastState;
      if (!st || !st.log.length) return { clicks: 0 };
      const avg = k => Math.round(st.log.reduce((a, r) => a + r[k], 0) / st.log.length);
      const max = k => Math.max(...st.log.map(r => r[k]));
      return { clicks: st.log.length + 1, avgClickToClick: avg('sinceClick'), maxClickToClick: max('sinceClick'),
               avgReaction: avg('sinceReady'), maxReaction: max('sinceReady'), log: st.log.slice() };
    },
    inspect: () => [...document.querySelectorAll(ROOT_SEL)].map(root => {
      const a = actButton(root);
      const st = state.get(root);
      return {
        status: statusText(root),
        act: a ? (isDisabled(a) ? 'disabled' : 'ready') : 'none',
        running: !!(st && st.running),
        mode: st ? st.mode : null,
        ship: st ? st.ship : null,
        docFocused: document.hasFocus()
      };
    })
  };
})();
