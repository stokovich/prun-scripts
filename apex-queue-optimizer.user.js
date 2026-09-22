// ==UserScript==
// @name         APEX Production Queue Optimizer
// @namespace    pu-stokovich
// @version      1.8
// @updateURL    https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-queue-optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-queue-optimizer.user.js
// @description  Pick a planet -> production line -> recipes. Recipe times are taken AUTOMATICALLY from the game (effective, already including efficiency/condition/COGC), nothing is typed by hand. Computes the optimal queue slots (q) and multipliers (m) for the target percentages.
// @match        https://apex.prosperousuniverse.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var VERSION = '1.8';
  document.documentElement.dataset.puQueueOptimizerVersion = VERSION;

  var FRAME_SEL  = '[class*="TileFrame__frame"]';
  var HEADER_SEL = '[class*="TileFrame__header"]';
  var CMD_SEL    = '[class*="TileFrame__cmd"]';
  var BTN_ATTR   = 'data-pu-opt-btn';

  var PALETTE = ['#f0a500','#3fb950','#58a6ff','#ff7b72','#d2a8ff','#ffa657',
                 '#79c0ff','#56d364','#e3b341','#bc8cff','#ff9e64','#7ee787'];

  // ─────────────────────────────────────────────────────────────
  //  Access to the game store (React fiber -> Redux Provider)
  // ─────────────────────────────────────────────────────────────
  var _store = null;

  // Firefox: when Tampermonkey cannot inject into the page context (CSP ->
  // fallback to the sandbox), the userscript sees DOM nodes through an Xray
  // wrapper and the properties attached by the page itself (__reactContainer...)
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

  // Returns the production lines as plain JS objects.
  function getLines() {
    var st = getStore();
    if (!st) return [];
    var raw;
    try { raw = st.getState().getIn(['production', 'lines', 'data']); } catch (e) { return []; }
    if (!raw) return [];
    var vals;
    if (typeof raw.valueSeq === 'function') vals = raw.valueSeq().toArray();
    else if (typeof raw === 'object') vals = Object.keys(raw).map(function (k) { return raw[k]; });
    else return [];
    return vals
      .map(function (v) { return (v && typeof v.toJS === 'function') ? v.toJS() : v; })
      .filter(function (x) { return x && x.id && x.productionTemplates && x.productionTemplates.length; });
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────
  function pretty(s) {
    return String(s || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, function (c) { return c.toUpperCase(); })
      .trim();
  }

  function planetOf(line) {
    var ls = (line.address && line.address.lines) || [];
    var last = ls[ls.length - 1];
    var e = last && last.entity;
    if (!e) return { id: '?', name: '?' };
    return { id: e.naturalId || '?', name: e.name || e.naturalId || '?' };
  }

  function fmtTime(min) {
    if (!isFinite(min)) return '—';
    var total = Math.round(min);
    var d = Math.floor(total / 1440);
    var h = Math.floor((total % 1440) / 60);
    var m = total % 60;
    var p = [];
    if (d) p.push(d + 'd');
    if (h) p.push(h + 'h');
    if (m || !p.length) p.push(m + 'm');
    return p.join(' ');
  }

  function factorLabel(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map(function (f) { return f.factor + ' ' + f.material.ticker; }).join(' + ');
  }

  function tickersOf(arr) {
    return (arr || []).map(function (f) { return f.material.ticker; }).join(' ');
  }

  // ─────────────────────────────────────────────────────────────
  //  Optimizer
  // ─────────────────────────────────────────────────────────────
  function* partitions(total, n, minVal) {
    if (n === 1) { if (total >= minVal) yield [total]; return; }
    for (var v = minVal; v <= total - (n - 1) * minVal; v++) {
      for (var rest of partitions(total - v, n - 1, minVal)) yield [v].concat(rest);
    }
  }

  function* cartesian(arrays) {
    if (arrays.length === 0) { yield []; return; }
    for (var v of arrays[0]) {
      for (var rest of cartesian(arrays.slice(1))) yield [v].concat(rest);
    }
  }

  var ITER_CAP = 3000000;

  function runOptimize(items, maxQueue, maxMult) {
    var n = items.length;
    var totalPct = items.reduce(function (s, i) { return s + i.pct; }, 0);
    var norm = items.map(function (i) {
      return { name: i.name, time: i.time, pct: i.pct, frac: i.pct / totalPct };
    });
    var bestScore = Infinity, bestSol = null, iter = 0, capped = false;

    for (var qTotal = n; qTotal <= maxQueue; qTotal++) {
      for (var qs of partitions(qTotal, n, 1)) {
        var r = norm.map(function (item, i) { return item.frac / (qs[i] * item.time); });
        var rMin = Math.min.apply(null, r);
        var rRatios = r.map(function (ri) { return ri / rMin; });
        var rMax = Math.max.apply(null, rRatios);
        if (rMax > maxMult + 0.5) continue;
        var maxBase = Math.floor(maxMult / rMax);
        for (var base = 1; base <= maxBase; base++) {
          var mOptions = rRatios.map(function (ratio) {
            var ideal = ratio * base;
            var f = Math.floor(ideal), c = Math.ceil(ideal), opts = [];
            if (f >= 1 && f <= maxMult) opts.push(f);
            if (c >= 1 && c <= maxMult && c !== f) opts.push(c);
            if (!opts.length) opts.push(Math.max(1, Math.min(maxMult, Math.round(ideal))));
            return opts;
          });
          for (var ms of cartesian(mOptions)) {
            if (++iter > ITER_CAP) { capped = true; break; }
            var times = norm.map(function (item, i) { return qs[i] * ms[i] * item.time; });
            var cycleTotal = times.reduce(function (a, b) { return a + b; }, 0);
            if (!cycleTotal) continue;
            var actualFracs = times.map(function (t) { return t / cycleTotal; });
            var score = norm.reduce(function (acc, item, i) {
              return acc + Math.pow(actualFracs[i] - item.frac, 2);
            }, 0);
            if (score < bestScore - 1e-12) {
              bestScore = score;
              bestSol = {
                qs: qs.slice(), ms: ms.slice(),
                actualFracs: actualFracs.slice(),
                cycleTotal: cycleTotal, qTotal: qTotal
              };
            }
          }
          if (capped) break;
        }
        if (capped) break;
      }
      if (capped) break;
    }
    if (bestSol) bestSol.capped = capped;
    return bestSol;
  }

  // ─────────────────────────────────────────────────────────────
  //  Styles
  // ─────────────────────────────────────────────────────────────
  var CSS = ''
    + '#puopt-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.62);'
    + 'display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto;'
    + 'font-family:Verdana,Geneva,sans-serif;}'
    + '#puopt-modal{background:#161616;border:1px solid #3d3d3d;border-radius:4px;width:100%;'
    + 'max-width:1080px;color:#c8c8c8;font-size:12px;box-shadow:0 8px 40px rgba(0,0,0,.7);}'
    + '#puopt-modal h1{font-size:13px;color:#f7a600;letter-spacing:.06em;text-transform:uppercase;margin:0;}'
    + '.puopt-head{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #3d3d3d;background:#1e1e1e;}'
    + '.puopt-head .sub{color:#7a7a7a;font-size:11px;flex:1;}'
    + '.puopt-x{background:#3a1414;color:#ff6b6b;border:1px solid #ff6b6b;border-radius:3px;'
    + 'cursor:pointer;padding:2px 9px;font-weight:bold;font-size:12px;line-height:16px;}'
    + '.puopt-body{padding:14px;}'
    + '.puopt-sec{border:1px solid #333;border-radius:3px;margin-bottom:12px;background:#1b1b1b;}'
    + '.puopt-sec>h2{font-size:11px;color:#f7a600;letter-spacing:.08em;text-transform:uppercase;'
    + 'margin:0;padding:7px 12px;border-bottom:1px solid #333;background:#212121;}'
    + '.puopt-sec>div{padding:10px 12px;}'
    + '.puopt-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}'
    + '.puopt-row label{color:#8a8a8a;font-size:11px;margin-right:5px;}'
    + '#puopt-overlay select,#puopt-overlay input{background:#0f0f0f;border:1px solid #444;color:#ddd;'
    + 'padding:4px 7px;border-radius:2px;font-family:inherit;font-size:12px;outline:none;}'
    + '#puopt-overlay select:focus,#puopt-overlay input:focus{border-color:#f7a600;}'
    + '#puopt-overlay input[type=checkbox]{accent-color:#f7a600;width:14px;height:14px;padding:0;cursor:pointer;}'
    + '.puopt-btn{background:#f7a600;color:#161616;border:none;padding:7px 18px;border-radius:2px;'
    + 'font-weight:bold;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;font-size:11px;font-family:inherit;}'
    + '.puopt-btn:disabled{opacity:.5;cursor:default;}'
    + '.puopt-btn2{background:#2b2b2b;color:#c8c8c8;border:1px solid #4a4a4a;padding:4px 10px;'
    + 'border-radius:2px;cursor:pointer;font-size:11px;font-family:inherit;}'
    + '.puopt-btn2:hover{border-color:#f7a600;color:#f7a600;}'
    + 'table.puopt-t{width:100%;border-collapse:collapse;font-size:11.5px;}'
    + 'table.puopt-t th{text-align:left;color:#7a7a7a;font-weight:normal;font-size:10px;'
    + 'text-transform:uppercase;letter-spacing:.06em;padding:5px 8px;border-bottom:1px solid #333;}'
    + 'table.puopt-t td{padding:5px 8px;border-bottom:1px solid #262626;vertical-align:middle;}'
    + 'table.puopt-t tr:hover td{background:#1f1f1f;}'
    + '.puopt-tick{display:inline-block;background:#2a2a2a;border:1px solid #444;border-radius:2px;'
    + 'padding:0 5px;margin-right:3px;font-family:monospace;font-size:11px;color:#e0e0e0;}'
    + '.puopt-dot{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 auto;}'
    + '.puopt-nom{color:#666;font-size:10px;}'
    + '.puopt-badge{background:#143a1c;color:#5fd07a;border:1px solid #2f6b3f;border-radius:2px;'
    + 'padding:0 5px;font-size:10px;}'
    + '.puopt-info{color:#7a7a7a;font-size:11px;}'
    + '.puopt-err{color:#ff6b6b;padding:6px 0;min-height:16px;font-size:11.5px;}'
    + '.puopt-sum{display:flex;gap:22px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #333;background:#1e1e1e;}'
    + '.puopt-sum b{display:block;color:#7a7a7a;font-size:10px;text-transform:uppercase;font-weight:normal;letter-spacing:.06em;}'
    + '.puopt-sum span{font-size:14px;color:#e6e6e6;}'
    + '.puopt-bar{height:3px;background:#2a2a2a;border-radius:2px;margin-top:3px;width:70px;}'
    + '.puopt-bar>i{display:block;height:100%;border-radius:2px;}'
    + '.puopt-slot{display:inline-flex;align-items:center;justify-content:center;width:34px;height:20px;'
    + 'border-radius:2px;font-size:9px;font-weight:bold;margin:1px;font-family:monospace;}'
    + '[' + BTN_ATTR + ']{display:inline-block;vertical-align:middle;margin-right:8px;'
    + 'white-space:nowrap;padding:0 7px;border-radius:3px;font-size:11px;font-weight:bold;'
    + 'letter-spacing:.5px;line-height:16px;cursor:pointer;background:#2b2200;color:#f7a600;'
    + 'border:1px solid #f7a600;}';

  function injectCSS() {
    if (document.getElementById('puopt-css')) return;
    var st = document.createElement('style');
    st.id = 'puopt-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ─────────────────────────────────────────────────────────────
  //  Modal state
  // ─────────────────────────────────────────────────────────────
  var S = { lines: [], planetId: null, lineId: null, sel: {}, filter: '' };

  function currentLine() {
    return S.lines.find(function (l) { return l.id === S.lineId; }) || null;
  }

  function openModal(preselectLineId) {
    injectCSS();
    S.lines = getLines();

    var ov = document.getElementById('puopt-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'puopt-overlay';
      ov.innerHTML =
        '<div id="puopt-modal">' +
          '<div class="puopt-head">' +
            '<h1>Production Queue Optimizer</h1>' +
            '<span class="sub" id="puopt-sub"></span>' +
            '<button class="puopt-x" id="puopt-close">X</button>' +
          '</div>' +
          '<div class="puopt-body">' +
            '<div class="puopt-sec"><h2>Line</h2><div>' +
              '<div class="puopt-row">' +
                '<div><label>Planet</label><select id="puopt-planet"></select></div>' +
                '<div><label>Production line</label><select id="puopt-line"></select></div>' +
                '<button class="puopt-btn2" id="puopt-reload">Reload</button>' +
              '</div>' +
              '<div class="puopt-info" id="puopt-lineinfo" style="margin-top:8px"></div>' +
            '</div></div>' +
            '<div class="puopt-sec"><h2>Recipes</h2><div>' +
              '<div class="puopt-row" style="margin-bottom:8px">' +
                '<div><label>Filter</label><input id="puopt-filter" type="text" placeholder="ticker or name" style="width:150px"></div>' +
                '<button class="puopt-btn2" id="puopt-even">Split evenly</button>' +
                '<button class="puopt-btn2" id="puopt-clear">Clear selection</button>' +
                '<span id="puopt-pctsum" class="puopt-info"></span>' +
              '</div>' +
              '<table class="puopt-t"><thead><tr>' +
                '<th style="width:26px"></th><th>Recipe</th><th>Input</th><th>Output</th>' +
                '<th>Effective time</th><th style="width:90px">Target %</th>' +
              '</tr></thead><tbody id="puopt-recipes"></tbody></table>' +
            '</div></div>' +
            '<div class="puopt-sec"><h2>Limits</h2><div class="puopt-row">' +
              '<div><label>Max queue slots</label><input id="puopt-maxq" type="number" min="1" max="20" value="10" style="width:60px"></div>' +
              '<div><label>Max multiplier (x)</label><input id="puopt-maxm" type="number" min="1" max="20" value="10" style="width:60px"></div>' +
              '<button class="puopt-btn" id="puopt-go">Optimize</button>' +
            '</div></div>' +
            '<div class="puopt-err" id="puopt-err"></div>' +
            '<div id="puopt-result"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);

      ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeModal(); });
      ov.querySelector('#puopt-close').onclick = closeModal;
      ov.querySelector('#puopt-reload').onclick = function () {
        S.lines = getLines(); renderPlanets(); renderLines(); renderRecipes();
      };
      ov.querySelector('#puopt-planet').onchange = function () {
        S.planetId = this.value; S.lineId = null; S.sel = {};
        renderLines(); renderRecipes();
      };
      ov.querySelector('#puopt-line').onchange = function () {
        S.lineId = this.value; S.sel = {}; renderRecipes();
      };
      ov.querySelector('#puopt-filter').oninput = function () {
        S.filter = this.value.trim().toLowerCase(); renderRecipes();
      };
      ov.querySelector('#puopt-even').onclick = function () {
        var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k].on; });
        if (!ids.length) return;
        var v = Math.round((100 / ids.length) * 100) / 100;
        ids.forEach(function (k, i) {
          S.sel[k].pct = (i === ids.length - 1)
            ? Math.round((100 - v * (ids.length - 1)) * 100) / 100
            : v;
        });
        renderRecipes();
      };
      ov.querySelector('#puopt-clear').onclick = function () { S.sel = {}; renderRecipes(); };
      ov.querySelector('#puopt-go').onclick = doOptimize;
      document.addEventListener('keydown', escHandler, true);
    }
    ov.style.display = 'flex';

    if (!S.lines.length) {
      document.getElementById('puopt-sub').textContent =
        'No production lines loaded - open a PROD buffer once, then press "Reload".';
    } else {
      document.getElementById('puopt-sub').textContent = S.lines.length + ' lines';
    }

    if (preselectLineId) {
      var l = S.lines.find(function (x) { return x.id.indexOf(preselectLineId) === 0; });
      if (l) { S.planetId = planetOf(l).id; S.lineId = l.id; S.sel = {}; }
    }
    if (!S.planetId && S.lines.length) S.planetId = planetOf(S.lines[0]).id;

    renderPlanets(); renderLines(); renderRecipes();
  }

  function escHandler(e) {
    if (e.key === 'Escape') {
      var ov = document.getElementById('puopt-overlay');
      if (ov && ov.style.display !== 'none') { e.stopPropagation(); closeModal(); }
    }
  }

  function closeModal() {
    var ov = document.getElementById('puopt-overlay');
    if (ov) ov.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────────────
  //  Rendering
  // ─────────────────────────────────────────────────────────────
  function renderPlanets() {
    var sel = document.getElementById('puopt-planet');
    var map = {};
    S.lines.forEach(function (l) {
      var p = planetOf(l);
      if (!map[p.id]) map[p.id] = { id: p.id, name: p.name, n: 0 };
      map[p.id].n++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    sel.innerHTML = arr.map(function (p) {
      var label = (p.name === p.id) ? p.id : (p.name + ' (' + p.id + ')');
      return '<option value="' + p.id + '">' + label + ' — ' + p.n + '</option>';
    }).join('');
    if (S.planetId) sel.value = S.planetId;
    S.planetId = sel.value || S.planetId;
  }

  function linesOfPlanet() {
    return S.lines.filter(function (l) { return planetOf(l).id === S.planetId; })
      .sort(function (a, b) { return pretty(a.type).localeCompare(pretty(b.type)); });
  }

  function renderLines() {
    var sel = document.getElementById('puopt-line');
    var arr = linesOfPlanet();
    sel.innerHTML = arr.map(function (l) {
      return '<option value="' + l.id + '">' + pretty(l.type) + '</option>';
    }).join('');
    if (S.lineId && arr.some(function (l) { return l.id === S.lineId; })) sel.value = S.lineId;
    else S.lineId = arr.length ? arr[0].id : null;
    if (S.lineId) sel.value = S.lineId;

    var info = document.getElementById('puopt-lineinfo');
    var l = currentLine();
    if (!l) { info.textContent = ''; return; }
    info.innerHTML =
      'Efficiency <b style="color:#5fd07a">' + (l.efficiency * 100).toFixed(1) + '%</b> &nbsp;·&nbsp; ' +
      'Condition <b>' + (l.condition * 100).toFixed(1) + '%</b> &nbsp;·&nbsp; ' +
      'Parallel slots (capacity) <b>' + l.capacity + '</b> &nbsp;·&nbsp; ' +
      'Queue length <b>' + l.slots + '</b> &nbsp;·&nbsp; ' +
      'Current orders <b>' + (l.orders ? l.orders.length : 0) + '</b>' +
      '<br><span style="color:#5a5a5a">The times shown are EFFECTIVE - they already include efficiency, condition, experts and COGC.</span>';
  }

  function renderRecipes() {
    var tb = document.getElementById('puopt-recipes');
    var l = currentLine();
    if (!l) { tb.innerHTML = '<tr><td colspan="6" class="puopt-info">No line selected.</td></tr>'; updateSum(); return; }

    var queued = {};
    (l.orders || []).forEach(function (o) { if (o.recipeId) queued[o.recipeId] = (queued[o.recipeId] || 0) + 1; });

    var rows = l.productionTemplates.filter(function (t) {
      if (!S.filter) return true;
      var hay = (t.name + ' ' + tickersOf(t.outputFactors) + ' ' + tickersOf(t.inputFactors)).toLowerCase();
      return hay.indexOf(S.filter) >= 0;
    });

    if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="puopt-info">No matches.</td></tr>'; updateSum(); return; }

    tb.innerHTML = rows.map(function (t, idx) {
      var st = S.sel[t.id] || { on: false, pct: '' };
      var min = t.duration.millis / 60000;
      var nominal = min * (t.efficiency || l.efficiency || 1);
      var color = PALETTE[idx % PALETTE.length];
      return '<tr>' +
        '<td><input type="checkbox" data-rid="' + t.id + '"' + (st.on ? ' checked' : '') + '></td>' +
        '<td><span style="display:inline-flex;align-items:center;gap:7px">' +
          '<i class="puopt-dot" style="background:' + (st.on ? color : '#3a3a3a') + '"></i>' +
          '<b>' + pretty(t.name) + '</b></span>' +
          (queued[t.id] ? ' <span class="puopt-badge">queued: ' + queued[t.id] + '</span>' : '') + '</td>' +
        '<td>' + factorLabel(t.inputFactors).replace(/(\d+) ([A-Z0-9]+)/g, '$1 <span class="puopt-tick">$2</span>') + '</td>' +
        '<td>' + factorLabel(t.outputFactors).replace(/(\d+) ([A-Z0-9]+)/g, '$1 <span class="puopt-tick">$2</span>') + '</td>' +
        '<td><b style="color:#e6e6e6">' + fmtTime(min) + '</b>' +
          '<div class="puopt-nom">nominal ' + fmtTime(nominal) + '</div></td>' +
        '<td><input type="number" data-pct="' + t.id + '" min="0" max="100" step="0.1" value="' + st.pct + '" style="width:72px;text-align:center"></td>' +
      '</tr>';
    }).join('');

    tb.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.onchange = function () {
        var id = this.dataset.rid;
        if (!S.sel[id]) S.sel[id] = { on: false, pct: '' };
        S.sel[id].on = this.checked;
        renderRecipes();
      };
    });
    tb.querySelectorAll('input[data-pct]').forEach(function (inp) {
      inp.oninput = function () {
        var id = this.dataset.pct;
        if (!S.sel[id]) S.sel[id] = { on: true, pct: '' };
        S.sel[id].pct = this.value;
        if (!S.sel[id].on) S.sel[id].on = true;
        updateSum();
      };
    });
    updateSum();
  }

  function selectedItems() {
    var l = currentLine();
    if (!l) return [];
    var out = [];
    l.productionTemplates.forEach(function (t, idx) {
      var st = S.sel[t.id];
      if (!st || !st.on) return;
      out.push({
        id: t.id,
        name: pretty(t.name),
        out: factorLabel(t.outputFactors),
        time: t.duration.millis / 60000,
        pct: parseFloat(st.pct) || 0,
        color: PALETTE[idx % PALETTE.length]
      });
    });
    return out;
  }

  function updateSum() {
    var el = document.getElementById('puopt-pctsum');
    if (!el) return;
    var items = selectedItems();
    if (!items.length) { el.textContent = ''; return; }
    var sum = items.reduce(function (s, i) { return s + i.pct; }, 0);
    var diff = Math.abs(sum - 100);
    el.textContent = diff < 0.05
      ? 'Selected ' + items.length + ' · sum = 100% OK'
      : 'Selected ' + items.length + ' · sum = ' + sum.toFixed(1) + '% (must be 100%)';
    el.style.color = diff < 0.05 ? '#5fd07a' : (diff < 3 ? '#f7a600' : '#ff6b6b');
  }

  // ─────────────────────────────────────────────────────────────
  //  Computation + result
  // ─────────────────────────────────────────────────────────────
  function doOptimize() {
    var err = document.getElementById('puopt-err');
    var res = document.getElementById('puopt-result');
    err.textContent = ''; res.innerHTML = '';

    var items = selectedItems();
    var maxQ = Math.max(1, Math.min(20, parseInt(document.getElementById('puopt-maxq').value, 10) || 10));
    var maxM = Math.max(1, Math.min(20, parseInt(document.getElementById('puopt-maxm').value, 10) || 10));

    if (!items.length) { err.textContent = 'Select at least one recipe.'; return; }
    if (items.length > maxQ) { err.textContent = 'Selected recipes (' + items.length + ') exceed the queue slots (' + maxQ + ').'; return; }
    if (items.some(function (i) { return !(i.time > 0); })) { err.textContent = 'A recipe has no time.'; return; }
    if (items.some(function (i) { return i.pct <= 0; })) { err.textContent = 'All percentages must be > 0.'; return; }
    var tot = items.reduce(function (s, i) { return s + i.pct; }, 0);
    if (Math.abs(tot - 100) > 1) { err.textContent = 'The sum is ' + tot.toFixed(1) + '% - it must be 100%.'; return; }

    var btn = document.getElementById('puopt-go');
    btn.disabled = true; btn.textContent = 'Computing…';
    setTimeout(function () {
      try { renderResult(items, runOptimize(items, maxQ, maxM), maxQ); }
      catch (e) { err.textContent = 'Error: ' + e.message; }
      finally { btn.disabled = false; btn.textContent = 'Optimize'; }
    }, 20);
  }

  function renderResult(items, sol, maxQ) {
    var res = document.getElementById('puopt-result');
    if (!sol) {
      res.innerHTML = '<div class="puopt-sec"><div class="puopt-err">No solution within these limits. Try more slots or a larger multiplier.</div></div>';
      return;
    }
    var maxDev = items.reduce(function (mx, it, i) {
      return Math.max(mx, Math.abs(sol.actualFracs[i] * 100 - it.pct));
    }, 0);
    var qual  = maxDev < 0.5 ? 'Excellent' : maxDev < 2 ? 'Good' : maxDev < 5 ? 'Acceptable' : 'Poor';
    var qcol  = maxDev < 0.5 ? '#5fd07a' : maxDev < 2 ? '#7ee787' : maxDev < 5 ? '#f7a600' : '#ff6b6b';

    var rows = items.map(function (it, i) {
      var actual = sol.actualFracs[i] * 100;
      var dev = actual - it.pct;
      var dcol = Math.abs(dev) < 0.5 ? '#5fd07a' : Math.abs(dev) < 3 ? '#f7a600' : '#ff6b6b';
      var contrib = sol.qs[i] * sol.ms[i] * it.time;
      var perCycle = sol.qs[i] * sol.ms[i];
      return '<tr>' +
        '<td><span style="display:inline-flex;align-items:center;gap:7px">' +
          '<i class="puopt-dot" style="background:' + it.color + '"></i><b>' + it.name + '</b></span>' +
          '<div class="puopt-nom">' + it.out + ' · ' + fmtTime(it.time) + ' / 1x</div></td>' +
        '<td style="text-align:center"><b style="color:#f7a600">' + sol.qs[i] + '</b></td>' +
        '<td style="text-align:center"><b style="color:#f7a600">' + sol.ms[i] + 'x</b></td>' +
        '<td style="font-family:monospace;color:#9a9a9a">' + sol.qs[i] + ' x ' + sol.ms[i] + ' x ' + fmtTime(it.time) + '</td>' +
        '<td>' + fmtTime(contrib) + '</td>' +
        '<td style="text-align:center">' + perCycle + '</td>' +
        '<td><b>' + actual.toFixed(2) + '%</b>' +
          '<div class="puopt-bar"><i style="width:' + Math.min(100, actual) + '%;background:' + it.color + '"></i></div></td>' +
        '<td style="color:#7a7a7a">' + it.pct.toFixed(1) + '%</td>' +
        '<td style="color:' + dcol + '">' + (dev >= 0 ? '+' : '') + dev.toFixed(2) + '%</td>' +
      '</tr>';
    }).join('');

    var slots = '';
    items.forEach(function (it, i) {
      for (var q = 0; q < sol.qs[i]; q++) {
        slots += '<span class="puopt-slot" style="background:' + it.color + ';color:#161616" title="' +
          it.name + ' x' + sol.ms[i] + '">' + it.out.replace(/[^A-Z0-9]/g, '').substring(0, 4) + '</span>';
      }
    });
    for (var s = sol.qTotal; s < maxQ; s++) {
      slots += '<span class="puopt-slot" style="background:#1e1e1e;color:#4a4a4a;border:1px dashed #3a3a3a">·</span>';
    }

    res.innerHTML = '<div class="puopt-sec"><h2>Result</h2><div style="padding:0">' +
      '<table class="puopt-t"><thead><tr>' +
        '<th>Recipe</th><th style="text-align:center">Slots (q)</th><th style="text-align:center">Multiplier (m)</th>' +
        '<th>Formula</th><th>Share of cycle</th><th style="text-align:center">Batches/cycle</th>' +
        '<th>Actual %</th><th>Target %</th><th>Deviation</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="puopt-sum">' +
        '<div><b>Slots used</b><span>' + sol.qTotal + ' / ' + maxQ + '</span></div>' +
        '<div><b>Full cycle</b><span>' + fmtTime(sol.cycleTotal) + '</span></div>' +
        '<div><b>Max deviation</b><span style="color:' + qcol + '">' + maxDev.toFixed(2) + '%</span></div>' +
        '<div><b>Quality</b><span style="color:' + qcol + '">' + qual + '</span></div>' +
      '</div>' +
      '<div style="padding:10px 12px;border-top:1px solid #333">' +
        '<div style="color:#7a7a7a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Queue - ' + sol.qTotal + ' / ' + maxQ + ' slots</div>' +
        slots +
        (sol.capped ? '<div class="puopt-nom" style="margin-top:8px">The search was capped (too many combinations) - this is the best result found, but it may not be the absolute optimum.</div>' : '') +
      '</div>' +
    '</div></div>';
  }

  // ─────────────────────────────────────────────────────────────
  //  Button in the header of the PROD / PRODQ / XIT PROD buffers
  // ─────────────────────────────────────────────────────────────
  function cmdText(frame) {
    var c = frame.querySelector(CMD_SEL);
    return c ? c.textContent.trim() : '';
  }

  // The button goes ONLY into the XIT PROD buffer, INSIDE its own controls row (⧉ − x ⋮).
  // That row is normal inline flow glued to the right edge of the header, so the button
  // always sits right next to the icons - no width measuring, no timing dependency.
  // CAUTION: TileFrame__controls itself is position:absolute with flex-start - put the
  // button directly in it and it hangs on the left with a ~90px gap. Hence the inner row.
  function ownControls(frame) {
    var list = frame.querySelectorAll('[class*="TileFrame__controls"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i], p = el.parentNode, own = true;
      while (p && p !== frame) {
        if (String(p.className || '').indexOf('TileFrame__frame') >= 0) { own = false; break; }
        p = p.parentNode;
      }
      if (own) return el;
    }
    return null;
  }

  function btnHost(frame, head) {
    var ctrl = ownControls(frame);
    if (!ctrl) return head;                       // fallback in case APEX changes
    return ctrl.querySelector('[class*="TileControls__controls"]')
        || ctrl.querySelector('[class*="TileControls__container"]')
        || head;
  }

  // Does the button fit: it must not stick out left of the header and the icons must stay on the same row.
  function fitsInHeader(btn, head, host) {
    var hr = head.getBoundingClientRect(), br = btn.getBoundingClientRect();
    var rows = [];
    for (var i = 0; i < host.children.length; i++) {
      var el = host.children[i];
      if (el === btn) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0) rows.push(r);
    }
    var sameRow = rows.every(function (r) { return Math.abs(r.top - br.top) < 12; });
    return br.left >= hr.left - 1 && sameRow;
  }

  function processFrame(frame) {
    var cmd  = cmdText(frame);
    var head = frame.querySelector(HEADER_SEL);
    if (!head) return;
    var host = btnHost(frame, head);
    var btn  = host.querySelector('[' + BTN_ATTR + ']') || head.querySelector('[' + BTN_ATTR + ']');

    var match = /^XIT\s+PROD\b/i.exec(cmd);   // only the XIT PROD buffer
    if (!match) { if (btn) btn.remove(); return; }

    var idMatch = /\b([0-9a-f]{8,32})\b/i.exec(cmd);
    var lineId = idMatch ? idMatch[1] : null;

    if (!btn) {
      injectCSS();                 // styles must exist as soon as the button is created
      btn = document.createElement('span');
      btn.setAttribute(BTN_ATTR, '1');
      btn.textContent = 'OPTIMIZER';
    }

    if (host !== head) {
      host.style.whiteSpace = 'nowrap';   // the icons must never wrap under the button
      // always first in the row; if React re-rendered the controls, put it back
      if (btn.parentNode !== host || host.firstChild !== btn) host.insertBefore(btn, host.firstChild);
      btn.style.marginLeft = '';
    } else if (btn.parentNode !== head) {
      btn.style.marginLeft = 'auto';
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.appendChild(btn);
    }

    // The label is chosen by REAL measurement, not by a threshold: try the full one,
    // and if it does not fit in the header - shorten it. Recomputed on every scan,
    // i.e. also when the buffer is resized.
    btn.textContent = 'OPTIMIZER';
    if (!fitsInHeader(btn, head, host)) {
      btn.textContent = 'OPT';
      if (!fitsInHeader(btn, head, host)) btn.textContent = '\u2699';
    }

    btn.title = lineId ? 'Optimizer for this line' : 'Production queue optimizer';
    btn.onclick = function (e) { e.stopPropagation(); e.preventDefault(); openModal(lineId); };
  }

  function scanAll() { document.querySelectorAll(FRAME_SEL).forEach(processFrame); }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scanAll(); }, 300);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  injectCSS();
  scanAll();
  // at browser start the layout settles late -> a few more passes
  [300, 1000, 2500, 5000].forEach(function (ms) { setTimeout(scanAll, ms); });

  // Ctrl+Shift+O - opens the optimizer from anywhere
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault(); e.stopPropagation(); openModal(null);
    }
  }, true);

  window.puQueueOptimizer = { open: openModal, lines: getLines };
})();
