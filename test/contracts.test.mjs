/**
 * Static contract tests.
 *
 * These catch the failure mode unit tests cannot see: markup and code drifting
 * apart. Every id and every action the HTML exposes must exist in app.js, and
 * every class app.js writes must exist in the stylesheet — otherwise the UI
 * silently does nothing with no error anywhere.
 *
 *   node test/contracts.test.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately does not import the jsdom harness: this file is pure text
// analysis and must stay runnable without a DOM.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/app.css"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/app.js"), "utf8");
const viewer = readFileSync(resolve(ROOT, "assets/js/viewer.js"), "utf8");
const sw = readFileSync(resolve(ROOT, "sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.webmanifest"), "utf8"));

// Progress goes to stderr on purpose: stdout is block-buffered when redirected,
// and this sandbox's Node occasionally dies with SIGSEGV under memory pressure
// — an unbuffered log keeps whatever ran before the crash.
function say(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    say(`  ok   ${label}`);
    return;
  }
  failures += 1;
  say(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  say(`\n${title}`);
}

/** Every capture group of every match, flattened. */
function matchAll(source, pattern) {
  return [...source.matchAll(pattern)].flatMap((match) => match.slice(1).filter(Boolean));
}

section("ids: every id app.js caches must exist in index.html");
const nodeIds = app.match(/const NODE_IDS = \[([\s\S]*?)\];/)[1]
  .split(",")
  .map((token) => token.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);
const htmlIds = new Set(matchAll(html, /\sid="([^"]+)"/g));
check("NODE_IDS parsed", nodeIds.length > 30, `${nodeIds.length} ids`);
for (const id of nodeIds) {
  check(`#${id} present`, htmlIds.has(id));
}

section("ids: every #id app.js queries must exist");
const queried = new Set(matchAll(app, /\$\("#([\w-]+)"\)/g));
for (const id of queried) {
  check(`$("#${id}") resolves`, htmlIds.has(id), "queried by id but not in markup");
}

section("data-role hooks: query selectors in js vs markup");
const allJs = app + viewer;
for (const role of matchAll(allJs, /\[data-role='([\w-]+)'\]/g)) {
  check(`data-role='${role}' in markup`, html.includes(`data-role="${role}"`));
}
for (const role of matchAll(html, /data-role="([\w-]+)"/g)) {
  check(`data-role="${role}" consumed by js`, allJs.includes(`data-role='${role}'`));
}

section("actions: every data-action must be handled, and vice versa");
const actionsBlock = app.match(/const ACTIONS = \{([\s\S]*?)\n\};/)[1];
const handled = new Set(
  matchAll(actionsBlock, /^\s*(?:"([\w-]+)"|([\w]+))\s*:/gm),
);
const declared = new Set(matchAll(html, /data-action="([\w-]+)"/g));

