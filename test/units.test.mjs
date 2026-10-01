/**
 * Pure-logic unit tests: target validation, provider URL construction, share
 * links and preference storage. No DOM involved, so these run anywhere.
 *
 *   node test/units.test.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function say(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

/* localStorage shim: session-store reads it at import time. */
class MemoryStorage {
  #map = new Map();
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(key, String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.crypto ??= (await import("node:crypto")).webcrypto;

const { TargetError, hostLabel, normalizeTarget } = await import("../assets/js/target-guard.js");
const {
  DEFAULT_OPTIONS,
  buildMicrolinkUrl,
  buildThumioUrl,
  describeOptions,
  findDevice,
  findFormat,
} = await import("../assets/js/device-presets.js");
const { decodeState, encodeState } = await import("../assets/js/share-link.js");

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

function throwsWith(label, fn, pattern) {
  checks += 1;
  try {
    fn();
    failures += 1;
    say(`  FAIL ${label} — no error thrown`);
  } catch (error) {
    if (error instanceof TargetError && pattern.test(error.message)) {
      say(`  ok   ${label}`);
      return;
    }
    failures += 1;
    say(`  FAIL ${label} — ${error.name}: ${error.message}`);
  }
}

function section(title) {
  say(`\n${title}`);
}

/* ----------------------------------------------------------- target guard */

section("target-guard: accepted");
const cases = [
  ["example.com", "https://example.com/"],
  ["  example.com  ", "https://example.com/"],
  ["https://example.com/pricing?a=1#frag", "https://example.com/pricing?a=1"],
  ["http://example.com:8080/x", "http://example.com:8080/x"],
  ["sub.domain.co.uk", "https://sub.domain.co.uk/"],
];
for (const [input, expected] of cases) {
  check(`normalize ${JSON.stringify(input)}`, normalizeTarget(input).url === expected, normalizeTarget(input).url);
}
check("host strips www", normalizeTarget("https://www.example.com").host === "example.com");
check("secure flag", normalizeTarget("https://a.com").secure === true);
check("insecure flag", normalizeTarget("http://a.com").secure === false);
check("hostLabel strips www", hostLabel("https://www.a.com/x") === "a.com");
check("hostLabel passthrough", hostLabel("not a url") === "not a url");

section("target-guard: rejected");
throwsWith("empty input", () => normalizeTarget(""), /اكتب رابط/);
throwsWith("whitespace only", () => normalizeTarget("   "), /اكتب رابط/);
throwsWith("javascript scheme", () => normalizeTarget("javascript:alert(1)"), /http و https/);
throwsWith("data scheme", () => normalizeTarget("data:text/html,<h1>x"), /http و https/);
throwsWith("file scheme", () => normalizeTarget("file:///etc/passwd"), /http و https/);
throwsWith("ftp scheme", () => normalizeTarget("ftp://a.com"), /http و https/);
throwsWith("localhost", () => normalizeTarget("http://localhost:3000"), /شبكة داخلية|محلية/);
throwsWith("127.0.0.1", () => normalizeTarget("http://127.0.0.1"), /شبكة داخلية|محلية/);
throwsWith("10.x", () => normalizeTarget("http://10.0.0.5"), /شبكة داخلية|محلية/);
throwsWith("192.168.x", () => normalizeTarget("http://192.168.1.1"), /شبكة داخلية|محلية/);
throwsWith("link-local", () => normalizeTarget("http://169.254.1.1"), /شبكة داخلية|محلية/);
throwsWith("ipv6 loopback", () => normalizeTarget("http://[::1]:80"), /شبكة داخلية|محلية/);
throwsWith("fc00 range", () => normalizeTarget("http://[fd00::1]"), /شبكة داخلية|محلية/);
throwsWith("dot local", () => normalizeTarget("http://printer.local"), /شبكة داخلية|محلية/);
throwsWith("single label", () => normalizeTarget("intranet"), /اسم النطاق ناقص/);
throwsWith("odd port", () => normalizeTarget("http://example.com:1234"), /المنفذ/);
throwsWith("over 2048 chars", () => normalizeTarget(`https://a.com/${"x".repeat(2100)}`), /طويل جداً/);

/* ------------------------------------------------------------- providers */

section("device-presets: lookups");
check("default device is desktop", findDevice(DEFAULT_OPTIONS.deviceId).id === "desktop-hd");
check("unknown device falls back", findDevice("nope").id === "desktop-hd");
check("unknown format falls back to png", findFormat("webp").id === "png");
check("iphone is mobile", findDevice("iphone-15-pro").mobile === true);
check("desktop is not mobile", findDevice("desktop-hd").mobile === false);
check("describe includes dimensions", describeOptions(DEFAULT_OPTIONS).join(" ").includes("1920×1080"));
check("describe honours fullPage", describeOptions({ ...DEFAULT_OPTIONS, fullPage: true }).includes("الصفحة كاملة"));

section("microlink url");
const base = "https://example.com/pricing";
const ml = new URL(buildMicrolinkUrl(base, DEFAULT_OPTIONS, "image"));
check("scheme+host", ml.host === "api.microlink.io");
check("url param round-trips", ml.searchParams.get("url") === base);
check("screenshot enabled", ml.searchParams.get("screenshot") === "true");
check("viewport width", ml.searchParams.get("viewport.width") === "1920");
check("viewport height", ml.searchParams.get("viewport.height") === "1080");
check("desktop has no mobile flag", ml.searchParams.get("viewport.mobile") === null);
check("fullPage false by default", ml.searchParams.get("screenshot.fullPage") === "false");
check("png type", ml.searchParams.get("screenshot.type") === "png");
check("no quality for png", ml.searchParams.get("screenshot.quality") === null);
check("image mode asks for the cors passthrough", ml.searchParams.get("embed") === "screenshot.url");
check("image mode disables meta", ml.searchParams.get("meta") === "false");

const mlJpg = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, format: "jpeg", quality: 55 }, "image"));
check("jpg type", mlJpg.searchParams.get("screenshot.type") === "jpeg");
check("jpg quality applied", mlJpg.searchParams.get("screenshot.quality") === "55");

