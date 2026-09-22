# PrUn userscripts

Userscripts for APEX (Prosperous Universe), on top of [Refined PrUn](https://github.com/refined-prun/refined-prun).
They work the same in Chrome and Firefox.

## Install

1. Install **Tampermonkey** ([Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)).
2. **Chrome only, do this once:** open `chrome://extensions`, click **Details** on Tampermonkey and turn on **Allow User Scripts**
   (older Chrome: turn on **Developer mode** in the top-right corner instead). Without it Tampermonkey runs nothing and
   an `XIT SSB` buffer just shows Refined PrUn's `Error! No Matching Function!`.
3. Click a script link below - Tampermonkey opens its install page - then **Install**.
4. Press **F5** on the APEX tab. Tampermonkey only picks up new or changed scripts on a page load.

Updates are automatic: each script carries an `@updateURL`, so Tampermonkey pulls new versions from this repo
(Dashboard -> **Check for userscript updates** forces it).

## Scripts

| Script | Version | What it does | Settings |
|---|---|---|---|
| [`ssb.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/ssb.user.js) | 3.8 | Own buffer with reports: `SSB VZEM` (receivables per partner) and `SSB PART` (outstanding contract conditions, with FULFILL buttons) | - |
| [`apex-queue-optimizer.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-queue-optimizer.user.js) | 1.8 | Production queue optimizer: OPTIMIZER button in XIT PROD, `Ctrl+Shift+O` | - |
| [`apex-prod-status.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-prod-status.user.js) | 2.1 | Badge in PROD / XIT PROD: green All OK, or red Check (N) when slots are free | - |
| [`apex-auto-act.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-auto-act.user.js) | 1.5 | Act button in XIT ACT: presses ACT as soon as it is enabled, stops before Start on flights | FLIGHT_MODE at the top of the file |
| [`apex-dsp-defaults.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-dsp-defaults.user.js) | 1.1 | XIT DSP: sticky ship column, taller buffer, default values | defaults at the top of the file |
| [`apex-flt-home-button.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-flt-home-button.user.js) | 1.1 | FLT: one-click flight home for a ship docked elsewhere | HOME = your home station (default MOR) |
| [`apex-burnact-defaults.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-burnact-defaults.user.js) | 1.0 | XIT BURNACT: turns on Skip CX Buy and picks a default warehouse | warehouse name at the top of the file |
| [`apex-close-all.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js) | 1.0 | Closes all floating buffers: XA button, `XIT XA`, `Ctrl+Shift+X` | - |
| [`pu-fulfill-all.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/pu-fulfill-all.user.js) | 2.0.0 | FULFILL ALL button in CONT: presses every enabled FULFILL | - |
| [`prun-shpt-marquee-select.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/prun-shpt-marquee-select.user.js) | 2.0.0 | Fixes drag multi-select for SHPT rows in INV / SHPI | - |
| [`apex-sfc-auto-destination.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-sfc-auto-destination.user.js) | 1.4 | SFC: always enables Unload on arrival | - |

## Notes

- Comments inside the files are in Bulgarian; the buffers themselves are in English.
  `apex-queue-optimizer.user.js` is fully in English.
- Scripts with a **Settings** note have a couple of constants at the top of the file
  (home station, warehouse, defaults) - change them to match your own base before use.
- `SSB.diag()` in the browser console prints a status report if SSB does not show up.
- Found a bug or want a feature? Ping Stokovich.
