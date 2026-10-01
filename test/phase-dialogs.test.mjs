/**
 * Phase 3 — every dialog: annotate/export, QR, embed snippets, viewer, compare.
 *
 *   node test/phase-dialogs.test.mjs
 */

import { settle } from "./dom-harness.mjs";
import { boot } from "./flows.mjs";

const app = await boot();
const { env, $, $$, check, section, type, click, choose, capture, say } = app;

await capture("example.com/pricing");

/* ------------------------------------------------------ annotate / export */

section("watermark dialog");
click('[data-action="open-annotate"]');
check("dialog opens", $("#annotateDialog").open === true);
check("label starts empty so the brand fallback applies", $("#wmLabel").value === "", `"${$("#wmLabel").value}"`);
check("four corner options", $$("#wmCorner button").length === 4);
check("four style options", $$("#wmStyle button").length === 4);

type($("#wmLabel"), "ShotSmith");
$("#wmPadding").value = "24";
$("#wmPadding").dispatchEvent(new app.window.Event("input", { bubbles: true }));
await settle();
check("padding readout follows", $("#wmPaddingValue").textContent === "24px", $("#wmPaddingValue").textContent);
check("style starts off", JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).annotation.mode === "none", localStorage.getItem("shotsmith.prefs.v1"));

const shadow = $$("#wmStyle button").find((b) => b.dataset.value === "shadow");
click(shadow);
check("pressed state moved to the chosen style", shadow.getAttribute("aria-pressed") === "true", $$("#wmStyle button").map((b) => b.getAttribute("aria-pressed")).join(","));
check("annotation persisted", JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).annotation.mode === "shadow");

section("annotated export");
const blobsBefore = env.canvasCalls.toBlob;
click('[data-action="apply-annotate"]');
await settle(10);
check("canvas was exported", env.canvasCalls.toBlob > blobsBefore, `${blobsBefore} -> ${env.canvasCalls.toBlob}`);
check("watermark text drawn", env.canvasCalls.fillText.some((c) => c.text === "ShotSmith"), JSON.stringify(env.canvasCalls.fillText.map((c) => c.text)));
check("url drawn under the label", env.canvasCalls.fillText.some((c) => c.text.includes("example.com")), JSON.stringify(env.canvasCalls.fillText.map((c) => c.text)));
check("image drawn onto the padded canvas", env.canvasCalls.drawImage >= 2, String(env.canvasCalls.drawImage));
check("dialog closed after applying", $("#annotateDialog").open === false);

section("reopening the dialog keeps the last settings");
click('[data-action="open-annotate"]');
check("label restored", $("#wmLabel").value === "ShotSmith", $("#wmLabel").value);
check("padding restored", $("#wmPadding").value === "24", $("#wmPadding").value);
check("corner options present on reopen", $$("#wmCorner button").length === 4);
click('[data-action="close-annotate"]');
check("closes without exporting", $("#annotateDialog").open === false && env.canvasCalls.toBlob === blobsBefore + 1, String(env.canvasCalls.toBlob));

/* ------------------------------------------------------------------- QR */

section("QR dialog");
click('[data-action="open-qr"]');
check("qr dialog opens", $("#qrDialog").open === true);
check("canvas sized", $("#qrCanvas").width > 100, String($("#qrCanvas").width));
check("square canvas", $("#qrCanvas").width === $("#qrCanvas").height, `${$("#qrCanvas").width}x${$("#qrCanvas").height}`);
check("note describes the matrix", /الإصدار/.test($("#qrNote").textContent), $("#qrNote").textContent);
check("matrix size reported in the note", /\d+×\d+/.test($("#qrNote").textContent), $("#qrNote").textContent);

const qrBlobs = env.canvasCalls.toBlob;
click('[data-action="download-qr"]');
await settle(8);
check("qr png generated", env.canvasCalls.toBlob > qrBlobs, String(env.canvasCalls.toBlob));
check("qr still open after download", $("#qrDialog").open === true);
click('[data-action="close-qr"]');
check("qr dialog closes", $("#qrDialog").open === false);

/* ----------------------------------------------------------------- embed */

