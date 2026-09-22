// ==UserScript==
// @name         APEX FLT Home Button
// @namespace    pu-stokovich
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-flt-home-button.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-flt-home-button.user.js
// @description  В буфера FLT слага бутон "MOR" на всеки кацнал кораб, който е другаде. Едно натискане отваря SFC, избира MOR, стартира полета и потвърждава. Решението кой ред е подходящ се взима от самия ред, не от store-а, за да не зависи от това кога се е обновил.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  //  Настройки
  // ------------------------------------------------------------------
  var VERSION = '1.1';
  var HOME = 'MOR';            // дестинация на бутона
  // Колоната Location показва код за станция (MOR) и ИМЕ за планета (Manakil).
  // Тук се изброява как може да изглежда "вече е у дома".
  var HOME_ALIASES = ['MOR', 'MORIA STATION', 'MORIA'];
  var AUTO_CONFIRM = true;     // false => спира преди потвърждението и те оставя да натиснеш
  var STEP_TIMEOUT_MS = 8000;  // колко се чака всяка стъпка

  document.documentElement.dataset.puFltHomeVersion = VERSION;

  // ------------------------------------------------------------------
  //  Store на играта (виж userscripts-firefox за unwrap)
  // ------------------------------------------------------------------
  var _store = null;

  function unwrap(el) {
    try { return (el && el.wrappedJSObject) || el; } catch (e) { return el; }
  }

  function findStore() {
    var c = unwrap(document.getElementById('container'));
    if (!c) return null;
    var key = Object.keys(c).find(function (k) { return k.indexOf('__reactContainer') === 0; });
    if (!key) return null;
    var stack = [c[key]], guard = 0;
    while (stack.length && guard < 50000) {
      var f = stack.pop(); guard++;
      if (!f) continue;
      var p = f.memoizedProps;
      if (p && p.store && typeof p.store.getState === 'function') return p.store;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function getStore() {
    if (_store) { try { _store.getState(); return _store; } catch (e) { _store = null; } }
    _store = findStore();
    return _store;
  }

  function plain(v) { return (v && typeof v.toJS === 'function') ? v.toJS() : v; }

  function valuesOf(node) {
    if (!node) return [];
    if (typeof node.valueSeq === 'function') return node.valueSeq().toArray();
    if (Array.isArray(node)) return node;
    if (typeof node === 'object') return Object.keys(node).map(function (k) { return node[k]; });
    return [];
  }

  function getIn(state, path) {
    try { if (typeof state.getIn === 'function') return state.getIn(path); } catch (e) { /* ignore */ }
    var n = state;
    for (var i = 0; i < path.length; i++) {
      if (!n) return null;
      n = (typeof n.get === 'function') ? n.get(path[i]) : n[path[i]];
    }
    return n;
  }

  function ships() {
    var st = getStore();
    if (!st) return [];
    var state;
    try { state = st.getState(); } catch (e) { return []; }
    return valuesOf(getIn(state, ['fleet', 'ships', 'data'])).map(plain).filter(Boolean);
  }

  // Натуралният идентификатор на локацията (планета или станция).
  // Кораб в полет има address: null - затова служи и за "кацнал ли е".
  function locationOf(ship) {
    var a = ship && ship.address;
    if (!a || !a.lines) return null;
    var last = null;
    for (var i = 0; i < a.lines.length; i++) {
      var l = a.lines[i];
      if (!l || !l.entity) continue;
      last = l.entity;
      if (l.type === 'PLANET' || l.type === 'STATION') return l.entity.naturalId;
    }
    return last ? last.naturalId : null;
  }

  // ------------------------------------------------------------------
  //  Ред от FLT -> кораб
  //  Колоната Transponder може да е скрита (feature на Refined PrUn),
  //  затова първо се търси регистрация, после се пада на името.
  // ------------------------------------------------------------------
  var REG_RE = /^[A-Z]{3}-[A-Z0-9]{5}$/;

  function shipOfRow(row) {
    var list = ships();
    if (!list.length) return null;
    var cells = [].slice.call(row.children).map(function (td) {
      return td.textContent.replace(/\s+/g, ' ').trim();
    });

    for (var i = 0; i < cells.length; i++) {
      if (REG_RE.test(cells[i])) {
        var byReg = list.filter(function (s) { return s.registration === cells[i]; })[0];
        if (byReg) return byReg;
      }
    }
    // Клетката с името изглежда като "2-Big Ivan 96%" - махаме състоянието накрая
    for (var j = 0; j < cells.length; j++) {
      var name = cells[j].replace(/\s+\d+(\.\d+)?%$/, '').trim();
      if (!name) continue;
      var byName = list.filter(function (s) { return s.name === name; })[0];
      if (byName) return byName;
    }
    return null;
  }

  // ------------------------------------------------------------------
  //  Помощни за DOM
  // ------------------------------------------------------------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function label(el) { return el.textContent.replace(/\s+/g, ' ').trim().toUpperCase(); }

  // Играта прави бутон неактивен чрез КЛАС, не само чрез атрибута disabled
  function isDisabled(b) {
    return b.disabled || /Button__disabled/.test(b.className);
  }

  function click(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function waitFor(fn, timeoutMs) {
    var until = Date.now() + (timeoutMs || STEP_TIMEOUT_MS);
    return new Promise(function (resolve) {
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() > until) return resolve(null);
        setTimeout(poll, 100);
      })();
    });
  }

  function changeInputValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    setter.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Отваря нов буфер с команда (същият път като в SSB)
  function openCommand(command, cb) {
    var create = document.querySelector('[class*="Dock__create"]');
    if (!create) { if (cb) cb(null); return; }
    var before = [].slice.call(document.querySelectorAll('[class*="Window__window"]'));
    create.click();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var wins = [].slice.call(document.querySelectorAll('[class*="Window__window"]'));
      var fresh = wins.filter(function (w) { return before.indexOf(w) < 0; })[0];
      var input = fresh && fresh.querySelector('[class*="PanelSelector__input"]');
      if (input && input.form) {
        clearInterval(timer);
        changeInputValue(input, command);
        setTimeout(function () {
          if (input.form && input.form.isConnected) input.form.requestSubmit();
          if (cb) cb(fresh);
        }, 0);
      } else if (tries > 60) {
        clearInterval(timer);
        if (cb) cb(fresh || null);
      }
    }, 25);
  }

  function sfcTileFor(registration) {
    var frames = [].slice.call(document.querySelectorAll('[class*="TileFrame__frame"]'));
    var re = new RegExp('SFC[\\s_]+' + registration.replace(/[-]/g, '\\-'), 'i');
    return frames.filter(function (f) {
      var c = f.querySelector('[class*="TileFrame__cmd"]');
      return c && re.test(c.textContent);
    })[0] || null;
  }

  // ------------------------------------------------------------------
  //  Самият полет
  //
  //  Веригата е изцяло по видимите контроли, защото играта няма външно API:
  //   1. SFC <registration>
  //   2. бутонът HOME от Refined PrUn (feature sfc-exchange-destinations)
  //   3. "start" - става активен чак когато дестинацията е приета
  //   4. потвърждението на играта (ActionConfirmationOverlay)
  //
  //  При всяко разминаване се спира и буферът остава отворен пред теб.
  // ------------------------------------------------------------------
  async function flyHome(btn, ship) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    var original = btn.textContent;

    function stop(text, why) {
      btn.textContent = text;
      btn.title = why || '';
      btn.dataset.busy = '0';
    }

    btn.textContent = '…';

    openCommand('SFC ' + ship.registration, async function () {
      var tile = await waitFor(function () { return sfcTileFor(ship.registration); });
      if (!tile) { stop('?', 'SFC did not open'); return; }

      var form = await waitFor(function () {
        return tile.querySelector('[class*="FlightControlView__form"]');
      });
      if (!form) { stop('?', 'Flight control form did not render'); return; }

      // 2) бутонът за дестинация
      var dest = await waitFor(function () {
        return [].slice.call(form.querySelectorAll('button')).filter(function (b) {
          return label(b) === HOME;
        })[0];
      });
      if (!dest) {
        stop('!', 'No ' + HOME + ' shortcut in SFC - set the destination yourself');
        return;
      }
      if (isDisabled(dest)) {
        stop('!', 'The ' + HOME + ' shortcut is disabled - the ship may already be there');
        return;
      }
      click(dest);

      // 3) start - чакаме го да се отпуши, което значи, че дестинацията е приета
      var start = await waitFor(function () {
        var b = [].slice.call(form.querySelectorAll('button')).filter(function (x) {
          return label(x) === 'START';
        })[0];
        return (b && !isDisabled(b)) ? b : null;
      });
      if (!start) {
        stop('!', 'Start stayed disabled - destination was not accepted');
        return;
      }
      click(start);

      // 4) потвърждението на играта
      if (!AUTO_CONFIRM) { stop('✓?', 'Confirm the flight in SFC'); return; }

      var overlay = await waitFor(function () {
        return tile.querySelector('[class*="ActionConfirmationOverlay"]');
      }, 4000);

      if (!overlay) {
        // Няма потвърждение - или полетът вече е пуснат, или играта е променила стъпката
        stop('✓', 'Start pressed - check SFC');
        return;
      }

      var buttons = [].slice.call(overlay.querySelectorAll('button')).filter(function (b) {
        return !isDisabled(b) && !/CANCEL|BACK|NO|ОТКАЗ/.test(label(b));
      });
      if (buttons.length !== 1) {
        stop('!', 'Could not tell which button confirms - confirm it yourself');
        return;
      }
      click(buttons[0]);
      stop('✓', 'Flight to ' + HOME + ' dispatched');
      setTimeout(scan, 1500);
    });
  }

  // ------------------------------------------------------------------
  //  Бутонът в реда на FLT
  // ------------------------------------------------------------------
  var MARK = 'data-pu-flt-home';

  function isFlt(frame) {
    var c = frame.querySelector('[class*="TileFrame__cmd"]');
    return !!(c && /^\s*FLT\b/i.test(c.textContent));
  }

  // Колоните се намират по заглавие, защото Refined PrUn може да скрива някои.
  function columnIndex(frame, title) {
    var ths = frame.querySelectorAll('thead th');
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].textContent.replace(/\s+/g, ' ').trim().toLowerCase() === title.toLowerCase()) return i;
    }
    return -1;
  }

  function cellText(row, idx) {
    if (idx < 0 || !row.children[idx]) return '';
    return row.children[idx].textContent.replace(/\s+/g, ' ').trim();
  }

  // Състоянието се чете от САМИЯ ред, а не от store-а.
  // Причината: store-ът се обновява с отделен push от сървъра и за кратко
  // може още да води кораба в полет, докато редът вече показва, че е кацнал -
  // тогава бутонът не се появяваше (или изчезваше), без видима причина.
  //   в полет  -> Location "--", Destination попълнена, ETA попълнена
  //   кацнал   -> Location с име/код, Destination и ETA празни
  function rowState(frame, row) {
    var reg = null;
    for (var i = 0; i < row.children.length; i++) {
      var t = cellText(row, i);
      if (REG_RE.test(t)) { reg = t; break; }
    }
    var iLoc = columnIndex(frame, 'Location');
    var iEta = columnIndex(frame, 'ETA');
    var loc = cellText(row, iLoc);
    var eta = cellText(row, iEta);
    var name = cellText(row, columnIndex(frame, 'Name')).replace(/\s+\d+(\.\d+)?%$/, '').trim();

    var landed = !!loc && loc !== '--' && !eta;
    var atHome = HOME_ALIASES.indexOf(loc.toUpperCase()) >= 0;

    return { reg: reg, name: name, loc: loc, eta: eta, landed: landed, atHome: atHome,
             eligible: !!reg && landed && !atHome };
  }

  function inject(frame, row) {
    var cell = row.querySelector('[class*="Fleet__buttons"]');
    if (!cell) return;

    var st = rowState(frame, row);
    var existing = cell.querySelector('[' + MARK + ']');
    if (!st.eligible) { if (existing) existing.remove(); return; }
    if (existing) return;

    // store-ът се ползва само за по-хубаво име в подсказката, не за решението
    var ship = shipOfRow(row);
    var shipName = (ship && ship.name) || st.name || st.reg;

    var sample = [].slice.call(cell.querySelectorAll('button'))[0];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(MARK, '1');
    if (sample) btn.className = sample.className;
    btn.textContent = HOME;
    btn.title = 'Send ' + shipName + ' from ' + st.loc + ' to ' + HOME;
    btn.style.fontWeight = '700';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      flyHome(btn, ship || { registration: st.reg, name: shipName });
    });
    cell.appendChild(btn);
  }

  function scan() {
    var frames = document.querySelectorAll('[class*="TileFrame__frame"]');
    for (var i = 0; i < frames.length; i++) {
      if (!isFlt(frames[i])) continue;
      var rows = frames[i].querySelectorAll('tbody tr');
      for (var j = 0; j < rows.length; j++) inject(frames[i], rows[j]);
    }
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 250);
  }

  // Кацането сменя само текста на клетките Location/ETA, затова се следи и
  // characterData - иначе промяната може да се хване чак от резервния таймер.
  new MutationObserver(schedule)
    .observe(document.body, { childList: true, subtree: true, characterData: true });

  // В таб на заден план Chrome дроселира таймерите до веднъж на минута,
  // затова се преоценява и щом прозорецът се върне на фокус.
  window.addEventListener('focus', scan);
  document.addEventListener('visibilitychange', scan);

  setInterval(scan, 5000);
  setTimeout(scan, 1000);

  window.PU_FLT_HOME = {
    version: VERSION,
    home: HOME,
    scan: scan,
    // какво вижда скриптът за всеки кораб в store-а
    inspect: function () {
      return ships().map(function (s) {
        return { name: s.name, reg: s.registration, inFlight: !!s.flightId, at: locationOf(s) };
      });
    },
    // защо даден ред има или няма бутон - чете се точно това, което вижда скриптът
    why: function () {
      var out = [];
      document.querySelectorAll('[class*="TileFrame__frame"]').forEach(function (f) {
        if (!isFlt(f)) return;
        f.querySelectorAll('tbody tr').forEach(function (tr) {
          var st = rowState(f, tr);
          out.push({
            reg: st.reg, name: st.name, location: st.loc, eta: st.eta,
            landed: st.landed, atHome: st.atHome, eligible: st.eligible,
            hasButton: !!tr.querySelector('[' + MARK + ']'),
            reason: !st.reg ? 'няма разпозната регистрация в реда'
                  : !st.landed ? 'в полет (ETA е попълнена)'
                  : st.atHome ? 'вече е на ' + HOME
                  : 'ok'
          });
        });
      });
      return out;
    }
  };
})();
