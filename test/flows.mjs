/**
 * Shared setup for the behavioral phases.
 *
 * Each phase of the smoke suite runs in its own process. A single long-lived
 * process accumulates enough linkedom DOM plus captured blobs to push this
 * sandbox's Node into a SIGSEGV, and the crash point moves around run to run.
 * One process per phase keeps the peak heap small and the failures readable.
 */

import { createEnvironment, settle } from "./dom-harness.mjs";

/**
 * Boots the real app.js inside a shimmed DOM and returns the handles a phase
 * needs. Does not capture yet — call capture() when the phase wants a shot.
 */
export async function boot() {
  const env = createEnvironment();
  const { window, document } = env;

  let failures = 0;
  let checks = 0;

  function say(...args) {
    process.stderr.write(args.join(" ") + "\n");
  }

  function check(label, condition, detail = "") {
    checks += 1;
    if (condition) {
      say(`  ok   ${label}`);
      return true;
    }
    failures += 1;
    say(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    return false;
  }

  function section(title) {
    say(`\n${title}`);
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function click(selector) {
    const node = typeof selector === "string" ? $(selector) : selector;
    if (!node) throw new Error(`no element for ${selector}`);
    node.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    return node;
  }

  function type(input, value) {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const urlInput = $("#targetUrl");
  await import("../assets/js/app.js");
  if (document.readyState === "loading") {
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
  }
  await settle();

  /** Runs one capture and waits for the flow to settle. */
  async function capture(value = "example.com/pricing", rounds = 14) {
    type(urlInput, value);
    $("#captureForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await settle(rounds);
    return $("#captureImage").src;
  }

  /** Chooses a segmented-control button by its data-value. */
  function choose(pickerId, value) {
    const button = $$(`#${pickerId} button`).find((b) => b.dataset.value === value);
    if (!button) throw new Error(`no ${pickerId} option ${value}`);
    click(button);
    return button;
  }

  /** Finds the confirmation dialog raised by a destructive action. */
  function openConfirmDialog() {
    const dialog = $$("dialog").at(-1);
    return {
      dialog,
      confirm: [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("امسح")),
    };
  }

  function summary() {
    say(`\n${checks - failures}/${checks} checks passed`);
    if (failures) process.exitCode = 1;
    env.teardown();
  }

  return {
    env,
    window,
    document,
    $,
    $$,
    click,
    type,
    wait,
    check,
    section,
    say,
    capture,
    choose,
    openConfirmDialog,
    urlInput,
    summary,
    get failures() {
      return failures;
    },
  };
}