section("embed dialog");
click('[data-action="open-embed"]');
check("embed dialog opens", $("#embedDialog").open === true);
const urlSnippet = $("#embedCode").textContent;
check("url snippet uses the cors passthrough", urlSnippet.includes("embed=screenshot.url"), urlSnippet.slice(0, 90));
check("url snippet points at microlink", urlSnippet.includes("api.microlink.io"), urlSnippet.slice(0, 60));
check("four snippet tabs", $$("#embedTabs button").length === 4, String($$("#embedTabs button").length));
check("first tab selected", $$("#embedTabs button")[0].getAttribute("aria-selected") === "true");
check("tabs have role=tab", $$("#embedTabs button").every((b) => b.getAttribute("role") === "tab"));

const htmlTab = $$("#embedTabs button").find((b) => b.dataset.tab === "html");
click(htmlTab);
check("html snippet selected", $("#embedCode").textContent.startsWith("<img"), $("#embedCode").textContent.slice(0, 40));
check("html snippet uses alt", $("#embedCode").textContent.includes('alt="'), $("#embedCode").textContent.slice(0, 80));
check("aria-selected moved to the clicked tab", htmlTab.getAttribute("aria-selected") === "true");
check("previously selected tab deselected", $$("#embedTabs button")[0].getAttribute("aria-selected") === "false");
check("tab row not rebuilt (same node kept)", $$("#embedTabs button").includes(htmlTab));

const mdTab = $$("#embedTabs button").find((b) => b.dataset.tab === "img");
click(mdTab);
check("markdown snippet selected", $("#embedCode").textContent.startsWith("!["), $("#embedCode").textContent.slice(0, 40));

const curlTab = $$("#embedTabs button").find((b) => b.dataset.tab === "curl");
click(curlTab);
check("curl snippet selected", $("#embedCode").textContent.startsWith("curl "), $("#embedCode").textContent.slice(0, 40));

click('[data-action="copy-embed"]');
await settle();
check("snippet still intact after copy", $("#embedCode").textContent.startsWith("curl "), $("#embedCode").textContent.slice(0, 20));
click('[data-action="close-embed"]');

/* ---------------------------------------------------------------- viewer */

section("lightbox viewer");
click('[data-action="open-viewer"]');
check("viewer opens", $("#viewerDialog").open === true);
check("caption filled", $("[data-role='viewer-caption']").textContent === "example.com", $("[data-role='viewer-caption']").textContent);
check("size filled", $("[data-role='viewer-size']").textContent === "1280×720px", $("[data-role='viewer-size']").textContent);
check("image shown", $("[data-role='viewer-image']")?.src.includes("api.microlink.io") === true);

const zoomIn = click('[data-action="zoom-in"]');
await settle();
void zoomIn;
const zoomOut = $("[data-action='zoom-out']");
check("zoom controls exist", Boolean(zoomOut));
click('[data-action="zoom-fit"]');
await settle();
click('[data-action="close-viewer"]');
check("viewer closes", $("#viewerDialog").open === false);

section("escape closes the viewer");
click('[data-action="open-viewer"]');
$("#viewerDialog").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await settle();
check("viewer closed on escape", $("#viewerDialog").open === false);

/* --------------------------------------------------------------- compare */

section("compare dialog");
click('[data-action="open-compare"]');
check("compare opens", $("#compareDialog").open === true);
check("placeholder shown while there is one shot", $("#compareStage").dataset.empty === "true", $("#compareStage").dataset.empty);
check("no counterpart offered", $$("#comparePick option").length === 1, String($$("#comparePick option").length));
click('[data-action="close-compare"]');

await capture("example.com/compare-side");
click('[data-action="open-compare"]');
check("counterpart offered after a second shot", $$("#comparePick option").length === 2, String($$("#comparePick option").length));
check("a counterpart is pre-selected", $("#comparePick").value !== "", `"${$("#comparePick").value}"`);
check("stage shows the comparison immediately", $("#compareStage").dataset.empty === "false", $("#compareStage").dataset.empty);
check("both panes rendered", $$("#compareStage img").length === 2, String($$("#compareStage img").length));
check("seam handle rendered", Boolean($("#compareStage .compare__handle")));
check("seam starts at the middle", $("#compareStage .compare__top").style.width === "50%", $("#compareStage .compare__top").style.width);

const pick = $("#comparePick");
pick.value = "";
pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
await settle(6);
check("clearing the pick returns to the empty state", $("#compareStage").dataset.empty === "true", $("#compareStage").dataset.empty);
pick.value = $$("#comparePick option")[1].value;
pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
await settle(6);
check("reselecting rebuilds the comparison", $$("#compareStage img").length === 2, String($$("#compareStage img").length));
click('[data-action="close-compare"]');
check("compare closes", $("#compareDialog").open === false);

void choose;
void say;
app.summary();