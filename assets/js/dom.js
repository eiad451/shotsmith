/**
 * DOM helpers, toasts and formatting.
 * Everything user-supplied goes through textContent — no innerHTML anywhere in
 * this project, so a hostile target page can never inject markup into the UI.
 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of [children].flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Material Symbols glyph as a span; keeps icons out of markup repetition. */
export function icon(name, { size, filled = false, label } = {}) {
  const span = el("span", { class: "material-symbols-rounded", "aria-hidden": label ? null : "true" });
  span.textContent = name;
  if (size) span.style.fontSize = `${size}px`;
  if (filled) span.style.fontVariationSettings = '"FILL" 1';
  if (label) span.setAttribute("aria-label", label);
  return span;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

const TOAST_ICONS = { ok: "check_circle", error: "error", info: "info" };

export function toast(message, { tone = "info", timeout = 4200 } = {}) {
  const host = $("#toasts");
  if (!host) return () => {};

  const close = el("button", { class: "toast__close", type: "button", "aria-label": "إغلاق" }, [
    icon("close", { size: 16 }),
  ]);
  const node = el("div", { class: "toast", dataset: { tone }, role: tone === "error" ? "alert" : "status" }, [
    icon(TOAST_ICONS[tone] ?? "info", { size: 19 }),
    el("span", { text: message }),
    close,
  ]);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.dataset.leaving = "true";
    node.addEventListener("animationend", () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };

  close.addEventListener("click", dismiss);
  host.append(node);
  if (timeout) timer = setTimeout(dismiss, timeout);
  return dismiss;
}

/**
 * Counts a noun the way Arabic actually works: 1 is singular, 2 is dual, 3–10
 * take the broken plural, and 11+ returns to the singular. Appending one fixed
 * word to every number reads wrong for most counts in this interface.
 *
 * @param {number} count
 * @param {{ one: string, two: string, few: string, many: string }} forms
 */
export function arabicCount(count, forms) {
  const n = Math.abs(Number(count) || 0);
  if (n === 1) return `${count} ${forms.one}`;
  if (n === 2) return `${count} ${forms.two}`;
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${count} ${forms.few}`;
  return `${count} ${forms.many}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "الآن";
  if (seconds < 3600) return `منذ ${Math.floor(seconds / 60)} دقيقة`;
  if (seconds < 86400) return `منذ ${Math.floor(seconds / 3600)} ساعة`;
  return `منذ ${Math.floor(seconds / 86400)} يوم`;
}

export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or no secure context: fall through to the legacy path.
  }
  // Legacy path. Kept in a try/finally so the scratch node is always removed,
  // and every optional method is feature-tested: an environment without
  // execCommand or without select() must report failure, not throw.
  const scratch = el("textarea", { class: "sr-only", readonly: true });
  scratch.value = text;
  document.body.append(scratch);
  try {
    scratch.focus?.();
    scratch.select?.();
    if (typeof document.execCommand !== "function") return false;
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    scratch.remove();
  }
}

export function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = el("a", { href, download: filename, rel: "noopener" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Safe filename: no path separators, no leading dots, bounded length. */
export function safeFilename(host, stamp, extension) {
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "capture";
  return `${safeHost}-${stamp}.${extension}`;
}

export function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