const mlMobile = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, deviceId: "iphone-15-pro" }, "render"));
check("mobile flag set", mlMobile.searchParams.get("viewport.mobile") === "true");
check("render mode asks for meta", mlMobile.searchParams.get("meta") === "true");
check("render mode has no embed", mlMobile.searchParams.get("embed") === null);

const mlEl = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, element: "  header  " }, "render"));
check("selector trimmed", mlEl.searchParams.get("screenshot.element") === "header");
const mlEmptyEl = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, element: "   " }, "render"));
check("blank selector omitted", mlEmptyEl.searchParams.get("screenshot.element") === null);
const mlWait = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, waitForTimeout: 999999 }, "render"));
check("wait clamped to 30s", mlWait.searchParams.get("waitForTimeout") === "30000");
const mlNoWait = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, waitForTimeout: 0 }, "render"));
check("zero wait omitted", mlNoWait.searchParams.get("waitForTimeout") === null);
const mlBg = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, omitBackground: true, format: "jpeg" }, "render"));
check("omitBackground dropped for jpg", mlBg.searchParams.get("screenshot.omitBackground") === null);
const mlBgPng = new URL(buildMicrolinkUrl(base, { ...DEFAULT_OPTIONS, omitBackground: true }, "render"));
check("omitBackground kept for png", mlBgPng.searchParams.get("screenshot.omitBackground") === "true");

section("thum.io url — path segments must stay in their slots");
const thum = buildThumioUrl(base, DEFAULT_OPTIONS);
check("prefix", thum.startsWith("https://image.thum.io/get/"));
check("viewportWidth first", thum.startsWith("https://image.thum.io/get/viewportWidth/1920/"), thum);
check("viewportHeight second", thum.startsWith("https://image.thum.io/get/viewportWidth/1920/viewportHeight/1080/"), thum);
check("width capped at 1600", thum.includes("/width/1600/"), thum);
check("target is the raw remainder after the last option", thum.endsWith(base), thum);
check("no unverified hideScrollbars", !thum.includes("hideScrollbars"));
check("noanimate present", thum.includes("/noanimate/"));
check("cache window present", thum.includes("/maxAge/6/"));
check("no fullpage by default", !thum.includes("/fullpage/"));
check("no allowJPG by default", !thum.includes("/allowJPG"));
check("default wait is carried", thum.includes("/wait/2/"), thum);

const thumPhone = buildThumioUrl(base, {
  ...DEFAULT_OPTIONS,
  deviceId: "iphone-15-pro",
  fullPage: true,
  format: "jpeg",
  waitForTimeout: 4000,
});
check("phone viewportWidth", thumPhone.startsWith("https://image.thum.io/get/viewportWidth/393/"), thumPhone);
check("phone width follows viewport", thumPhone.includes("/width/393/"), thumPhone);
check("fullpage segment", thumPhone.includes("/fullpage/"));
check("allowJPG segment", thumPhone.includes("/allowJPG/"));
check("wait in seconds", thumPhone.includes("/wait/4/"));
check("phone target last", thumPhone.endsWith(base), thumPhone);

