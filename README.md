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
| [`apex-close-all.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/apex-close-all.user.js) | 1.0 | Closes all floating buffers: XA button, `XIT XA`, `Ctrl+Shift+X` | - |
| [`prun-shpt-marquee-select.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/prun-shpt-marquee-select.user.js) | 2.0.0 | Fixes drag multi-select for SHPT rows in INV / SHPI | - |
| [`cxpo-cp-price.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/cxpo-cp-price.user.js) | 1.2 | Shows Corp Price (CP) from a Google Sheet in the CXPO place-order form | `SHID` / `SHN` at the top of the file - point them at your own sheet |

## Notes

- The buffers are in English; code comments are in Bulgarian, except
  `apex-queue-optimizer.user.js` and `cxpo-cp-price.user.js`, which are fully in English.
- `SSB.diag()` in the browser console prints a status report if SSB does not show up.
- Found a bug or want a feature? Ping Stokovich.
