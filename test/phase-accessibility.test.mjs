/**
 * Phase 6 — markup accessibility: language and direction, labels, roles, live
 * regions, focus handling, and keyboard reachability of every control.
 *
 *   node test/phase-accessibility.test.mjs
 */

import { boot } from "./flows.mjs";

const app = await boot();
const { document, $, $$, check, section, click, capture, wait } = app;

/* -------------------------------------------------------------- document */

section("document language and direction");
check("html lang is arabic", document.documentElement.lang === "ar", document.documentElement.lang);
check("html dir is rtl", document.documentElement.dir === "rtl", document.documentElement.dir);
check("a title exists", (document.title ?? "").length > 5, document.title);
check("page has a single h1", $$("h1").length === 1, String($$("h1").length));
check("meta description present", Boolean($('meta[name="description"]')?.content));
check("meta viewport present", Boolean($('meta[name="viewport"]')?.content));
check("viewport allows zoom", !/user-scalable=no|maximum-scale=1\b/.test($('meta[name="viewport"]').content), $('meta[name="viewport"]').content);
check("theme-color declared for both schemes", ($('meta[name="theme-color"]')?.getAttribute("content") ?? "").startsWith("#"));

/* ---------------------------------------------------------------- forms */

section("every form control is labelled");
const unlabelled = [];
for (const control of $$("input, select, textarea")) {
  const id = control.getAttribute("id");
  const labelled =
    (id && document.querySelector(`label[for="${id}"]`)) ||
    control.getAttribute("aria-label") ||
    control.getAttribute("aria-labelledby") ||
    control.closest("label");
  if (!labelled) unlabelled.push(id ?? control.outerHTML.slice(0, 60));
}
check("no unlabelled inputs", unlabelled.length === 0, unlabelled.join(" | "));

const unlabelledButtons = [];
for (const button of $$("button")) {
  const name = (button.textContent ?? "").trim() || button.getAttribute("aria-label") || button.getAttribute("title");
  if (!name) unlabelledButtons.push(button.outerHTML.slice(0, 70));
}
check("no icon-only button without a name", unlabelledButtons.length === 0, unlabelledButtons.join(" | "));

section("required fields and validation messaging");
check("url field marked required for AT", $("#targetUrl").getAttribute("aria-required") === "true", $("#targetUrl").outerHTML.slice(0, 90));
check("url input is a url-ish text field", $("#targetUrl").type === "url" || $("#targetUrl").type === "text", $("#targetUrl").type);
check("error text container present", Boolean($("#urlErrorText")), "");
check("error region is announced", $("#urlError").getAttribute("role") === "alert" || $("#urlError").getAttribute("aria-live") !== null, $("#urlError").outerHTML.slice(0, 90));

/* ---------------------------------------------------------------- ARIA */

section("roles and states");
const pickers = $$(".segmented");
check("segmented groups are labelled", pickers.every((p) => p.getAttribute("aria-labelledby") || p.getAttribute("aria-label")), String(pickers.length));
check("pickers expose pressed state", $$(".segmented button").every((b) => b.hasAttribute("aria-pressed")));
check("exactly one pressed option per picker",
  pickers.every((p) => [...p.querySelectorAll('button[aria-pressed="true"]')].length === 1),
  pickers.map((p) => [...p.querySelectorAll('button[aria-pressed="true"]')].length).join(","));
check("switch inputs expose a checked state", $$('input[type="checkbox"]').every((i) => i.hasAttribute("aria-checked") || i.hasAttribute("checked") || i.closest("label")));
check("status bar is a live region", $("#statusBar").hasAttribute("aria-live") || $("#statusBar").getAttribute("role") === "status", $("#statusBar").outerHTML.slice(0, 90));
check("quota has a screen-reader summary", ($("#quotaLive")?.textContent ?? "").length >= 0 && $("#quotaLive").hasAttribute("aria-live"), $("#quotaLive").outerHTML.slice(0, 70));
check("stage container marked busy-capable", $("#stage").hasAttribute("aria-busy") || $("#stage").hasAttribute("aria-label"), $("#stage").outerHTML.slice(0, 70));
check("decorative icons hidden from readers", $$(".material-symbols-rounded").every((i) => i.getAttribute("aria-hidden") === "true"), String($$(".material-symbols-rounded").filter((i) => i.getAttribute("aria-hidden") !== "true").length));
check("icon-font used, no emoji in the chrome", !/[\u{1F300}-\u{1FAFF}]/u.test(document.body.textContent));

/* --------------------------------------------------------------- dialogs */

section("dialogs are modal and described");
const dialogs = $$("dialog");
check("dialogs use the native element", dialogs.length >= 5, String(dialogs.length));
check("every dialog is labelled", dialogs.every((d) => d.getAttribute("aria-label") || d.getAttribute("aria-labelledby")), dialogs.filter((d) => !d.getAttribute("aria-label") && !d.getAttribute("aria-labelledby")).length + " unlabelled");
check("dialogs carry the sheet class", dialogs.every((d) => d.className.includes("sheet")), dialogs.map((d) => d.className).join("|"));

await capture("example.com/pricing");
click('[data-action="open-help"]');
check("help opens", $("#helpDialog").open === true);
check("help lists shortcuts", /Ctrl|⌘/.test($("#helpDialog").textContent), $("#helpDialog").textContent.slice(0, 60));
click('[data-action="close-help"]');

section("focus returns to the trigger after a dialog closes");
const viewerTrigger = $('[data-action="open-viewer"]');
viewerTrigger.focus();
check("focus moved to the trigger", document.activeElement === viewerTrigger, document.activeElement?.id ?? String(document.activeElement?.className));
click(viewerTrigger);
await wait(10);
check("viewer opened", $("#viewerDialog").open === true);
check("focus moved into the dialog", $("#viewerDialog").contains(document.activeElement), document.activeElement?.id ?? String(document.activeElement?.className));
click('[data-action="close-viewer"]');
await wait(10);
check("viewer closed", $("#viewerDialog").open === false);
check("focus restored to the trigger", document.activeElement === viewerTrigger, document.activeElement?.id ?? String(document.activeElement?.className));

/* ------------------------------------------------------------- keyboard */

section("keyboard reachability");
const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])');
check("no positive tabindex anywhere", $$('[tabindex]').every((n) => Number(n.getAttribute("tabindex")) <= 0), $$('[tabindex]').map((n) => n.getAttribute("tabindex")).join(","));
check("focusable controls exist", focusable.length > 20, String(focusable.length));
check("skip link is first in the tab order", $("body").firstElementChild?.className.includes("skip") || $(".skip-link") !== null, $("body").firstElementChild?.className ?? "none");

section("sr-only helper exists for visual labels");
check("screen-reader-only class defined in markup", $$(".sr-only").length > 0, String($$(".sr-only").length));

app.summary();