// The lightbox zoom controls are bound in viewer.js by selector, not through
// the ACTIONS table, and `cancel` is created on demand while a capture runs.
// Both are real handlers, just not declarative ones.
for (const action of ["zoom-in", "zoom-out", "zoom-fit"]) {
  check(`action '${action}' bound by viewer.js`, viewer.includes(`data-action='${action}'`));
}
check("dynamic cancel button exists in code", /dataset:\s*\{\s*action:\s*"cancel"/.test(app));

for (const action of declared) {
  check(`action '${action}' handled`, handled.has(action) || viewer.includes(`'${action}'`));
}
for (const action of handled) {
  if (action === "cancel") continue;
  check(`action '${action}' has a button`, declared.has(action), "handler is unreachable");
}

section("keyboard handlers referenced by markup hints");
check("Ctrl+K documented in help", /<kbd>Ctrl<\/kbd> \+ <kbd>K<\/kbd>/.test(html));
check("mod+k bound in code", /"mod\+k":/.test(app));

section("classes: every class app.js writes must exist in the stylesheet");
const written = new Set([
  ...matchAll(app, /class:\s*"([a-z][\w -]*)"/g),
  ...matchAll(app, /className\s*=\s*`([^`$]*)`/g),
  ...matchAll(app, /dataset:\s*\{\s*tone/g),
]);
for (const group of written) {
  for (const name of group.split(/\s+/).filter(Boolean)) {
    if (!/^[a-z][\w-]*$/.test(name)) continue;
    if (name.startsWith("device--")) {
      check(`.${name}`, css.includes(`.${name}`), "dynamic modifier class missing");
      continue;
    }
    check(`.${name}`, css.includes(`.${name}`));
  }
}

section("Content-Security-Policy: no inline style or script attributes");
const inlineStyles = matchAll(html, /\sstyle="[^"]*"/g);
check("no style attributes (style-src has no 'unsafe-inline')", inlineStyles.length === 0, inlineStyles.join(", "));
check("no inline <script> blocks", !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html));
check("CSP present", html.includes("Content-Security-Policy"));
check("theme bootstrap is an external file", html.includes('src="assets/js/theme-boot.js"'));

section("providers: engine hosts allowed by connect-src/img-src");
const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
check("connect-src allows api.microlink.io", /connect-src[^;]*https:\/\/api\.microlink\.io/.test(csp));
check("connect-src allows image.thum.io", /connect-src[^;]*https:\/\/image\.thum\.io/.test(csp));
check("no thum.io option outside verified set", !/thum\.io\/get\/[^"]*hideScrollbars/.test(
  readFileSync(resolve(ROOT, "assets/js/device-presets.js"), "utf8"),
));

section("manifest: icon files must exist on disk");
for (const icon of manifest.icons) {
  check(`${icon.src} exists`, existsSync(resolve(ROOT, icon.src)));
}
check("manifest start_url is relative", manifest.start_url === "./");
check("manifest has maskable icon", manifest.icons.some((i) => i.purpose === "maskable"));

section("service worker: precache list must match real files");
const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1]
  .split("\n")
  .map((line) => line.trim().replace(/^"|",?$|,$/g, ""))
  .filter((line) => line.startsWith("./"));
for (const entry of shell) {
  const path = resolve(ROOT, entry.slice(2));
  check(`precache ${entry}`, existsSync(path));
}

section("app.js: every cached node and dialog must exist in the markup");
{
  const appSrc = readFileSync(resolve(ROOT, "assets/js/app.js"), "utf8");
  const declared = appSrc.match(/const NODE_IDS = \[([\s\S]*?)\];/)[1].match(/"[^"]+"/g).map((s) => s.slice(1, -1));
  // Dialogs are cached separately in cacheNodes(); both groups must resolve.
  const cached = new Set(declared);
  for (const dialog of ["helpDialog", "viewerDialog", "compareDialog", "paletteDialog"]) cached.add(dialog);
  for (const id of cached) {
    check(`node ${id} exists in index.html`, html.includes(`id="${id}"`));
  }
  // A nodes.X read that is neither declared nor assigned is a runtime TypeError
  // waiting for the first click that reaches it.
  const assigned = new Set([...appSrc.matchAll(/nodes\.([A-Za-z0-9_]+)\s*=/g)].map((m) => m[1]));
  const read = new Set([...appSrc.matchAll(/nodes\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const unresolved = [...read].filter((key) => !cached.has(key) && !assigned.has(key));
  check("no unresolved nodes.* references", unresolved.length === 0, unresolved.join(", "));
}

section("app.js: DOM ids the app writes to must exist");
for (const id of [...readFileSync(resolve(ROOT, "assets/js/app.js"), "utf8")
  .matchAll(/getElementById\("([^"]+)"\)|\$\("#([A-Za-z0-9_]+)"\)/g)]
  .map((m) => m[1] ?? m[2])) {
  check(`selector #${id} resolves`, html.includes(`id="${id}"`));
}

say(`\n${checks - failures}/${checks} contract checks passed`);
if (failures) process.exitCode = 1;