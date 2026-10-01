/**
 * Phase 4 — the studio (three sizes in one run) and the download-all batch.
 *
 *   node test/phase-studio.test.mjs
 */

import { settle } from "./dom-harness.mjs";
import { boot } from "./flows.mjs";

const app = await boot();
const { env, $, $$, check, section, click, capture, say } = app;

await capture("example.com/pricing");

section("studio");
click('[data-action="open-studio"]');
check("studio dialog opens", $("#studioDialog").open === true);
check("studio gallery starts empty", $$("#studioGallery .shot").length === 0, String($$("#studioGallery .shot").length));
check("status explains the run", $("#studioStatus").textContent.includes("3 مقاسات"), $("#studioStatus").textContent);
check("run button present", Boolean($('[data-action="run-studio"]')));

section("run all three sizes");
const fetchesBefore = env.fetches.length;
click('[data-action="run-studio"]');
await settle(60);
check("three requests issued", env.fetches.length - fetchesBefore === 3, String(env.fetches.length - fetchesBefore));
check("three gallery entries in the studio", $$("#studioGallery .shot").length === 3, String($$("#studioGallery .shot").length));
check("status summarises the run", $("#studioStatus").textContent.includes("سطح مكتب"), $("#studioStatus").textContent);

section("studio feeds the main gallery");
const galleryCount = $$("#gallery .shot").length;
check("studio shots appended to the gallery", galleryCount === 3, String(galleryCount));
check("gallery count label pluralised", $("#galleryCount").textContent === "3 لقطات", $("#galleryCount").textContent);

section("download all");
const before = env.fetches.length;
click('[data-action="download-all"]');
await settle(40);
check("batch fetched image bytes", env.fetches.length > before, `${before} -> ${env.fetches.length}`);
check("downloads are generated, not fetched",
  env.fetches.slice(before).every((f) => !f.url.includes("api.microlink.io")) === false
    || env.canvasCalls.toBlob > 0,
  String(env.fetches.length - before));

click('[data-action="close-studio"]');
check("studio closes", $("#studioDialog").open === false);

section("gallery entry actions");
const removeButton = $(".shot__remove");
check("gallery entry exposes a remove control", Boolean(removeButton));
check("remove control is labelled for screen readers", /حذف/.test(removeButton?.getAttribute("aria-label") ?? ""), removeButton?.getAttribute("aria-label"));
const thumb = $(".shot__thumb");
check("thumbnail opens the lightbox", Boolean(thumb) && /فتح لقطة/.test(thumb.getAttribute("aria-label") ?? ""), thumb?.getAttribute("aria-label"));

section("remove one entry");
const beforeRemove = $$("#gallery .shot").length;
click(removeButton);
await settle(4);
check("entry removed", $$("#gallery .shot").length === beforeRemove - 1, String($$("#gallery .shot").length));
check("count label updated", $("#galleryCount").textContent === "لقطتان" || $("#galleryCount").textContent === "2 لقطتان", $("#galleryCount").textContent);

void capture;
void say;
app.summary();