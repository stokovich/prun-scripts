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
| [`cxpo-cp-price.user.js`](https://raw.githubusercontent.com/stokovich/prun-scripts/main/cxpo-cp-price.user.js) | 1.3 | Shows the corp price (CP) next to the CXPO place-order form | - |

## Contract bookmarklet

A bookmarklet, not a userscript: it fills a contract draft in `CONTD` from a short shopping list -
materials, quantities, corp prices (CP), currency, shipment price, deadlines and destination.

| Page | Version | Browser |
|---|---|---|
| [`pu-contract-bookmarklet.html`](https://stokovich.github.io/prun-scripts/pu-contract-bookmarklet.html) | 3.4 | Chrome / Edge |
| [`pu-contract-bookmarklet-firefox.html`](https://stokovich.github.io/prun-scripts/pu-contract-bookmarklet-firefox.html) | 3.4 | Firefox |

Open the page for your browser and **drag the golden link onto the bookmarks bar** - the page itself
explains the rest. Firefox needs its own page because it blocks a `javascript:` link dropped from a page;
that page walks you through adding the bookmark by hand.

Then open the APEX tab, click the bookmark, fill in the list and press **RUN**. Re-drag the bookmark after
every new version - a bookmarklet carries its whole code inside the bookmark and cannot update itself.

## Notes

- Everything is in English - buffers, pages and code comments.
- `SSB.diag()` in the browser console prints a status report if SSB does not show up.
- The corp prices come from a read-only sheet that holds nothing but ticker + price.
- Found a bug or want a feature? Ping Stokovich.
