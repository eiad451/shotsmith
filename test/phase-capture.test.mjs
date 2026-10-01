/**
 * Phase 2 — the capture flow, provider response handling, and share links.
 *
 *   node test/phase-capture.test.mjs
 */

import { settle } from "./dom-harness.mjs";
import { boot } from "./flows.mjs";

const app = await boot();
const { env, window, $, $$, check, section, type, capture, choose, say } = app;

/* ------------------------------------------------------------ capture */

section("capture flow");
const imageUrl = await capture("example.com/pricing");

check("capture button re-enabled", $("#captureButton").disabled === false);
check("empty state hidden", $("#stageEmpty").hidden === true);
check("device frame visible", $("#deviceFrame").hidden === false);
check("image wired to microlink", $("#captureImage").src.includes("api.microlink.io"), $("#captureImage").src.slice(0, 90));
check("status tone is ok", $("#statusBar").dataset.tone === "ok", $("#statusBar").dataset.tone);
check("status title set", $("#statusTitle").textContent.length > 0, $("#statusTitle").textContent);
check("status detail shows size", $("#statusDetail").textContent.includes("1280×720"), $("#statusDetail").textContent);

section("metadata from the provider");
check("meta strip populated", $$("#metaStrip .meta-strip__item").length >= 4, String($$("#metaStrip .meta-strip__item").length));
check("page title shown", $("#pageMeta").textContent.includes("Pricing — Example"), $("#pageMeta").textContent.slice(0, 60));
check(
  "redirect chain lifted from the top level",
  $$("#pageMeta .redirect-chain li").length === 3,
  String($$("#pageMeta .redirect-chain li").length)
);

section("quota telemetry");
check("quota rendered from headers", $("#quotaValue").textContent === "22/50", $("#quotaValue").textContent);
check("quota bar width set", $("#quotaFill").style.width === "44%", $("#quotaFill").style.width);

section("gallery");
check("one entry added", $$("#gallery .shot").length === 1, String($$("#gallery .shot").length));
check("count label is arabic-pluralised", $("#galleryCount").textContent === "1 لقطة", $("#galleryCount").textContent);
check("empty hint hidden", $("#galleryEmpty").hidden === true);
check("thumbnail composited on a canvas", env.canvasCalls.drawImage >= 1, String(env.canvasCalls.drawImage));

section("share hash");
check("hash written", window.location.hash.length > 8, window.location.hash);
const { decodeState } = await import("../assets/js/share-link.js");
const shared = decodeState(window.location.hash.slice(1));
check("hash decodes", shared !== null);
check("hash carries the target", shared?.url === "https://example.com/pricing", shared?.url);
check("hash carries options", typeof shared?.options === "object");
check("hash carries annotation", typeof shared?.annotation === "object");

section("provider request shape");
const microlinkCall = env.fetches.filter((f) => f.url.includes("api.microlink.io"));
check("microlink was called", microlinkCall.length === 1, String(microlinkCall.length));
const request = new URL(microlinkCall[0].url);
check("request targets the normalized url", request.searchParams.get("url") === "https://example.com/pricing");
check("request asks for a screenshot", request.searchParams.get("screenshot") === "true");
check("request asks for metadata", request.searchParams.get("meta") === "true");
check("no CORS passthrough on the metadata call", request.searchParams.get("embed") === null, request.searchParams.get("embed"));

/* ------------------------------------------------- device / format flow */

section("second capture at another size");
choose("devicePicker", "ipad-pro");
await settle();
await capture("example.com/about");
check("image url rebuilt for the new device", $("#captureImage").src.includes("viewport.width=834"), $("#captureImage").src.slice(0, 120));
check("two gallery entries", $$("#gallery .shot").length === 2, String($$("#gallery .shot").length));
check("newest entry is first", $$("#gallery .shot")[0].textContent.includes("iPad Pro"), $$("#gallery .shot")[0].textContent.slice(0, 60));

section("JPEG format end to end");
choose("formatPicker", "jpeg");
await settle();
await capture("example.com/jpeg-test");
check("capture used screenshot.type=jpeg", env.fetches.at(-1).url.includes("screenshot.type=jpeg"), env.fetches.at(-1).url.slice(0, 140));
check("quality parameter sent for jpeg", /screenshot\.quality=\d+/.test(env.fetches.at(-1).url), env.fetches.at(-1).url.slice(-60));

/* ---------------------------------------------------------- rejections */

section("bad target never reaches the network");
const callsBefore = env.fetches.length;
type(app.urlInput, "http://127.0.0.1");
$("#captureForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await settle(6);
check("no fetch issued for a private host", env.fetches.length === callsBefore, String(env.fetches.length - callsBefore));
check("status reports the rejection", $("#statusBar").dataset.tone !== "ok", $("#statusBar").dataset.tone);

section("normalisation");
await capture("  EXAMPLE.com  ");
check("host lowercased and trimmed", env.fetches.at(-1).url.includes("url=https%3A%2F%2Fexample.com%2F"), env.fetches.at(-1).url.slice(0, 90));
check("capture image reflects the normalized target", $("#captureImage").src.startsWith("https://api.microlink.io"), $("#captureImage").src.slice(0, 40));

void say;
app.summary();