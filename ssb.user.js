// ==UserScript==
// @name         SSB — Stoka's Script Buffer
// @namespace    pu-stokovich
// @version      3.13
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/ssb.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/ssb.user.js
// @description  SSB (Stoka's Script Buffer) - own APEX buffer with subcommands. SSB VZEM: receivables on active contracts. SSB PART: outstanding contract conditions - what partners owe me (money excluded) and what I owe (money included).
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var VERSION = '3.13';
  document.documentElement.dataset.puSsbVersion = VERSION;
  try { console.log('[SSB ' + VERSION + '] loaded on ' + location.host + ' - type SSB.diag() in the console for a status report'); } catch (e) {}

  var FRAME_SEL = '[class*="TileFrame__frame"]';
  var CMD_SEL   = '[class*="TileFrame__cmd"]';
  var TITLE_SEL = '[class*="TileFrame__title"]';
  var VIEW_SEL  = '[class*="ScrollView__view"]';
  var CMD_RE    = /^\s*(?:XIT[\s_]+)?SSB(?:[\s_]+([A-Z0-9]+))?\s*$/i;

  // Contracts that count as active. OPEN = not signed yet -> not a receivable.
  var ACTIVE_CONTRACT = { CLOSED: 1, PARTIALLY_FULFILLED: 1, DEADLINE_EXCEEDED: 1 };
  // Conditions that are not fulfilled yet (i.e. not paid to me yet)
  var UNPAID_CONDITION = { PENDING: 1, IN_PROGRESS: 1, PARTLY_FULFILLED: 1, FULFILLMENT_ATTEMPTED: 1, VIOLATED: 1 };

  var PAYMENT_TYPES = { PAYMENT: 1, LOAN_PAYOUT: 1 };
  var LOAN_TYPES    = { LOAN_INSTALLMENT: 1 };

  // ─────────────────────────────────────────────────────────────
  //  Access to the game store (React fiber -> Redux Provider)
  // ─────────────────────────────────────────────────────────────
  var _store = null;

  // Firefox: when Tampermonkey cannot inject into the page context
  // (CSP -> fallback to the sandbox), the userscript sees DOM nodes through an
  // Xray wrapper and the properties attached by the page itself (__reactContainer...)
  // are invisible. wrappedJSObject returns the raw object. Absent in Chrome -> no-op.
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
      if (f.child)   stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }

  function getStore() {
    if (_store) { try { _store.getState(); return _store; } catch (e) { _store = null; } }
    _store = findStore();
    return _store;
  }

  // ─────────────────────────────────────────────────────────────
  //  Finding the contracts (the path is cached)
  // ─────────────────────────────────────────────────────────────
  var _path = null;

  function plain(v) { return (v && typeof v.toJS === 'function') ? v.toJS() : v; }

  function valuesOf(node) {
    if (!node) return null;
    if (typeof node.valueSeq === 'function') return node.valueSeq().toArray();
    if (Array.isArray(node)) return node;
    if (typeof node === 'object') return Object.keys(node).map(function (k) { return node[k]; });
    return null;
  }

  function looksLikeContracts(node) {
    var vals = valuesOf(node);
    if (!vals || !vals.length) return false;
    var s = plain(vals[0]);
    return !!(s && typeof s === 'object' && s.conditions && s.partner && s.localId);
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

  // Fallback search (BFS up to 4 levels) - in case APEX moves the branch
  function discoverPath(state) {
    var queue = [{ node: state, path: [] }], guard = 0;
    while (queue.length && guard < 4000) {
      var cur = queue.shift(); guard++;
      if (looksLikeContracts(cur.node)) return cur.path;
      if (cur.path.length >= 4) continue;
      var node = cur.node, keys = null;
      if (node && typeof node.keySeq === 'function') keys = node.keySeq().toArray();
      else if (node && typeof node === 'object' && !Array.isArray(node)) keys = Object.keys(node);
      if (!keys) continue;
      for (var i = 0; i < keys.length && i < 80; i++) {
        var child;
        try { child = (typeof node.get === 'function') ? node.get(keys[i]) : node[keys[i]]; } catch (e) { continue; }
        if (child && typeof child === 'object') queue.push({ node: child, path: cur.path.concat([keys[i]]) });
      }
    }
    return null;
  }

  function getContracts() {
    var st = getStore();
    if (!st) return null;
    var state;
    try { state = st.getState(); } catch (e) { return null; }

    var raw = null;
    if (_path) {
      raw = getIn(state, _path);
      if (!looksLikeContracts(raw)) { _path = null; raw = null; }
    }
    if (!raw) {
      var guesses = [['contracts', 'contracts'], ['contracts', 'contracts', 'data'], ['contracts', 'data']];
      for (var i = 0; i < guesses.length && !raw; i++) {
        var cand = getIn(state, guesses[i]);
        if (looksLikeContracts(cand)) { raw = cand; _path = guesses[i]; }
      }
    }
    if (!raw) {
      var p = discoverPath(state);
      if (p) { _path = p; raw = getIn(state, p); }
    }
    if (!raw) return null;

    return (valuesOf(raw) || []).map(plain).filter(function (x) { return x && x.conditions; });
  }

  // ─────────────────────────────────────────────────────────────
  //  Collecting the receivables
  // ─────────────────────────────────────────────────────────────
  function partnerLabel(p) {
    if (!p) return '???';
    var n = p.name || p.code || '???';
    return (p.code && p.code !== n) ? n + ' (' + p.code + ')' : n;
  }

  // Condition amount - PAYMENT uses amount, loan installments are in total (repayment + interest)
  function condAmount(cond) {
    var a = cond.total || cond.amount || cond.repayment;
    if (a && typeof a.amount === 'number') return a;
    return null;
  }

  // Deadline. When the game has not fixed a deadline, the clock starts after the deadline of
  // the preceding conditions: deadline = latest deadline among the dependencies + deadlineDuration.
  // This is the LATEST possible deadline - the real one is earlier if the preceding condition is
  // fulfilled before its own deadline. That is why computed deadlines are shown with a tilde and dimmed.
  // Refined PrUn uses the same model (core/balance/contract-conditions.ts).
  function calcDeadline(contract, cond, seen) {
    if (cond.type === 'COMEX_PURCHASE_PICKUP') return latestDependency(contract, cond, seen);
    if (cond.deadline && cond.deadline.timestamp) return cond.deadline.timestamp;
    if (!cond.deadlineDuration || !cond.deadlineDuration.millis) return null;
    var base = latestDependency(contract, cond, seen);
    return base === null ? null : base + cond.deadlineDuration.millis;
  }

  function latestDependency(contract, cond, seen) {
    var t = (contract.date && contract.date.timestamp) || 0;
    var deps = cond.dependencies || [];
    for (var i = 0; i < deps.length; i++) {
      if (seen.indexOf(deps[i]) >= 0) continue;   // guard against a circular dependency
      var d = (contract.conditions || []).find(function (x) { return x.id === deps[i]; });
      if (!d) continue;
      var v = calcDeadline(contract, d, seen.concat([deps[i]]));
      if (v !== null && v > t) t = v;
    }
    return t;
  }

  function collect() {
    var contracts = getContracts();
    if (contracts === null) return null;

    var pay = [], loan = [];
    contracts.forEach(function (c) {
      if (!ACTIVE_CONTRACT[c.status]) return;
      (c.conditions || []).forEach(function (cond) {
        var isPay = !!PAYMENT_TYPES[cond.type];
        var isLoan = !!LOAN_TYPES[cond.type];
        if (!isPay && !isLoan) return;
        if (cond.party === c.party) return;          // this is MY payment, not a receivable
        if (!UNPAID_CONDITION[cond.status]) return;  // already paid
        var amt = condAmount(cond);
        if (!amt || !amt.amount) return;

        var fixed = (cond.deadline && cond.deadline.timestamp) || null;
        var deadline = fixed || calcDeadline(c, cond, []);
        (isLoan ? loan : pay).push({
          localId: c.localId || '',
          partner: partnerLabel(c.partner),
          partnerKey: (c.partner && (c.partner.id || c.partner.name)) || '???',
          amount: amt.amount,
          currency: amt.currency || '',
          principal: (cond.repayment && cond.repayment.amount) || null,
          interest: (cond.interest && cond.interest.amount) || null,
          deadline: deadline,
          estimated: !fixed && deadline !== null,
          index: cond.index || 0
        });
      });
    });
    return { pay: pay, loan: loan };
  }

  function groupByPartner(rows) {
    var map = new Map();
    rows.forEach(function (r) {
      var g = map.get(r.partnerKey);
      if (!g) { g = { key: r.partnerKey, partner: r.partner, rows: [], totals: {} }; map.set(r.partnerKey, g); }
      g.rows.push(r);
      g.totals[r.currency] = (g.totals[r.currency] || 0) + r.amount;
      if (r.principal) g.principal = (g.principal || 0) + r.principal;
      if (r.interest)  g.interest  = (g.interest  || 0) + r.interest;
    });
    var groups = Array.from(map.values());
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) {
        return (a.deadline || Infinity) - (b.deadline || Infinity) || a.index - b.index;
      });
      g.earliest = g.rows.reduce(function (m, r) {
        return Math.min(m, r.deadline || Infinity);
      }, Infinity);
      g.sum = Object.keys(g.totals).reduce(function (s, k) { return s + g.totals[k]; }, 0);
    });
    groups.sort(function (a, b) { return a.earliest - b.earliest || b.sum - a.sum; });
    return groups;
  }

  // ─────────────────────────────────────────────────────────────
  //  Formatting
  // ─────────────────────────────────────────────────────────────
  function fmtMoney(n) {
    return n.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTotals(totals) {
    var keys = Object.keys(totals).sort();
    if (!keys.length) return '—';
    return keys.map(function (k) { return fmtMoney(totals[k]) + (k ? ' ' + k : ''); }).join(' + ');
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtLeft(ts, now, estimated) {
    if (!ts) return { date: 'no deadline', text: '—', cls: 'ssb-muted' };
    var ms = ts - now;
    var overdue = ms < 0;
    var total = Math.floor(Math.abs(ms) / 60000);
    var d = Math.floor(total / 1440);
    var h = Math.floor((total % 1440) / 60);
    var m = total % 60;
    var parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (!d && (m || !parts.length)) parts.push(m + 'm');
    var txt = parts.join(' ');
    var cls = '';
    if (overdue) cls = 'ssb-red';
    else if (ms < 24 * 3600 * 1000) cls = 'ssb-orange';
    else if (ms < 72 * 3600 * 1000) cls = 'ssb-yellow';
    if (estimated) cls = (cls + ' ssb-est').trim();
    return {
      date: (estimated ? '~ ' : '') + fmtDate(ts),
      text: (overdue ? 'overdue by ' : 'in ') + txt,
      cls: cls
    };
  }

  // Compact remainder: one short number - days (d), under a day hours (h), then minutes (m).
  // The exact date goes into the tooltip so it does not eat a column of the layout.
  function fmtLeftShort(ts, now, estimated) {
    if (!ts) return { text: '—', cls: 'ssb-muted', title: 'no deadline' };
    var ms = ts - now;
    var overdue = ms < 0;
    var abs = Math.abs(ms);
    var d = Math.floor(abs / 86400000);
    var txt;
    if (d >= 1) txt = d + 'd';
    else {
      var h = Math.floor(abs / 3600000);
      txt = h >= 1 ? h + 'h' : Math.floor(abs / 60000) + 'm';
    }
    // overdue and up to 1 day -> red; over 1 and up to 3 days -> yellow
    var cls = '';
    if (overdue || ms <= 24 * 3600 * 1000) cls = 'ssb-red';
    else if (ms <= 72 * 3600 * 1000) cls = 'ssb-yellow';
    if (estimated) cls = (cls + ' ssb-est').trim();
    return {
      text: (overdue ? '-' : '') + txt,
      cls: cls,
      title: (estimated ? '~ ' : '') + fmtDate(ts) + (overdue ? ' · overdue' : '')
    };
  }

  // The contract id is a link - it opens the native CONT <localId> buffer.
  // It is green when the material for the condition is in stock at that location.
  function idCell(r, withFulfill) {
    var cls = 'ssb-link' + (r && r.stockOk ? ' ssb-ok' : '');
    var title = (r && r.stockText) ? ' title="' + esc(r.stockText) + '"' : '';
    return '<td class="ssb-id"><span class="' + cls + '" data-cmd="CONT ' + esc(r.localId) + '"' +
      title + '>#' + esc(r.localId) + '</span>' +
      (withFulfill ? fulfillButtonHtml(r) : '') + '</td>';
  }

  // ─────────────────────────────────────────────────────────────
  //  FULFILL straight from the buffer
  //
  //  The game has no external API for fulfilling a condition - the only
  //  reliable path is the real button in the CONT buffer. So this button
  //  opens CONT hidden, finds THE ROW OF EXACTLY THAT CONDITION and presses
  //  its FULFILL, then closes the buffer.
  //
  //  Row <-> condition mapping (verified live 14.09.2026):
  //  every condition is a <tr> whose first cell is "#N", where
  //  N = cond.index + 1 (the UI counts from 1, the store from 0).
  //  The button is disabled through the CLASS `Button__disabled___`, NOT through
  //  the disabled attribute - `b.disabled` is false even when it is greyed out.
  // ─────────────────────────────────────────────────────────────

  var _btnCls = null;

  // The real button classes are taken from the game stylesheets,
  // so it looks the same as FULFILL inside the contract.
  function gameBtnClass() {
    if (_btnCls) return _btnCls;
    var found = { btn: '', success: '' };
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
        for (var j = 0; j < rules.length; j++) {
          var sel = rules[j].selectorText;
          if (!sel || sel.indexOf('Button__') < 0) continue;
          var mb = sel.match(/Button__btn___[A-Za-z0-9_-]+/);
          if (mb && !found.btn) found.btn = mb[0];
          var ms = sel.match(/Button__success___[A-Za-z0-9_-]+/);
          if (ms && !found.success) found.success = ms[0];
          if (found.btn && found.success) break;
        }
        if (found.btn && found.success) break;
      }
    } catch (e2) { /* ignore */ }
    _btnCls = found;
    return _btnCls;
  }

  function fulfillButtonHtml(r) {
    var g = gameBtnClass();
    var cls = 'ssb-ff' + (g.btn ? ' ' + g.btn : '') + (g.success ? ' ' + g.success : '');
    var kind = PAY_FULFILL_TYPES[r.type] ? 'money' : SHIPMENT_TYPES[r.type] ? 'place' : 'units';
    var amt = kind === 'money' ? (r.amount == null ? '' : r.amount)
            : kind === 'place' ? (r.place || '')
                               : (r.needAmount == null ? '' : r.needAmount);
    return '<span class="' + cls + '" data-cid="' + esc(r.localId) + '" data-idx="' + r.index +
      '" data-amt="' + amt + '" data-kind="' + kind +
      '" title="Fulfill this condition">FULFILL</span>';
  }

  // Opens a buffer with a command and hands the created window to the callback
  function openCommand(command, cb, hidden) {
    var create = document.querySelector('[class*="Dock__create"]');
    if (!create) { if (cb) cb(null); return; }
    var before = [].slice.call(document.querySelectorAll('[class*="Window__window"]'));
    create.click();
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var wins = [].slice.call(document.querySelectorAll('[class*="Window__window"]'));
      var fresh = wins.filter(function (w) { return before.indexOf(w) < 0; })[0];
      if (fresh && hidden) fresh.style.visibility = 'hidden';
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

  function closeWindow(win) {
    if (!win || !win.isConnected) return;
    var btns = [].slice.call(win.querySelectorAll('[class*="Window__button"]'));
    var x = btns.filter(function (b) { return b.textContent.trim().toLowerCase() === 'x'; })[0];
    if (x) x.click();
  }

  // The condition row in the CONT buffer: the first cell is "#N", N = index + 1.
  // Cross-checked by amount ("of 3 units of ..."), because CONT writes the full
  // material name ("Fuel-saving STL Engine") while the store keeps a ticker (FSE) and
  // an internal name (fuelSavingEngine) - the material cannot be matched by text.
  function conditionRow(win, index, amount, kind) {
    var rows = [].slice.call(win.querySelectorAll('tr'));
    var want = '#' + (index + 1);
    for (var i = 0; i < rows.length; i++) {
      var td = rows[i].querySelector('td');
      if (!td || td.textContent.trim() !== want) continue;
      if (kind === 'place') {
        if (amount && !rowHasPlace(rows[i].textContent, amount)) return null;
      } else if (amount && !rowHasAmount(rows[i].textContent, amount, kind)) return null;
      return rows[i];
    }
    return null;
  }

  // Shipment rows carry the place: "Pick up shipment (1.68t / 2.10m³) @ Moria Station (Moria)",
  // "Deliver shipment @ Neo Eden - Nemesis (JS-299a)" (verified live 22.09.2026).
  function rowHasPlace(text, place) {
    var norm = function (x) { return String(x).replace(/\s+/g, ' ').trim().toUpperCase(); };
    return !!place && norm(text).indexOf(norm(place)) >= 0;
  }

  // Material rows say "of 3 units of ...", money rows a grouped amount
  // ("Payment of 1,056,840 NCC"). For money the numbers are compared, not the text,
  // so we do not depend on the separator format.
  function rowHasAmount(text, amount, kind) {
    var txt = String(text).replace(/\s+/g, ' ');
    // Trap: the game groups thousands ("Delivery of 2,000 units"), so the numbers
    // are compared numerically, not as text. For materials the anchor is the word
    // "unit", so the deadline or another number from the row is not picked up.
    var re = kind === 'money' ? /\d[\d.,\u00a0 ]*\d|\d/g
                              : /(\d[\d.,\u00a0 ]*\d|\d)\s*unit/gi;
    var m;
    while ((m = re.exec(txt)) !== null) {
      var n = normalizeNumber(kind === 'money' ? m[0] : m[1]);
      if (n !== null && sameMoney(n, amount)) return true;
    }
    return false;
  }

  // CONT TRUNCATES the cents when displaying: 2 508 797.50 comes out as
  // "Payment of 2,508,797 NCC". So besides the exact match, the rounded and
  // the truncated value are accepted too - otherwise the button refused payments.
  function sameMoney(shown, amount) {
    if (Math.abs(shown - amount) < 0.005) return true;
    if (shown === Math.floor(amount)) return true;
    if (shown === Math.round(amount)) return true;
    return false;
  }

  // "1,056,840.00" / "1 056 840,00" / "1056840" -> number
  function normalizeNumber(tok) {
    var t = tok.replace(/[\u00a0 ]/g, '');
    var lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
    var dec = Math.max(lastDot, lastComma);
    var frac = '';
    if (dec >= 0 && t.length - dec - 1 <= 2 && t.length - dec - 1 > 0) {
      frac = t.slice(dec + 1);
      t = t.slice(0, dec);
    }
    t = t.replace(/[.,]/g, '');
    if (!/^\d+$/.test(t)) return null;
    var v = parseFloat(t + (frac ? '.' + frac : ''));
    return isNaN(v) ? null : v;
  }

  function fulfillFromBuffer(btn) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.textContent = '…';

    var cid = btn.getAttribute('data-cid');
    var idx = parseInt(btn.getAttribute('data-idx'), 10);
    var kind = btn.getAttribute('data-kind') || 'units';
    var amt = kind === 'place' ? (btn.getAttribute('data-amt') || '')
                               : (parseFloat(btn.getAttribute('data-amt')) || 0);

    function give(text, keepOpen, win, why) {
      btn.textContent = text;
      btn.dataset.busy = '0';
      if (why) btn.title = why;
      if (!keepOpen) closeWindow(win);
      setTimeout(function () { scan(); renderAll(); }, 1200);
    }

    openCommand('CONT ' + cid, function (win) {
      if (!win) { give('?', false, null, 'Could not open the contract buffer'); return; }
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        var row = conditionRow(win, idx, amt, kind);
        if (row) {
          clearInterval(t);
          var fb = [].slice.call(row.querySelectorAll('button, [class*="Button__btn"]')).filter(function (b) {
            return b.textContent.trim().toUpperCase() === 'FULFILL';
          })[0];
          if (!fb) { win.style.visibility = ''; give('open', true, win, 'No FULFILL button on that condition — check the contract'); return; }
          if (/Button__disabled/.test(fb.className)) {
            win.style.visibility = '';
            give('open', true, win, 'The game says this condition cannot be fulfilled yet');
            return;
          }
          fb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          setTimeout(function () { give('✓', false, win); }, 400);
        } else if (tries > 80) {
          clearInterval(t);
          win.style.visibility = '';
          give('open', true, win, 'Could not match the condition row — fulfil it by hand');
        }
      }, 50);
    }, true);
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('.ssb-ff[data-cid]');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    fulfillFromBuffer(b);
  }, true);

  document.addEventListener('click', function (ev) {
    var link = ev.target && ev.target.closest && ev.target.closest('.ssb-link[data-cmd]');
    if (!link) return;
    ev.preventDefault();
    ev.stopPropagation();
    openCommand(link.getAttribute('data-cmd'));
  }, true);

  // ─────────────────────────────────────────────────────────────
  //  Styles
  // ─────────────────────────────────────────────────────────────
  var CSS = [
    '.ssb-root{font-family:inherit;font-size:12px;color:#c8c8c8;padding:4px 6px 10px;box-sizing:border-box;min-height:100%;}',
    '.ssb-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:2px 2px 6px;border-bottom:1px solid #2f2f2f;margin-bottom:6px;}',
    '.ssb-head b{color:#f0a500;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;}',
    '.ssb-sub{color:#7a7a7a;}',
    '.ssb-sec{margin-top:12px;color:#9a9a9a;font-size:11px;letter-spacing:.6px;text-transform:uppercase;padding:0 2px 3px;border-bottom:1px solid #2f2f2f;display:flex;justify-content:space-between;gap:10px;}',
    '.ssb-sec span:last-child{color:#f0a500;font-variant-numeric:tabular-nums;letter-spacing:0;}',
    '.ssb-table{width:100%;border-collapse:collapse;}',
    '.ssb-table th{text-align:left;color:#6f6f6f;font-weight:400;padding:3px 6px;border-bottom:1px solid #2f2f2f;white-space:nowrap;}',
    '.ssb-table td{padding:2px 6px;border-bottom:1px solid #1e1e1e;white-space:nowrap;}',
    '.ssb-num{text-align:right;font-variant-numeric:tabular-nums;}',
    '.ssb-grp td{background:#1e1e1e;color:#e0e0e0;font-weight:600;border-top:1px solid #2f2f2f;padding-top:4px;}',
    '.ssb-grp .ssb-num{color:#f0a500;}',
    '.ssb-id{color:#6f6f6f;padding-left:16px !important;}',
    '.ssb-red{color:#e05c5c;}',
    '.ssb-orange{color:#e08a3c;}',
    '.ssb-yellow{color:#d9c04a;}',
    '.ssb-muted{color:#6f6f6f;}',
    '.ssb-empty{color:#7a7a7a;padding:10px 4px;line-height:1.5;}',
    '.ssb-est{opacity:.55;font-style:italic;}',
    '.ssb-int{color:#9a9a9a;}',
    '.ssb-link{cursor:pointer;color:#8f8f8f;}',
    '.ssb-link.ssb-ok{color:#5aa469;}',
    '.ssb-ff{float:right;margin-left:10px;padding:0 8px;cursor:pointer;'
      + 'font:700 11px/17px Arial,Helvetica,sans-serif;text-transform:uppercase;'
      + 'color:#fff;background:#5cb85c;border:0;border-radius:0;vertical-align:middle;}',
    '.ssb-ff:hover{background:#6ec46e;}',
    '.ssb-link:hover{color:#f0a500;text-decoration:underline;}',
    '.ssb-tight th,.ssb-tight td{padding:1px 5px;}',
    '.ssb-ready{color:#5aa469;}',
    '.ssb-wait{color:#6f6f6f;}',
    '.ssb-cmd{color:#f0a500;font-family:monospace;padding-right:14px !important;}',
    '.ssb-foot{margin-top:10px;color:#5a5a5a;font-size:11px;}',
    '.ssb-grp[data-grp]{cursor:pointer;user-select:none;}',
    '.ssb-grp[data-grp]:hover td{background:#262626;}',
    '.ssb-tg{display:inline-block;width:14px;margin-right:4px;color:#f0a500;font-weight:700;text-align:center;}',
    '.ssb-all{margin-left:10px;color:#f0a500;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;}',
    '.ssb-all:hover{text-decoration:underline;}',
    '.ssb-row.ssb-hid{display:none;}',
    '.ssb-opt{margin-left:auto;color:#8f8f8f;cursor:pointer;user-select:none;white-space:nowrap;}',
    '.ssb-opt:hover{color:#f0a500;}',
    '.ssb-ffn{color:#5cb85c;font-weight:700;}',
    '.ssb-cb{vertical-align:-2px;margin:0 5px 0 0;accent-color:#5cb85c;pointer-events:none;}',
    '.ssb-upd{background:#2b2718;border:1px solid #6b5d1f;color:#d9c04a;padding:4px 8px;margin:0 0 6px;line-height:1.5;}',
    '.ssb-upd a{color:#f0a500;text-decoration:underline;}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('ssb-style')) return;
    var s = document.createElement('style');
    s.id = 'ssb-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─────────────────────────────────────────────────────────────
  //  Rendering
  // ─────────────────────────────────────────────────────────────
  function buildTable(groups, now, isLoan, sec) {
    var t = document.createElement('table');
    t.className = 'ssb-table';
    t.setAttribute('data-sec', sec);
    t.innerHTML = isLoan
      ? '<thead><tr><th>Partner / contract</th><th class="ssb-num">Principal</th>' +
        '<th class="ssb-num">Interest</th><th class="ssb-num">Total</th><th>Deadline</th><th>Left</th></tr></thead>'
      : '<thead><tr><th>Partner / contract</th><th class="ssb-num">Amount</th>' +
        '<th>Deadline</th><th>Left</th></tr></thead>';
    var tb = document.createElement('tbody');

    groups.forEach(function (g) {
      var gr = document.createElement('tr');
      gr.className = 'ssb-grp';
      gr.setAttribute('data-grp', grpKey(sec, g));
      var head = '<span class="ssb-tg">+</span>' + esc(g.partner) +
        ' <span class="ssb-muted">(' + g.rows.length + ')</span>';
      gr.innerHTML = isLoan
        ? '<td>' + head + '</td>' +
          '<td class="ssb-num">' + esc(fmtMoney(g.principal || 0)) + '</td>' +
          '<td class="ssb-num">' + esc(fmtMoney(g.interest || 0)) + '</td>' +
          '<td class="ssb-num">' + esc(fmtTotals(g.totals)) + '</td>' +
          '<td colspan="2"></td>'
        : '<td>' + head + '</td>' +
          '<td class="ssb-num">' + esc(fmtTotals(g.totals)) + '</td>' +
          '<td colspan="2"></td>';
      tb.appendChild(gr);

      g.rows.forEach(function (r) {
        var left = fmtLeft(r.deadline, now, r.estimated);
        var cur = r.currency ? ' ' + r.currency : '';
        var tr = document.createElement('tr');
        tr.className = 'ssb-row';
        tr.setAttribute('data-grp', grpKey(sec, g));
        tr.innerHTML = idCell(r) +
          (isLoan
            ? '<td class="ssb-num">' + esc(r.principal ? fmtMoney(r.principal) : '—') + '</td>' +
              '<td class="ssb-num ssb-int">' + esc(r.interest ? fmtMoney(r.interest) : '—') + '</td>'
            : '') +
          '<td class="ssb-num">' + esc(fmtMoney(r.amount) + cur) + '</td>' +
          '<td class="' + left.cls + '">' + esc(left.date) + '</td>' +
          '<td class="' + left.cls + '">' + esc(left.text) + '</td>';
        tb.appendChild(tr);
      });
    });

    t.appendChild(tb);
    applyGroupState(t, sec);
    return t;
  }

  // ─────────────────────────────────────────────────────────────
  //  Collapsing the partner groups (since 3.5)
  //
  //  Collapsed by default. The state lives in page memory so it survives the
  //  30 s re-render and store changes; on a page reload everything is collapsed
  //  again. The key is <section>|<partnerKey>.
  // ─────────────────────────────────────────────────────────────
  var _grpOpen = {};

  // Rows with an enabled FULFILL can be kept out of the collapsing, so that what
  // can be done right now never hides behind a plus. Several people found that
  // noisy, so it is a setting - off by default - and it is remembered per browser.
  var FF_ALWAYS_KEY = 'ssb-ff-always';
  var _ffAlways = (function () {
    try { return localStorage.getItem(FF_ALWAYS_KEY) === '1'; } catch (e) { return false; }
  })();

  function setFfAlways(v) {
    _ffAlways = !!v;
    try { localStorage.setItem(FF_ALWAYS_KEY, _ffAlways ? '1' : '0'); } catch (e) {}
  }

  function ffToggleHTML() {
    return '<span class="ssb-opt" data-opt="ff-always" ' +
      'title="When on, a row whose FULFILL is enabled stays visible even if its partner group is collapsed">' +
      '<input type="checkbox" class="ssb-cb"' + (_ffAlways ? ' checked' : '') + '>' +
      'FULFILL rows always visible</span>';
  }

  function grpKey(sec, g) { return sec + '|' + (g.key || g.partner); }
  function isOpen(sec, g) { return !!_grpOpen[grpKey(sec, g)]; }

  function secHeader(sec, label, right) {
    return '<div class="ssb-sec" data-sec="' + esc(sec) + '"><span>' + label +
      '<span class="ssb-all" data-sec="' + esc(sec) + '" title="Expand / collapse all partners">[+] all</span>' +
      '</span><span>' + (right || '') + '</span></div>';
  }

  // Applies the state to an already built table (no re-render)
  function applyGroupState(table, sec) {
    var allOpen = true, any = false;
    [].slice.call(table.querySelectorAll('tr.ssb-grp[data-grp]')).forEach(function (gr) {
      any = true;
      var open = !!_grpOpen[gr.getAttribute('data-grp')];
      if (!open) allOpen = false;
      var tg = gr.querySelector('.ssb-tg');
      if (tg) tg.textContent = open ? '-' : '+';
      gr.title = open ? 'Collapse' : 'Expand';
    });
    [].slice.call(table.querySelectorAll('tr.ssb-row[data-grp]')).forEach(function (tr) {
      // With the setting on, a row whose FULFILL is enabled survives the collapse;
      // with it off the group hides everything, FULFILL or not.
      var keep = _ffAlways && tr.querySelector('.ssb-ff');
      var hide = !_grpOpen[tr.getAttribute('data-grp')] && !keep;
      tr.classList.toggle('ssb-hid', hide);
    });
    var root = table.parentElement;
    var btn = root && root.querySelector('.ssb-all[data-sec="' + sec + '"]');
    if (btn) btn.textContent = (any && allOpen) ? '[-] all' : '[+] all';
  }

  function toggleGroup(key, table, sec) {
    _grpOpen[key] = !_grpOpen[key];
    applyGroupState(table, sec);
  }

  function toggleSection(sec, root) {
    var table = root.querySelector('table[data-sec="' + sec + '"]');
    if (!table) return;
    var grps = [].slice.call(table.querySelectorAll('tr.ssb-grp[data-grp]'));
    var allOpen = grps.length && grps.every(function (gr) { return !!_grpOpen[gr.getAttribute('data-grp')]; });
    grps.forEach(function (gr) { _grpOpen[gr.getAttribute('data-grp')] = !allOpen; });
    applyGroupState(table, sec);
  }

  // The "all" button is outside the table and is not in the DOM while it is built - refreshed after render
  function refreshGroupButtons(root) {
    [].slice.call(root.querySelectorAll('table[data-sec]')).forEach(function (t) {
      applyGroupState(t, t.getAttribute('data-sec'));
    });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var opt = t.closest('.ssb-opt[data-opt="ff-always"]');
    if (opt) {
      ev.preventDefault(); ev.stopPropagation();
      setFfAlways(!_ffAlways);
      var cb = opt.querySelector('.ssb-cb');
      if (cb) cb.checked = _ffAlways;
      var rt = opt.closest('.ssb-root');
      if (rt) refreshGroupButtons(rt);
      return;
    }
    var all = t.closest('.ssb-all[data-sec]');
    if (all) {
      ev.preventDefault(); ev.stopPropagation();
      toggleSection(all.getAttribute('data-sec'), all.closest('.ssb-root'));
      return;
    }
    var gr = t.closest('tr.ssb-grp[data-grp]');
    if (gr) {
      ev.preventDefault(); ev.stopPropagation();
      var table = gr.closest('table');
      toggleGroup(gr.getAttribute('data-grp'), table, table.getAttribute('data-sec'));
    }
  }, true);

  function sumTotals(rows) {
    var t = {};
    rows.forEach(function (r) { t[r.currency] = (t[r.currency] || 0) + r.amount; });
    return t;
  }

  // ─────────────────────────────────────────────────────────────
  //  Subcommand VZEM - receivables on contracts
  // ─────────────────────────────────────────────────────────────
  function renderVZEM(root) {
    var data = collect();
    if (data === null) {
      root.innerHTML = '<div class="ssb-empty">Contract data is not loaded yet.<br>' +
        'Open a <b>CONTS</b> buffer once, then reload this buffer.</div>';
      return;
    }

    var now = Date.now();
    var all = data.pay.concat(data.loan);
    var overdue = all.filter(function (r) { return r.deadline && r.deadline < now; }).length;

    var head = document.createElement('div');
    head.className = 'ssb-head';
    head.innerHTML = '<b>' + (all.length ? esc(fmtTotals(sumTotals(all))) : '0,00') + '</b>' +
      '<span class="ssb-sub">total receivable · ' + all.length + (all.length === 1 ? ' item' : ' items') + '</span>' +
      (overdue ? '<span class="ssb-red">overdue: ' + overdue + '</span>' : '');
    root.appendChild(head);

    if (!all.length) {
      root.insertAdjacentHTML('beforeend',
        '<div class="ssb-empty">No outstanding receivables on active contracts.</div>');
    }

    if (data.pay.length) {
      root.insertAdjacentHTML('beforeend', secHeader('vzem-pay', 'Contract payments', esc(fmtTotals(sumTotals(data.pay)))));
      root.appendChild(buildTable(groupByPartner(data.pay), now, false, 'vzem-pay'));
    }

    if (data.loan.length) {
      root.insertAdjacentHTML('beforeend', secHeader('vzem-loan', 'Loan installments', esc(fmtTotals(sumTotals(data.loan)))));
      root.appendChild(buildTable(groupByPartner(data.loan), now, true, 'vzem-loan'));
    }
    refreshGroupButtons(root);
  }

  // ─────────────────────────────────────────────────────────────
  //  Subcommand PART - outstanding contract conditions
  //
  //  A mirror of XIT CONTC, but turned to the other side: what I
  //  EXPECT the partners to fulfil. Money (PAYMENT, LOAN_PAYOUT,
  //  LOAN_INSTALLMENT) is not there - it is tracked in SSB VZEM.
  //  In the section with my own obligations money IS included, because it is
  //  not tracked anywhere else.
  // ─────────────────────────────────────────────────────────────
  var MONEY_TYPES = { PAYMENT: 1, LOAN_PAYOUT: 1, LOAN_INSTALLMENT: 1 };

  // In "My obligations" only the conditions I CAN act on right now are shown - those
  // whose dependencies are fulfilled. The rest wait on the partner and are just noise.
  // false => show everything, as before v2.6.
  var MINE_ONLY_ACTIONABLE = true;

  // Type names are as Refined PrUn writes them (friendlyConditionText in CONTS/utils.ts)
  var TYPE_LABEL = {
    BASE_CONSTRUCTION: 'Construct Base',
    COMEX_PURCHASE_PICKUP: 'Material Pickup',
    CONSTRUCT_SHIP: 'Construct Ship',
    CONTRIBUTION: 'Contribution',
    DELIVERY: 'Delivery',
    DELIVERY_SHIPMENT: 'Deliver Shipment',
    EXPLORATION: 'Exploration',
    FINISH_FLIGHT: 'Finish Flight',
    GATEWAY_FUEL: 'Gateway Fuel',
    HEADQUARTERS_UPGRADE: 'Upgrade HQ',
    INFRASTRUCTURE_CONSTRUCTION_FINISH: 'Infra Build Finish',
    INFRASTRUCTURE_CONSTRUCTION_START: 'Infra Build Start',
    INFRASTRUCTURE_UPGRADE_FINISH: 'Infra Upgrade Finish',
    INFRASTRUCTURE_UPGRADE_START: 'Infra Upgrade Start',
    INFRASTRUCTURE_UPKEEP: 'Infra Upkeep',
    LOAN_INSTALLMENT: 'Loan Installment',
    LOAN_PAYOUT: 'Loan Payout',
    PAYMENT: 'Payment',
    PICKUP: 'Pickup',
    PICKUP_SHIPMENT: 'Pickup Shipment',
    PLACE_ORDER: 'Place Order',
    POWER: 'Become Governor',
    PRODUCTION_ORDER_COMPLETED: 'Complete Production Order',
    PRODUCTION_RUN: 'Run Production',
    PROVISION: 'Provision',
    PROVISION_SHIPMENT: 'Provision Shipment',
    REPAIR_SHIP: 'Repair Ship',
    REPUTATION: 'Reputation',
    START_FLIGHT: 'Start Flight',
    WORKFORCE_PROGRAM_PAYMENT: 'WF Payment',
    WORKFORCE_PROGRAM_START: 'WF Program Start'
  };

  var COND_STATUS_BG = {
    PARTLY_FULFILLED: 'partial',
    FULFILLMENT_ATTEMPTED: 'attempted',
    VIOLATED: 'violated'
  };

  // ─────────────────────────────────────────────────────────────
  //  Stock: do I have the material to fulfil the condition
  //
  //  Verified live (2026-09-13) in the APEX store:
  //    ['storage','stores']       — Map id -> Store (addressableId, items, type)
  //    ['address','addressable']  - Map addressableId -> Address (may be null)
  //  A store does NOT carry an address; it comes from the second map by addressableId.
  //  A ship in flight has a null address -> its cargo is not counted anywhere, which is
  //  the correct behaviour (it is not at the destination).
  // ─────────────────────────────────────────────────────────────

  // Condition types where I GIVE the material (so I must have it).
  // COMEX_PURCHASE_PICKUP is the opposite - there the material is received.
  var MATERIAL_OUT_TYPES = { DELIVERY: 1, PROVISION: 1, PROVISION_SHIPMENT: 1 };

  // Conditions that get a FULFILL button. Material ones - only when the goods are
  // in stock (green id). Shipments and pickups (PICKUP_SHIPMENT, DELIVERY_SHIPMENT,
  // PICKUP, COMEX_PURCHASE_PICKUP) - when I have a store or ship on site, and for a shipment
  // delivery when the shipment itself is in a store of mine there (since 3.4). Payments - always,
  // because the available money is not read from the store: if it is short, the game greys out its
  // own button and the script refuses to press it. LOAN_INSTALLMENT is excluded - loan installments are automatic.
  var PAY_FULFILL_TYPES = { PAYMENT: 1, LOAN_PAYOUT: 1 };
  // Shipments: the CONT row has no amount ("Deliver shipment @ Neo Eden - Nemesis (JS-299a)"),
  // so the second value to cross-check is the name of the place.
  var SHIPMENT_TYPES = { PICKUP_SHIPMENT: 1, DELIVERY_SHIPMENT: 1 };

  function canFulfill(r) {
    return !!(r && (r.stockOk || PAY_FULFILL_TYPES[r.type]));
  }
  var SKIP_STORE_TYPES = { CONSTRUCTION_STORE: 1, UPKEEP_STORE: 1 };

  var _storesPath = null;
  var _addrPath = null;
  var _storageTried = 0;   // a failed search is not repeated on every render

  function looksLikeStores(node) {
    var vals = valuesOf(node);
    if (!vals || !vals.length) return false;
    var s = plain(vals[0]);
    return !!(s && typeof s === 'object' && s.addressableId && Array.isArray(s.items));
  }

  // The values here are the addresses themselves ({lines:[...]}), and some of them are null
  function looksLikeAddressIndex(node) {
    var vals = valuesOf(node);
    if (!vals || !vals.length) return false;
    for (var i = 0; i < vals.length && i < 50; i++) {
      var v = plain(vals[i]);
      if (!v) continue;
      return !!(v.lines && v.lines.length && v.lines[0] && v.lines[0].entity);
    }
    return false;
  }

  function discoverPathBy(state, test) {
    var queue = [{ node: state, path: [] }], guard = 0;
    while (queue.length && guard < 6000) {
      var cur = queue.shift(); guard++;
      try { if (test(cur.node)) return cur.path; } catch (e) { continue; }
      if (cur.path.length >= 4) continue;
      var node = cur.node, keys = null;
      if (node && typeof node.keySeq === 'function') keys = node.keySeq().toArray();
      else if (node && typeof node === 'object' && !Array.isArray(node)) keys = Object.keys(node);
      if (!keys) continue;
      for (var i = 0; i < keys.length && i < 80; i++) {
        var child;
        try { child = (typeof node.get === 'function') ? node.get(keys[i]) : node[keys[i]]; } catch (e2) { continue; }
        if (child && typeof child === 'object') queue.push({ node: child, path: cur.path.concat([keys[i]]) });
      }
    }
    return null;
  }

  function resolvePath(state, cached, guesses, test) {
    if (cached) { try { if (test(getIn(state, cached))) return cached; } catch (e) {} }
    for (var i = 0; i < guesses.length; i++) {
      try { if (test(getIn(state, guesses[i]))) return guesses[i]; } catch (e2) {}
    }
    return discoverPathBy(state, test);
  }

  // Location key - id of the planet/station from the address
  function addressKey(addr) {
    if (!addr || !addr.lines) return null;
    var last = null;
    for (var i = 0; i < addr.lines.length; i++) {
      var l = addr.lines[i];
      if (!l || !l.entity) continue;
      last = l.entity;
      if (l.type === 'PLANET' || l.type === 'STATION') return l.entity.id;
    }
    return last ? last.id : null;
  }

  // { locationId: { TICKER: amount } }, plus the location names
  var _locNames = {};

  function buildStock() {
    var st = getStore();
    if (!st) return null;
    var state;
    try { state = st.getState(); } catch (e) { return null; }

    var storesOk = _storesPath && looksLikeStores(getIn(state, _storesPath));
    var addrOk = _addrPath && looksLikeAddressIndex(getIn(state, _addrPath));
    if (!storesOk || !addrOk) {
      if (Date.now() - _storageTried < 60000) return null;
      _storageTried = Date.now();
      _storesPath = resolvePath(state, _storesPath, [['storage', 'stores']], looksLikeStores);
      _addrPath = resolvePath(state, _addrPath, [['address', 'addressable']], looksLikeAddressIndex);
    }
    if (!_storesPath || !_addrPath) return null;

    // addressableId -> location id
    var idx = getIn(state, _addrPath);
    var keys = (idx && typeof idx.keySeq === 'function') ? idx.keySeq().toArray()
             : (idx ? Object.keys(idx) : []);
    var where = {};
    _locNames = {};
    for (var k = 0; k < keys.length; k++) {
      var a;
      try { a = plain((typeof idx.get === 'function') ? idx.get(keys[k]) : idx[keys[k]]); } catch (e3) { continue; }
      var loc = addressKey(a);
      if (!loc) continue;                       // ship in flight -> null address
      where[keys[k]] = loc;
      if (!_locNames[loc]) _locNames[loc] = fmtAddress(a);
    }

    var stock = {};
    // places: locId -> names of my stores there (ship, base, rented warehouse);
    // shipments: id of a SHPT item -> { loc, store } (shipments have no quantity, only id/type/weight/volume)
    var places = {}, shipments = {};
    var stores = valuesOf(getIn(state, _storesPath)) || [];
    for (var s = 0; s < stores.length; s++) {
      var store = plain(stores[s]);
      if (!store || SKIP_STORE_TYPES[store.type]) continue;
      var locId = where[store.addressableId] || null;   // null = ship in flight
      var bag = locId ? (stock[locId] || (stock[locId] = {})) : null;
      if (locId && !FUEL_STORE_TYPES[store.type]) {
        (places[locId] || (places[locId] = [])).push(storeLabel(store));
      }
      var list = store.items || [];
      for (var j = 0; j < list.length; j++) {
        var item = plain(list[j]);
        if (item && item.type === 'SHIPMENT' && item.id) {
          shipments[item.id] = { loc: locId, store: storeLabel(store) };
          continue;
        }
        if (!bag) continue;
        var q = plain(item && item.quantity);
        if (!q || !q.material || !q.material.ticker || typeof q.amount !== 'number') continue;
        bag[q.material.ticker] = (bag[q.material.ticker] || 0) + q.amount;
      }
    }
    return { stock: stock, places: places, shipments: shipments };
  }

  var FUEL_STORE_TYPES = { STL_FUEL_STORE: 1, FTL_FUEL_STORE: 1, VORTEX_FUEL_STORE: 1 };

  function storeLabel(store) {
    if (store.name) return store.name;
    return store.type === 'WAREHOUSE_STORE' ? 'warehouse' : store.type === 'SHIP_STORE' ? 'ship' : 'base';
  }

  // The name of the most specific level of the address (Nemesis / Moria Station) - this
  // is the second value used to cross-check the CONT row for shipments.
  function placeName(addr) {
    if (!addr || !addr.lines) return '';
    var best = null;
    for (var i = 0; i < addr.lines.length; i++) if (addr.lines[i] && addr.lines[i].entity) best = addr.lines[i].entity;
    return best ? (best.name || best.naturalId || '') : '';
  }

  // The address is a list of levels (SYSTEM / PLANET / STATION) - take the most specific
  function fmtAddress(addr) {
    if (!addr || !addr.lines || !addr.lines.length) return '';
    var best = null;
    for (var i = 0; i < addr.lines.length; i++) {
      if (addr.lines[i] && addr.lines[i].entity) best = addr.lines[i];
    }
    if (!best) return '';
    var nid = best.entity.naturalId || '';
    var nm = best.entity.name || '';
    if (nm && nid && nm !== nid) return nm + ' (' + nid + ')';
    return nm || nid;
  }

  function fmtQty(q) {
    if (!q) return '';
    var t = (q.material && (q.material.ticker || q.material.name)) || '';
    return (q.amount != null ? q.amount + ' ' : '') + t;
  }

  // The condition text - a port of ConditionText.vue from Refined PrUn
  function condText(cond) {
    var at = cond.address ? ' @ ' + fmtAddress(cond.address) : '';
    var a;
    switch (cond.type) {
      case 'DELIVERY':
        return 'Deliver ' + fmtQty(cond.quantity) + at;
      case 'PROVISION':
      case 'PROVISION_SHIPMENT':
        return 'Provision ' + fmtQty(cond.quantity) + at;
      case 'PICKUP':
        return 'Pick up ' + fmtQty(cond.quantity) + at;
      case 'COMEX_PURCHASE_PICKUP':
        var left = cond.quantity
          ? cond.quantity.amount - ((cond.pickedUp && cond.pickedUp.amount) || 0)
          : null;
        var tick = (cond.quantity && cond.quantity.material && cond.quantity.material.ticker) || '';
        return 'Pick up ' + (left !== null ? left + ' ' : '') + tick + at;
      case 'DELIVERY_SHIPMENT':
        return 'Deliver SHPT' + (cond.destination ? ' @ ' + fmtAddress(cond.destination) : at);
      case 'PICKUP_SHIPMENT':
        return 'Pick up SHPT' + at;
      case 'EXPLORATION':
        return 'Explore' + at;
      case 'GATEWAY_FUEL':
        return 'Refuel ' + ((cond.gatewayId && (cond.gatewayId.name || cond.gatewayId.naturalId)) || 'gateway');
      case 'INFRASTRUCTURE_UPKEEP':
        return 'Upkeep ' + ((cond.infrastructureId && (cond.infrastructureId.name || cond.infrastructureId.naturalId)) || 'infrastructure');
      case 'PAYMENT':
      case 'LOAN_PAYOUT':
        a = cond.amount;
        return 'Pay ' + (a ? fmtMoney(a.amount) + (a.currency ? ' ' + a.currency : '') : '');
      case 'LOAN_INSTALLMENT':
        a = cond.total || cond.repayment;
        return 'Loan installment ' + (a ? fmtMoney(a.amount) + (a.currency ? ' ' + a.currency : '') : '');
      default:
        return (TYPE_LABEL[cond.type] || cond.type) + at;
    }
  }

  // A condition deadline only runs once all dependencies are fulfilled
  function depsReady(contract, cond) {
    var deps = cond.dependencies || [];
    var list = contract.conditions || [];
    for (var i = 0; i < deps.length; i++) {
      var id = deps[i];
      var d = list.find(function (x) { return x.id === id; });
      if (!d || d.status !== 'FULFILLED') return false;
    }
    return true;
  }

  function collectPart() {
    var contracts = getContracts();
    if (contracts === null) return null;

    var st = buildStock();
    var stock = st ? st.stock : null;
    var places = st ? st.places : null;
    var shipments = st ? st.shipments : null;
    var partner = [], mine = [];
    contracts.forEach(function (c) {
      if (!ACTIVE_CONTRACT[c.status]) return;
      (c.conditions || []).forEach(function (cond) {
        if (!UNPAID_CONDITION[cond.status]) return;

        var isMine = cond.party === c.party;
        // The partner's money is a receivable -> tracked in SSB VZEM
        if (!isMine && MONEY_TYPES[cond.type]) return;

        var fixed = (cond.deadline && cond.deadline.timestamp) || null;
        var deadline = fixed || calcDeadline(c, cond, []);
        var amt = MONEY_TYPES[cond.type] ? condAmount(cond) : null;

        // Can I fulfil it right now - do I have the material on site?
        var stockOk = false, stockText = '';
        var ready = depsReady(c, cond);
        var condPlace = cond.destination || cond.address;
        if (isMine && cond.type === 'DELIVERY_SHIPMENT') {
          // The shipment (shipmentItemId) must be in a store of MINE at the destination -
          // ship, base or rented warehouse. Verified live: the item is
          // type 'SHIPMENT' with id = shipmentItemId, without quantity.
          var sLoc = addressKey(condPlace);
          var sWhere = (shipments && cond.shipmentItemId) ? shipments[cond.shipmentItemId] : null;
          if (shipments && sLoc) {
            stockOk = !!(ready && sWhere && sWhere.loc === sLoc);
            stockText = !sWhere ? 'SHPT is not in my stores'
              : sWhere.loc === sLoc ? 'SHPT on site @ ' + fmtAddress(condPlace) + ' (' + sWhere.store + ')'
              : !sWhere.loc ? 'SHPT is in ' + sWhere.store + ' (in flight)'
              : 'SHPT is in ' + sWhere.store + ', not @ ' + fmtAddress(condPlace);
          }
        } else if (isMine && (cond.type === 'PICKUP_SHIPMENT' || cond.type === 'PICKUP' || cond.type === 'COMEX_PURCHASE_PICKUP')) {
          // Pickup (a shipment, goods from a partner or an exchange purchase -
          // COMEX_PURCHASE_PICKUP, since 3.7): needs a store or ship of mine on site
          // and the provision fulfilled. The stock on the partner side is not visible.
          var pLoc = addressKey(condPlace);
          var here = (places && pLoc) ? (places[pLoc] || []) : null;
          if (here !== null) {
            stockOk = !!(ready && here.length);
            stockText = here.length ? (ready ? 'On site @ ' : 'Waiting for partner @ ') + fmtAddress(condPlace) + ': ' + here.join(', ')
                                    : 'No ship or store @ ' + fmtAddress(condPlace);
          }
        } else if (isMine && MATERIAL_OUT_TYPES[cond.type] && cond.quantity && cond.quantity.material) {
          var tick = cond.quantity.material.ticker;
          var need = cond.quantity.amount || 0;
          var locId = addressKey(cond.address || cond.destination);
          var have = (stock && locId && stock[locId]) ? (stock[locId][tick] || 0) : null;
          if (have !== null) {
            stockOk = have >= need;
            stockText = (stockOk ? 'In stock: ' : 'Missing: ') + have + ' / ' + need + ' ' + tick +
              ' @ ' + fmtAddress(cond.address || cond.destination);
          }
        }

        (isMine ? mine : partner).push({
          localId: c.localId || '',
          partner: partnerLabel(c.partner),
          partnerKey: (c.partner && (c.partner.id || c.partner.name)) || '???',
          type: cond.type,
          text: condText(cond),
          status: cond.status,
          ready: ready,
          deadline: deadline,
          estimated: !fixed && deadline !== null,
          stockOk: stockOk,
          stockText: stockText,
          ticker: (cond.quantity && cond.quantity.material && cond.quantity.material.ticker) || '',
          needAmount: (cond.quantity && cond.quantity.amount) || 0,
          place: placeName(condPlace),
          amount: amt ? amt.amount : null,
          currency: amt ? (amt.currency || '') : '',
          index: cond.index || 0
        });
      });
    });
    return { partner: partner, mine: mine };
  }

  function groupConds(rows, now) {
    var map = new Map();
    rows.forEach(function (r) {
      var g = map.get(r.partnerKey);
      if (!g) { g = { key: r.partnerKey, partner: r.partner, rows: [], totals: {}, overdue: 0 }; map.set(r.partnerKey, g); }
      g.rows.push(r);
      if (r.amount) g.totals[r.currency] = (g.totals[r.currency] || 0) + r.amount;
      if (r.deadline && r.deadline < now) g.overdue++;
    });
    var groups = Array.from(map.values());
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) {
        return (a.deadline || Infinity) - (b.deadline || Infinity) || a.index - b.index;
      });
      g.earliest = g.rows.reduce(function (m, r) { return Math.min(m, r.deadline || Infinity); }, Infinity);
    });
    groups.sort(function (a, b) { return a.earliest - b.earliest; });
    return groups;
  }

  function condStatusCell(r) {
    if (COND_STATUS_BG[r.status]) {
      return { text: COND_STATUS_BG[r.status], cls: r.status === 'VIOLATED' ? 'ssb-red' : 'ssb-orange' };
    }
    return r.ready ? { text: 'active', cls: 'ssb-ready' } : { text: 'waiting', cls: 'ssb-wait' };
  }

  function buildCondTable(groups, now, withMoney, sec) {
    var t = document.createElement('table');
    t.className = 'ssb-table ssb-tight';
    t.setAttribute('data-sec', sec);
    t.innerHTML = '<thead><tr><th>Partner / contract</th><th>Condition</th>' +
      (withMoney ? '<th class="ssb-num">Amount</th>' : '') +
      '<th class="ssb-num">Left</th></tr></thead>';
    var tb = document.createElement('tbody');

    groups.forEach(function (g) {
      var n = g.rows.length;
      // How many of them can be done right now. The group row carries it so a
      // collapsed group still says whether there is anything to do inside.
      var nFf = withMoney
        ? g.rows.filter(function (r) { return canFulfill(r); }).length
        : 0;
      var gr = document.createElement('tr');
      gr.className = 'ssb-grp';
      gr.setAttribute('data-grp', grpKey(sec, g));
      gr.innerHTML = '<td><span class="ssb-tg">+</span>' + esc(g.partner) + '</td>' +
        '<td>' + n + (n === 1 ? ' condition' : ' conditions') +
          (nFf ? ' <span class="ssb-ffn">· ' + nFf + ' FULFILL available</span>' : '') +
          (g.overdue ? ' <span class="ssb-red">· ' + g.overdue + ' overdue</span>' : '') + '</td>' +
        (withMoney ? '<td class="ssb-num">' + (Object.keys(g.totals).length ? esc(fmtTotals(g.totals)) : '') + '</td>' : '') +
        '<td></td>';
      tb.appendChild(gr);

      g.rows.forEach(function (r) {
        var left = fmtLeftShort(r.deadline, now, r.estimated);
        var st = condStatusCell(r);
        var tr = document.createElement('tr');
        tr.className = 'ssb-row';
        tr.setAttribute('data-grp', grpKey(sec, g));
        tr.innerHTML = idCell(r, withMoney && canFulfill(r)) +
          '<td title="' + esc(st.text) + '">' + esc(r.text) + '</td>' +
          (withMoney
            ? '<td class="ssb-num">' + (r.amount ? esc(fmtMoney(r.amount) + (r.currency ? ' ' + r.currency : '')) : '—') + '</td>'
            : '') +
          '<td class="ssb-num ' + left.cls + '" title="' + esc(left.title) + '">' + esc(left.text) + '</td>';
        tb.appendChild(tr);
      });
    });

    t.appendChild(tb);
    applyGroupState(t, sec);
    return t;
  }

  function renderPART(root) {
    var data = collectPart();
    if (data === null) {
      root.innerHTML = '<div class="ssb-empty">Contract data is not loaded yet.<br>' +
        'Open a <b>CONTS</b> buffer once, then reload this buffer.</div>';
      return;
    }

    var now = Date.now();
    var isOverdue = function (r) { return r.deadline && r.deadline < now; };

    var mineAll = data.mine;
    var mine = MINE_ONLY_ACTIONABLE ? mineAll.filter(function (r) { return r.ready; }) : mineAll;
    var mineWaiting = mineAll.length - mine.length;

    var pOver = data.partner.filter(isOverdue).length;
    var mOver = mine.filter(isOverdue).length;

    var head = document.createElement('div');
    head.className = 'ssb-head';
    head.innerHTML = '<b>' + mine.length + '</b>' +
      '<span class="ssb-sub">conditions I can act on · ' + data.partner.length + ' owed to me</span>' +
      (pOver + mOver ? '<span class="ssb-red">overdue: ' + (pOver + mOver) + '</span>' : '') +
      ffToggleHTML();
    root.appendChild(head);

    var mineTotals = {};
    mine.forEach(function (r) { if (r.amount) mineTotals[r.currency] = (mineTotals[r.currency] || 0) + r.amount; });

    root.insertAdjacentHTML('beforeend', secHeader('part-mine',
      'My obligations (incl. payments)' +
      (mineWaiting ? ' <span class="ssb-muted">· ' + mineWaiting + ' waiting on partner</span>' : ''),
      (Object.keys(mineTotals).length ? esc(fmtTotals(mineTotals)) : (mine.length ? mine.length + ' pcs' : ''))));
    if (mine.length) {
      root.appendChild(buildCondTable(groupConds(mine, now), now, true, 'part-mine'));
    } else {
      root.insertAdjacentHTML('beforeend',
        '<div class="ssb-empty">' +
        (mineWaiting
          ? 'Nothing to do right now — all ' + mineWaiting + ' of your conditions wait on the partner.'
          : 'You have no outstanding conditions on active contracts.') +
        '</div>');
    }

    root.insertAdjacentHTML('beforeend', secHeader('part-partner', 'Expected from partners',
      (data.partner.length ? data.partner.length + ' pcs' : '')));
    if (data.partner.length) {
      root.appendChild(buildCondTable(groupConds(data.partner, now), now, false, 'part-partner'));
    } else {
      root.insertAdjacentHTML('beforeend',
        '<div class="ssb-empty">No outstanding partner conditions.</div>');
    }

    root.insertAdjacentHTML('beforeend',
      '<div class="ssb-foot">Money owed to me by partners is deliberately not here — see <b>SSB VZEM</b>.</div>');
    refreshGroupButtons(root);
  }

  // ─────────────────────────────────────────────────────────────
  //  Registry of the subcommands - every new one is added here
  // ─────────────────────────────────────────────────────────────
  var COMMANDS = {
    VZEM: {
      title: 'SSB · RECEIVABLES',
      description: 'Receivables on active contracts — which partner owes how much and by when.',
      render: renderVZEM
    },
    PART: {
      title: 'SSB · CONDITIONS',
      description: 'Outstanding contract conditions — what partners still owe me (money excluded) and what I still owe (money included).',
      render: renderPART
    }
  };

  function renderIndex(root, unknown) {
    var html = '<div class="ssb-head"><b>SSB</b><span class="ssb-sub">Stoka’s Script Buffer · v' + VERSION + '</span></div>';
    if (unknown) {
      html += '<div class="ssb-empty ssb-red">Unknown subcommand: ' + esc(unknown) + '</div>';
    }
    html += '<div class="ssb-sec"><span>Available subcommands</span><span></span></div>';
    html += '<table class="ssb-table"><tbody>';
    Object.keys(COMMANDS).forEach(function (k) {
      html += '<tr><td class="ssb-cmd">XIT SSB ' + esc(k) + '</td><td>' + esc(COMMANDS[k].description) + '</td></tr>';
    });
    html += '</tbody></table>';
    root.innerHTML = html;
  }

  // ───────────────────────────────────────────────────────────
  //  Update notice (since 3.12)
  //
  //  Tampermonkey refuses to auto-update a script it considers locally modified,
  //  which is what installing by hand over an existing entry makes it - and it
  //  says nothing about that: the update check just reports no update. So the
  //  script compares its own version with the published one and puts a line at
  //  the top of the buffer. Installing from there is one click.
  //
  //  The published file is fetched at most once every 6 hours and the answer is
  //  cached in localStorage, so a reload does not hit GitHub again.
  // ───────────────────────────────────────────────────────────
  var UPD_URL = 'https://raw.githubusercontent.com/stokovich/prun-scripts/main/ssb.user.js';
  var UPD_KEY = 'ssb-upd';
  var UPD_EVERY = 6 * 3600 * 1000;
  var _latest = null;

  // Tampermonkey answers the question itself: GM_info.scriptWillUpdate is false
  // exactly when it has given up on this copy (marked as locally modified, or
  // updates turned off for it). Only then is the notice worth anything - with a
  // working auto-update it would just be noise. GM_info is available even under
  // @grant none; another script manager may not provide the field at all, and
  // then the answer is null and we check anyway rather than stay silent.
  var _willUpdate = (function () {
    try {
      if (typeof GM_info !== 'undefined' && GM_info &&
          typeof GM_info.scriptWillUpdate === 'boolean') return GM_info.scriptWillUpdate;
    } catch (e) {}
    return null;
  })();

  function verCmp(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function checkUpdate() {
    if (_willUpdate === true) return;   // Tampermonkey keeps it current by itself
    var c = {};
    try { c = JSON.parse(localStorage.getItem(UPD_KEY) || '{}'); } catch (e) {}
    if (c.version) _latest = c.version;
    if (c.at && Date.now() - c.at < UPD_EVERY) return;
    fetch(UPD_URL, { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var m = txt.match(/^\/\/\s*@version\s+(\S+)/m);
        if (!m) return;
        _latest = m[1];
        try { localStorage.setItem(UPD_KEY, JSON.stringify({ at: Date.now(), version: _latest })); } catch (e) {}
        if (verCmp(_latest, VERSION) > 0) renderAll();
      })
      .catch(function () {});   // offline or blocked - the notice simply stays away
  }

  function updNoticeHTML() {
    if (_willUpdate === true) return '';
    if (!_latest || verCmp(_latest, VERSION) <= 0) return '';
    return '<div class="ssb-upd">SSB <b>' + esc(_latest) + '</b> is out - you are running ' +
      esc(VERSION) + '. <a href="' + UPD_URL + '" target="_blank" rel="noopener">Install it</a>' +
      ', then press F5 here. <span class="ssb-muted">Tampermonkey stops updating a script ' +
      'that was installed by hand, so this is how you will hear about new versions.</span></div>';
  }

  function render(root) {
    injectCSS();
    root.className = 'ssb-root';
    root.textContent = '';

    var upd = updNoticeHTML();
    if (upd) root.insertAdjacentHTML('beforeend', upd);

    var sub = root.dataset.sub || '';
    var cmd = COMMANDS[sub];

    if (!sub) {
      renderIndex(root, null);
    } else if (!cmd) {
      renderIndex(root, sub);
    } else {
      cmd.render(root);
    }

    var foot = document.createElement('div');
    foot.className = 'ssb-foot';
    foot.textContent = 'SSB v' + VERSION + (sub ? ' · ' + sub : '') +
      ' · updated ' + new Date().toLocaleTimeString('bg-BG');
    root.appendChild(foot);
  }

  // ─────────────────────────────────────────────────────────────
  //  The command line: "SSB VZEM" -> "XIT SSB VZEM"
  //
  //  APEX does not accept arbitrary commands - for an unknown one the command line
  //  returns a warning and creates no buffer at all. So we intercept the submit in
  //  the capture phase (to be ahead of Refined PrUn), replace the text with the valid
  //  XIT command and submit the form again. The user types "SSB VZEM",
  //  the game receives "XIT SSB VZEM".
  // ─────────────────────────────────────────────────────────────
  var TYPED_RE = /^\s*SSB(?:[\s_]+([A-Za-z0-9]+))?\s*$/i;
  var skipNextSubmit = false;

  function changeInputValue(input, value) {
    // React replaces the native setter, so the original one is called
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    setter.set.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function commandInputOf(form) {
    var inputs = form.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].closest('[class*="PanelSelector"]')) return inputs[i];
    }
    return null;
  }

  document.addEventListener('submit', function (ev) {
    if (skipNextSubmit) { skipNextSubmit = false; return; }
    var form = ev.target;
    if (!form || form.tagName !== 'FORM') return;
    var input = commandInputOf(form);
    if (!input) return;
    var m = TYPED_RE.exec(input.value);
    if (!m) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

    changeInputValue(input, 'XIT SSB' + (m[1] ? ' ' + m[1].toUpperCase() : ''));
    skipNextSubmit = true;
    setTimeout(function () { if (form.isConnected) form.requestSubmit(); }, 0);
  }, true);

  // ─────────────────────────────────────────────────────────────
  //  Attaching to the buffer
  // ─────────────────────────────────────────────────────────────
  var mounted = [];

  function attach(frame, sub) {
    var existing = frame.querySelector('.ssb-root');
    if (existing) {
      if (existing.dataset.sub === sub) return;   // same subcommand - nothing to do
      existing.dataset.sub = sub;                 // subcommand changed in the same buffer
      render(existing);
      setTitle(frame, sub);
      return;
    }
    var view = frame.querySelector(VIEW_SEL);
    if (!view) return;
    var host = view.children[0] || view;
    host.textContent = '';                 // also clears Refined PrUn's "Error! No Matching Function!"
    host.removeAttribute('style');
    host.style.width = '100%';
    host.style.height = '100%';
    var root = document.createElement('div');
    root.dataset.sub = sub;
    host.appendChild(root);
    render(root);
    mounted.push({ frame: frame, root: root });
    setTitle(frame, sub);
  }

  function setTitle(frame, sub) {
    var title = frame.querySelector(TITLE_SEL);
    if (title) {
      var want = (COMMANDS[sub] && COMMANDS[sub].title) || 'SSB';
      if (title.textContent !== want) title.textContent = want;
    }
    // The game keeps the command as "XIT SSB VZEM"; in the header we show it
    // the way the user typed it. Purely visual - the game state is untouched.
    var cmdEl = frame.querySelector(CMD_SEL);
    if (cmdEl) {
      var shown = 'SSB' + (sub ? ' ' + sub : '');
      if (cmdEl.textContent !== shown) cmdEl.textContent = shown;
    }
  }

  var _lastScan = { at: 0, frames: 0, withCmd: 0, matched: 0, cmds: [] };

  function scan() {
    var frames = document.querySelectorAll(FRAME_SEL);
    var info = { at: Date.now(), frames: frames.length, withCmd: 0, matched: 0, cmds: [] };
    for (var i = 0; i < frames.length; i++) {
      var cmdEl = frames[i].querySelector(CMD_SEL);
      if (!cmdEl) continue;
      info.withCmd++;
      var txt = cmdEl.textContent || '';
      if (info.cmds.length < 40) info.cmds.push(txt.trim());
      var m = CMD_RE.exec(txt);
      if (!m) continue;
      info.matched++;
      attach(frames[i], (m[1] || '').toUpperCase());
    }
    _lastScan = info;
    mounted = mounted.filter(function (m) { return m.frame.isConnected; });
  }

  checkUpdate();

  function renderAll() {
    mounted = mounted.filter(function (m) { return m.frame.isConnected && m.root.isConnected; });
    mounted.forEach(function (m) { render(m.root); });
  }

  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; scan(); }, 250);
  }

  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true, subtree: true, characterData: true
  });

  scan();
  setInterval(function () { scan(); renderAll(); }, 30000);

  // Live refresh on store changes
  var unsub = null;
  setInterval(function () {
    if (unsub) return;
    var st = getStore();
    if (!st || typeof st.subscribe !== 'function') return;
    var t = null;
    unsub = st.subscribe(function () {
      if (t) return;
      t = setTimeout(function () { t = null; renderAll(); }, 1500);
    });
  }, 3000);

  // Diagnostics from the console
  window.SSB = {
    version: VERSION,
    commands: COMMANDS,
    path: function () { return _path; },
    data: collect,
    contracts: getContracts,
    stock: buildStock,
    storagePaths: function () { return { stores: _storesPath, address: _addrPath }; },
    refresh: function () { scan(); renderAll(); },
  // Report for someone else's install: copy it from the console and send it. Touches nothing.
    diag: function () {
      scan();
      var st = null, storeErr = null;
      try { st = getStore(); } catch (e) { storeErr = String(e); }
      var contracts = null, contractsErr = null;
      try { contracts = getContracts(); } catch (e2) { contractsErr = String(e2); }
      var xitTiles = [].slice.call(document.querySelectorAll(FRAME_SEL)).map(function (f) {
        var c = f.querySelector(CMD_SEL);
        var v = f.querySelector(VIEW_SEL);
        var txt = c ? (c.textContent || '').trim() : null;
        return { cmd: txt, matches: !!(txt && CMD_RE.test(txt)), hasView: !!v,
                 hasSsbRoot: !!f.querySelector('.ssb-root'),
                 viewText: v ? (v.textContent || '').trim().slice(0, 60) : null };
      }).filter(function (x) { return x.cmd && /SSB|XIT/i.test(x.cmd); });
      var r = {
        version: VERSION,
        url: location.href,
        userAgent: navigator.userAgent,
        scriptWillUpdate: _willUpdate,
        latestSeen: _latest,
        refinedPrun: !!document.querySelector('[class*="rp-"], .rp-command-XIT, [class*="rprun"]'),
        lastScan: _lastScan,
        mounted: mounted.length,
        ssbTiles: xitTiles,
        store: st ? 'found' : ('NOT FOUND' + (storeErr ? ' (' + storeErr + ')' : '')),
        contractsPath: _path,
        contracts: contracts === null ? ('NOT LOADED' + (contractsErr ? ' (' + contractsErr + ')' : '')) : contracts.length,
        storagePaths: { stores: _storesPath, address: _addrPath }
      };
      try { console.log('[SSB diag]', JSON.stringify(r, null, 1)); } catch (e3) {}
      return r;
    }
  };
})();
