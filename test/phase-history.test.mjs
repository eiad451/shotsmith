/**
 * Phase 5 — theme cycling, command palette, shortcuts, help, and gallery reset.
 *
 *   node test/phase-history.test.mjs
 */

import { boot } from "./flows.mjs";

const app = await boot();
const { $, $$, check, section, click, type, capture, wait, say } = app;

/* --------------------------------------------------------------- theme */

section("theme");
check("starts on auto (no explicit attribute)", app.document.documentElement.hasAttribute("data-theme") === false);
check("auto resolves to light when the system is light", $("#themeColor").getAttribute("content") === "#f1f1f2", $("#themeColor").getAttribute("content"));

click("#themeToggle");
check("first click forces light", app.document.documentElement.getAttribute("data-theme") === "light", app.document.documentElement.getAttribute("data-theme"));
check("theme-color meta follows light", $("#themeColor").getAttribute("content") === "#f1f1f2", $("#themeColor").getAttribute("content"));
check("choice persisted", JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).theme === "light", localStorage.getItem("shotsmith.prefs.v1"));
check("toggle button is labelled", /سمة|داكن|فاتح/.test($("#themeToggle").getAttribute("aria-label") ?? ""), $("#themeToggle").getAttribute("aria-label"));

click("#themeToggle");
check("second click forces dark", app.document.documentElement.getAttribute("data-theme") === "dark");
check("theme-color meta follows dark", $("#themeColor").getAttribute("content") === "#131314", $("#themeColor").getAttribute("content"));

click("#themeToggle");
check("third click returns to auto", app.document.documentElement.hasAttribute("data-theme") === false);
check("auto persisted", JSON.parse(localStorage.getItem("shotsmith.prefs.v1")).theme === "auto");

section("auto follows the system preference");
app.env.setPrefersDark(true);
app.window.dispatchEvent(new app.window.Event("change"));
await wait(10);
check("system dark reflected in the meta", $("#themeColor").getAttribute("content") === "#131314", $("#themeColor").getAttribute("content"));
check("auto still leaves the attribute unset", app.document.documentElement.hasAttribute("data-theme") === false);
app.env.setPrefersDark(false);
await wait(10);
check("system light reflected", $("#themeColor").getAttribute("content") === "#f1f1f2", $("#themeColor").getAttribute("content"));

/* ------------------------------------------------------- command palette */

section("command palette");
click('[data-action="open-palette"]');
check("palette opens", $("#paletteDialog").open === true);
const paletteInput = $("#paletteDialog .palette__input input");
check("palette input empty on open", paletteInput.value === "", paletteInput.value);
check("palette lists commands", $$("#paletteDialog .palette__item").length > 5, String($$("#paletteDialog .palette__item").length));

type(paletteInput, "مقارنة");
await wait(10);
check("filters by arabic label", $$("#paletteDialog .palette__item").length === 1, String($$("#paletteDialog .palette__item").length));
type(paletteInput, "zzzzz");
await wait(10);
check("no-match state shown", $$("#paletteDialog .palette__item").length === 0, String($$("#paletteDialog .palette__item").length));

click('[data-action="open-palette"]');
check("reopening resets the filter", $("#paletteDialog .palette__input input").value === "");
check("full list back", $$("#paletteDialog .palette__item").length > 5);

section("palette runs a command");
const compareItem = $$("#paletteDialog .palette__item").find((item) => item.textContent.includes("مقارنة"));
check("compare command is listed", Boolean(compareItem));
click(compareItem);
check("palette closes after running", $("#paletteDialog").open === false);
check("the compare command ran", $("#compareDialog").open === true, $("#compareDialog").open ? "compare open" : "compare closed");
click('[data-action="close-compare"]');

/* ------------------------------------------------------------- shortcuts */

section("keyboard shortcuts");
app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
await wait(10);
check("ctrl+k opens the palette", $("#paletteDialog").open === true);
app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(10);
check("escape closes the palette", $("#paletteDialog").open === false);

app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true }));
await wait(10);
check("? opens help", $("#helpDialog").open === true);
click('[data-action="close-help"]');
check("help closes", $("#helpDialog").open === false);

section("shortcuts never eat what the user typed");
type(app.urlInput, "example.com");
app.urlInput.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
await wait(10);
check("the typed target is intact", app.urlInput.value === "example.com", app.urlInput.value);
check("no stray character inserted", !app.urlInput.value.includes("k"), app.urlInput.value);
// Ctrl+K is a global command in most editors, so the palette may open; what must
// not happen is losing the field contents.
if ($("#paletteDialog").open) app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(10);
check("palette dismissed again", $("#paletteDialog").open === false);

/* --------------------------------------------------------------- gallery */

section("gallery management");
await capture("example.com/pricing");
await capture("example.com/about");
check("two entries", $$("#gallery .shot").length === 2, String($$("#gallery .shot").length));
check("count label uses the arabic dual", $("#galleryCount").textContent === "2 لقطتان", $("#galleryCount").textContent);

section("clear asks first");
click('[data-action="clear-gallery"]');
const { dialog, confirm } = app.openConfirmDialog();
check("confirmation dialog shown", dialog.open === true);
check("confirmation names the count", dialog.textContent.includes("2"), dialog.textContent.slice(0, 80));
const cancelButton = [...dialog.querySelectorAll("button")].find((b) => /إلغاء|رجوع/.test(b.textContent));
click(cancelButton);
await wait(10);
check("cancelling keeps the entries", $$("#gallery .shot").length === 2, String($$("#gallery .shot").length));

click('[data-action="clear-gallery"]');
const second = app.openConfirmDialog();
click(second.confirm);
await wait(10);
check("confirming empties the library", $$("#gallery .shot").length === 0, String($$("#gallery .shot").length));
check("count label cleared", $("#galleryCount").textContent === "", `"${$("#galleryCount").textContent}"`);
check("empty hint back", $("#galleryEmpty").hidden === false);
check("confirm dialog removed from the dom", !second.dialog.isConnected);

section("clearing an empty library is a no-op");
click('[data-action="clear-gallery"]');
await wait(10);
const stillOpen = $$("dialog").filter((d) => d.open);
check("no dialog raised", stillOpen.length === 0, stillOpen.map((d) => d.id || d.getAttribute("aria-label")).join(","));

section("capture works after a clear");
await capture("example.com/pricing");
check("gallery repopulates", $$("#gallery .shot").length === 1, String($$("#gallery .shot").length));

void say;
app.summary();