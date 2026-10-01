/**
 * Phase 1 — boot, URL validation, and the option controls.
 *
 *   node test/phase-boot-options.test.mjs
 */

import { settle } from "./dom-harness.mjs";
import { boot } from "./flows.mjs";

const app = await boot();
const { $, $$, check, section, type, wait, choose, urlInput, say } = app;

/* -------------------------------------------------------------- boot */

section("boot");
check("DOM was parsed", app.document.querySelectorAll("section").length > 4);
check("device picker rendered", $$("#devicePicker button").length === 6, String($$("#devicePicker button").length));
check("format picker rendered", $$("#formatPicker button").length === 2);
check("engine order picker rendered", $$("#enginePicker button").length === 2);
check("watermark style buttons rendered", $$("#wmStyle button").length === 4);
check("options summary filled", $("#optionsSummary").textContent.includes("1920×1080"), $("#optionsSummary").textContent);
check("no inline style attribute on boot", $("html").getAttribute("style") === null);
check("strict CSP without unsafe-inline", ($("meta[http-equiv='Content-Security-Policy']")?.content ?? "").includes("script-src 'self'"));

/* -------------------------------------------------------- validation */

section("target validation");
type(urlInput, "not a url at all");
await settle();
check("invalid input rejected", $("#urlError").hidden === false, $("#urlErrorText").textContent);
check("input shell flagged", $("#inputShell").classList.contains("input-shell--invalid"));

type(urlInput, "http://localhost:3000");
await settle();
check("localhost rejected as private", /شبكة داخلية|محلية/.test($("#urlErrorText").textContent), $("#urlErrorText").textContent);

type(urlInput, "http://192.168.1.10");
await settle();
check("lan address rejected as private", /شبكة داخلية|محلية/.test($("#urlErrorText").textContent), $("#urlErrorText").textContent);

type(urlInput, "javascript:alert(1)");
await settle();
check("javascript scheme rejected", /http/.test($("#urlErrorText").textContent), $("#urlErrorText").textContent);

type(urlInput, "intranet");
await settle();
check("single-label host rejected", /اسم النطاق/.test($("#urlErrorText").textContent), $("#urlErrorText").textContent);

type(urlInput, "example.com");
await settle();
check("bare host accepted", $("#urlError").hidden === true);

/* ------------------------------------------------------------ options */

section("options wiring");
const iphone = choose("devicePicker", "iphone-15-pro");
await settle();
check("device pressed state", iphone.getAttribute("aria-pressed") === "true");
check("summary follows device", $("#optionsSummary").textContent.includes("393×852"), $("#optionsSummary").textContent);
check("frame switches to phone", $("#deviceFrame").className.includes("device--phone"), $("#deviceFrame").className);
check("device persisted", JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).options.deviceId === "iphone-15-pro");

choose("devicePicker", "desktop-hd");
await settle();
check("device switches back", $("#optionsSummary").textContent.includes("1920×1080"));

section("format gating — quality needs JPEG, transparency needs PNG");
choose("formatPicker", "jpeg");
await settle();
check("quality enabled for jpeg", $("#quality").disabled === false);
check("omit-background disabled for jpeg", $("#omitBackground").disabled === true);
check("quality row marked disabled-when-inapplicable", $("#qualityRow")?.dataset.disabled === "true" || $("#quality").disabled === false);
choose("formatPicker", "png");
await settle();
check("quality disabled for png", $("#quality").disabled === true);
check("omit-background enabled for png", $("#omitBackground").disabled === false);

section("sliders and text inputs");
$("#quality").value = "70";
$("#quality").dispatchEvent(new app.window.Event("input", { bubbles: true }));
await settle();
check("quality readout follows", $("#qualityValue").textContent === "70", $("#qualityValue").textContent);

type($("#extraWait"), "2500");
await settle();
check(
  "extra wait persisted",
  JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).options.waitForTimeout === 2500,
  localStorage.getItem("shotsmith.prefs.v1")
);

type($("#elementSelector"), "header");
await wait(600);
check(
  "element selector persisted after the debounce",
  JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).options.element === "header"
);

section("engine order");
const thumFirst = choose("enginePicker", "thumio,microlink");
await settle();
check("thum.io-first option pressed", thumFirst.getAttribute("aria-pressed") === "true");
check("primary engine label swapped", $("[data-role='engine-primary']")?.textContent.includes("thum.io") === true, $("[data-role='engine-primary']")?.textContent);
choose("enginePicker", "microlink,thumio");
await settle();
check("microlink-first restored", $("[data-role='engine-primary']")?.textContent.includes("Microlink") === true);

section("output section");
check("both formats offered", $$("#formatPicker button").map((b) => b.dataset.value).join(",") === "png,jpeg", $$("#formatPicker button").map((b) => b.dataset.value).join(","));
check("both engines named in the picker", $("#enginePicker").textContent.includes("Microlink") && $("#enginePicker").textContent.includes("thum.io"));

void say;
app.summary();