check(
  "wait capped at 10s",
  buildThumioUrl(base, { ...DEFAULT_OPTIONS, waitForTimeout: 30000 }).includes("/wait/10/")
);
check(
  "wait rounds up from ms",
  buildThumioUrl(base, { ...DEFAULT_OPTIONS, waitForTimeout: 1200 }).includes("/wait/2/")
);

section("thum.io: query strings and paths reach the target intact");
const queryTarget = "https://example.com/p?id=7&lang=ar";
const thumQuery = buildThumioUrl(queryTarget, DEFAULT_OPTIONS);
check("query target appended raw", thumQuery.endsWith(queryTarget), thumQuery);
check("query target not percent-encoded", !thumQuery.includes("%3A%2F%2F"), thumQuery);
check("hash-free target stays a single tail", buildThumioUrl("https://example.com/a b", DEFAULT_OPTIONS).endsWith("https://example.com/a b"));

/* ------------------------------------------------------------ share link */

section("share-link round trip");
const state = {
  url: "https://example.com/pricing?a=1",
  options: { deviceId: "iphone-15-pro", format: "jpeg", quality: 70 },
  annotation: { label: "ShotSmith", corner: "top-end", showUrl: false },
};
const token = encodeState(state);
check("token is base64url safe", /^[A-Za-z0-9_-]+$/.test(token), token.slice(0, 24));
check("no padding", !token.includes("="));
const decoded = decodeState(token);
check("url survives", decoded.url === state.url);
check("options survive", decoded.options.deviceId === "iphone-15-pro");
check("numeric option survives", decoded.options.quality === 70);
check("annotation survives", decoded.annotation.label === "ShotSmith");
check("boolean option survives", decoded.annotation.showUrl === false);
check("unicode url survives", decodeState(encodeState({ ...state, url: "https://مثال.com/صفحة" })).url === "https://مثال.com/صفحة");
check("garbage token returns null", decodeState("!!!not-base64!!!") === null);
check("empty token returns null", decodeState("") === null);
check("wrong version returns null", decodeState(Buffer.from(JSON.stringify({ v: 99 })).toString("base64url")) === null);

/* --------------------------------------------------------- session store */

section("session-store");
const { gallery, prefs } = await import("../assets/js/session-store.js");
check("starts empty", gallery.entries.length === 0);
const entry = gallery.add({ host: "example.com", url: base, imageUrl: "https://x/1.png", thumbnail: "data:,", width: 100, height: 50 });
check("add returns an id", typeof entry.id === "string" && entry.id.length > 10);
check("entry stored", gallery.entries.length === 1);
check("dedupes by imageUrl", gallery.add({ host: "b.com", url: base, imageUrl: "https://x/1.png" }).imageUrl === "https://x/1.png");
check("no duplicate rows", gallery.entries.length === 1);
gallery.add({ host: "c.com", url: base, imageUrl: "https://x/2.png" });
check("newest first", gallery.entries[0].host === "c.com");
check("find by id", gallery.find(gallery.entries[1].id).host === "b.com", gallery.entries[1].host);
check("find unknown returns null", gallery.find("nope") === null);
gallery.remove(gallery.entries[0].id);
check("remove works", gallery.entries.length === 1);

let evicted = false;
gallery.subscribe((_entries, meta) => {
  if (meta?.evicted) evicted = true;
});
for (let i = 0; i < 40; i += 1) {
  gallery.add({ host: `h${i}.com`, url: base, imageUrl: `https://x/${i}.png`, thumbnail: `data:,${"x".repeat(2000)}` });
}
check("history is capped at 24", gallery.entries.length <= 24, String(gallery.entries.length));
check("eviction reported when trimming", evicted || gallery.writable);

check("prefs load empty", JSON.stringify(prefs.load().options) === "{}");
prefs.save({ options: { deviceId: "pixel-8" } });
prefs.save({ annotation: { label: "x" } });
check("options merge", prefs.load().options.deviceId === "pixel-8");
check("annotation merges separately", prefs.load().annotation.label === "x");
prefs.save({ options: { format: "jpeg" } });
check("later save keeps earlier option", prefs.load().options.deviceId === "pixel-8");
check("later save adds new option", prefs.load().options.format === "jpeg");
prefs.reset();
check("reset clears", JSON.stringify(prefs.load().options) === "{}");

/* ------------------------------------------------------------------ done */

say(`\n${checks - failures}/${checks} unit checks passed`);
if (failures) process.exitCode = 1;