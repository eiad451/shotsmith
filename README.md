# ShotSmith — استوديو التقاط المواقع

استوديو ثابت لالتقاط صور أي موقع بمقاسات أجهزة حقيقية، مع علامة مائية، ورمز QR،
وكود تضمين جاهز، ومقارنة لقطتين، وألبوم محفوظ على جهازك.

كل شيء يعمل في المتصفح. لا خادم، لا حسابات، لا مكتبة خارجية في وقت التشغيل.

## Live

```
https://<user>.github.io/shotsmith/
```

## What it does

| | |
|---|---|
| **Capture** | Any `http`/`https` URL, six device presets, Microlink with an automatic thum.io fallback |
| **Annotate** | Watermark label, sublabel, timestamp, source URL, four corners, four styles |
| **Export** | PNG or JPG with a quality slider, padded canvas, and a brand plate |
| **Share** | A hash-encoded link that restores target, options, and annotation |
| **QR** | A dependency-free QR encoder that runs entirely in the browser |
| **Compare** | A draggable split between any two shots in the album |
| **Studio** | Three sizes of the same page captured in one run |
| **Album** | Stored in `localStorage`, capped, oldest evicted first |
| **Theme** | Auto / light / dark, restored before first paint by a CSP-safe bootstrap |
| **PWA** | Installable, offline shell, maskable icon |

## Running it

Any static file server works — there is no build step.

```bash
npm run serve     # python3 -m http.server 4173
```

Open <http://localhost:4173>.

## Architecture

```
index.html            markup, CSP, and every dialog
sw.js                 offline shell
manifest.webmanifest  PWA manifest
assets/css/app.css    the whole design system
assets/js/
  app.js              state + wiring; the only file that touches the DOM broadly
  capture-engine.js   provider orchestration, retries, quota, CORS export
  device-presets.js   device list and provider URL builders
  target-guard.js     URL normalisation and private-range rejection
  dom.js              element helpers, toasts, clipboard, downloads
  exporter.js         canvas composition, watermark, download
  viewer.js           lightbox, zoom/pan, compare slider
  session-store.js    album and preferences in localStorage
  share-link.js       hash encode/decode
  command-bar.js      command palette and keyboard shortcuts
  qr-encoder.js       QR encoder
  qr-tables.js        generated QR tables
  theme-boot.js       pre-paint theme restore
```

State lives in one object in `app.js`; every panel re-renders from it through the
same `render*` functions. A change made from a shortcut, the palette, a shared
link, or a restored preference therefore cannot leave two panels disagreeing.

### Capture engines

Two providers, tried in the order you choose:

- **Microlink** — sends metadata plus a screenshot request.
- **thum.io** — the fallback. Only the option segments that were verified
  against the live service are emitted; the target URL is appended raw because
  a percent-encoded target is answered with `400`.

For exports the request is switched to Microlink's CORS passthrough
(`&embed=screenshot.url`) so the browser can read the bytes and compose the
watermark locally. No third-party canvas is ever tainted.

`connect-src` and `img-src` in the CSP are pinned to exactly those two hosts.

## Tests

```bash
npm test              # everything, one process per suite
npm run test:units    # pure logic, no DOM
npm run test:qr       # QR encoder against the reference oracle
```

| Suite | Covers |
|---|---|
| `units` | URL validation, provider URL construction, share links, album |
| `contracts` | CSP, markup, icons, service-worker precache list, DOM id integrity |
| `qr-oracle` | 288 matrices against a reference encoder |
| `boot` | Render, validation messages, option controls, format gating |
| `capture` | Request shape, metadata, quota, redirects, gallery, share hash |
| `dialogs` | Watermark export, QR, embed snippets, viewer, compare |
| `studio` | Three-size run, batch download, album actions |
| `history` | Theme cycling, command palette, shortcuts, album reset |
| `accessibility` | Labels, roles, live regions, focus handling, keyboard reach |

### A note on this sandbox

The test host is an Android container whose Node segfaults intermittently under
memory pressure — the same test that passes on one run dies on the next, at a
different line, with identical input. `test/run-suite.mjs` therefore runs each
suite in its own process and retries a process that died on a signal. Only a
suite that reports a `FAIL` line counts as a failure; a dying process does not.

Each behavioral phase runs as a separate file for the same reason: one
long-lived process accumulates enough DOM to trigger the crash.

## Regenerating assets

```bash
npm run icons        # assets/icons/icon-*.png from icon.svg
npm run qr-tables    # assets/js/qr-tables.js from tools/gen-qr-tables.py
```

## Privacy

Captures go to Microlink or thum.io — the page is rendered on their servers,
never on yours. Nothing else leaves the browser. The album, preferences, and
theme live in `localStorage` and never leave the device.