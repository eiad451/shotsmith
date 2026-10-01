/**
 * Application wiring.
 *
 * Single source of truth for capture state lives in `state`; every panel reads
 * from it and re-renders through the same `render*` functions, so a change made
 * from a keyboard shortcut, the command palette, a shared link or a restored
 * preference can never leave two panels disagreeing.
 */

import {
  arabicCount,
  $,
  $$,
  clear,
  copyText,
  debounce,
  downloadBlob,
  el,
  formatBytes,
  formatRelativeTime,
  icon,
  stamp,
  toast,
} from "./dom.js";
import { CaptureEngine, CaptureError } from "./capture-engine.js";
import {
  DEFAULT_OPTIONS,
  DEVICES,
  FORMATS,
  buildMicrolinkUrl,
  describeOptions,
  findDevice,
  findFormat,
} from "./device-presets.js";
import { TargetError, hostLabel, normalizeTarget } from "./target-guard.js";
import {
  ANNOTATION_DEFAULTS,
  copyCaptureToClipboard,
  exportCapture,
  thumbnailDataUrl,
} from "./exporter.js";
import { gallery, prefs } from "./session-store.js";
import { Lightbox, mountCompare, wireZoomControls } from "./viewer.js";
import { QrError, drawToCanvas, encode as encodeQr } from "./qr-encoder.js";
import { readHash, shareUrl, writeHash } from "./share-link.js";
import { CommandPalette, bindShortcuts } from "./command-bar.js";

/** Wait presets in ms; anything else is reachable through the advanced field. */
const WAIT_PRESETS = [
  { id: "0", label: "فوري" },
  { id: "1500", label: "1.5 ث" },
  { id: "4000", label: "4 ث" },
];

const CORNERS = [
  { id: "bottom-start", label: "أسفل" },
  { id: "bottom-end", label: "أسفل معكوس" },
  { id: "top-start", label: "أعلى" },
  { id: "top-end", label: "أعلى معكوس" },
];

/**
 * Watermark presets. Each maps onto the two real switches in exporter.js:
 * `plate` paints the bar behind the text, `mode` adds the drop shadow or the
 * solid padding panel.
 */
const WM_STYLES = [
  { id: "bar", label: "شريط", mode: "none", plate: "bar" },
  { id: "shadow", label: "ظل", mode: "shadow", plate: "none" },
  { id: "clear", label: "نص فقط", mode: "none", plate: "none" },
  { id: "panel", label: "لوحة", mode: "panel", plate: "bar" },
];

const EMBED_TABS = [
  { id: "url", label: "رابط المحرك" },
  { id: "html", label: "HTML" },
  { id: "img", label: "Markdown" },
  { id: "curl", label: "cURL" },
];

const THEMES = [
  { id: "auto", label: "تلقائي حسب النظام", icon: "contrast" },
  { id: "light", label: "فاتح", icon: "light_mode" },
  { id: "dark", label: "داكن", icon: "dark_mode" },
];

const STUDIO_PLAN = [
  { deviceId: "desktop-hd", label: "سطح مكتب" },
  { deviceId: "ipad-pro", label: "تابلت" },
  { deviceId: "iphone-15-pro", label: "موبايل" },
];

const NODE_IDS = [
  "captureForm", "targetUrl", "inputShell", "urlError", "urlErrorText", "captureButton",
  "devicePicker", "formatPicker", "waitPicker", "enginePicker", "optionsSummary",
  "fullPage", "hideScrollbars", "omitBackground", "quality", "qualityValue", "qualityRow",
  "elementSelector", "extraWait", "statusBar", "statusTitle", "statusDetail", "statusSpinner",
  "statusAside", "stage", "stageEmpty", "deviceFrame", "captureImage", "stageCaption",
  "stageActions", "metaStrip", "pageMeta", "gallery", "galleryCount", "galleryEmpty",
  "quota", "quotaFill", "quotaValue", "quotaLive",
  "compareStage", "comparePick", "annotateDialog", "embedDialog",
  "embedTabs", "embedCode", "embedNote", "qrDialog", "qrCanvas", "qrNote", "qrTag",
  "studioDialog", "studioGallery", "studioStatus",
  "wmLabel", "wmSub", "wmCorner", "wmStyle", "wmPadding", "wmPaddingValue",
  "wmTimestamp", "wmUrl", "themeToggle", "themeToggleIcon",
];

const state = {
  target: "",
  options: { ...DEFAULT_OPTIONS },
  annotation: { ...ANNOTATION_DEFAULTS, wmStyle: "bar", plate: "bar" },
  theme: "auto",
  capture: null,
  engineOrder: ["microlink", "thumio"],
  inFlight: null,
  compareId: null,
  embedTab: "url",
  studioShots: [],
};

const nodes = {};
let lightbox = null;
let palette = null;

const engine = new CaptureEngine({
  onStage: onCaptureStage,
  onQuota: onQuota,
});

/* ------------------------------------------------------------------- boot */

function cacheNodes() {
  for (const id of NODE_IDS) nodes[id] = document.getElementById(id);
  // Dialogs live outside NODE_IDS but are referenced by name from the action
  // table. Any dialog missing here turns open/close into a TypeError.
  for (const id of ["helpDialog", "viewerDialog", "compareDialog", "paletteDialog"]) {
    nodes[id] = document.getElementById(id);
  }
}

function buildSegmented(host, entries, { onPick, getActive }) {
  clear(host);
  for (const entry of entries) {
    host.append(
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(entry.id === getActive()),
          dataset: { value: entry.id },
          onclick: () => onPick(entry.id),
        },
        [entry.icon ? icon(entry.icon, { size: 17 }) : null, el("span", { text: entry.label })],
      ),
    );
  }
  syncSegmented(host, getActive());
}

function syncSegmented(host, activeId) {
  if (!host) return;
  for (const button of host.children) {
    button.setAttribute("aria-pressed", String(button.dataset.value === activeId));
  }
}

function buildStaticControls() {
  buildSegmented(
    nodes.devicePicker,
    DEVICES.map((d) => ({ id: d.id, label: d.short, icon: d.icon })),
    { onPick: (id) => setOption("deviceId", id), getActive: () => state.options.deviceId },
  );
  buildSegmented(
    nodes.formatPicker,
    FORMATS.map((f) => ({ id: f.id, label: f.label })),
    { onPick: (id) => setOption("format", id), getActive: () => state.options.format },
  );
  buildSegmented(
    nodes.waitPicker,
    WAIT_PRESETS,
    {
      onPick: (id) => {
        nodes.extraWait.value = id;
        setOption("waitForTimeout", Number(id));
      },
      getActive: () => String(state.options.waitForTimeout),
    },
  );
  buildSegmented(
    nodes.enginePicker,
    [
      { id: "microlink,thumio", label: "Microlink ثم thum.io" },
      { id: "thumio,microlink", label: "thum.io ثم Microlink" },
    ],
    {
      onPick: (id) => {
        state.engineOrder = id.split(",");
        // Without this the pressed state never moves, so the control would show
        // the old engine order until the next full render.
        syncSegmented(nodes.enginePicker, id);
        renderEngineStatus();
      },
      getActive: () => state.engineOrder.join(","),
    },
  );
  buildSegmented(
    nodes.wmCorner,
    CORNERS,
    { onPick: (id) => setAnnotation("corner", id), getActive: () => state.annotation.corner },
  );
  buildSegmented(
    nodes.wmStyle,
    WM_STYLES,
    { onPick: (id) => setWmStyle(id), getActive: () => state.annotation.wmStyle },
  );
}

function bindForm() {
  nodes.captureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runCapture();
  });

  nodes.targetUrl.addEventListener("input", () => {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(() => {
      if (nodes.targetUrl.value.trim()) validateTarget();
    }, 350);
  });
  nodes.targetUrl.addEventListener("change", () => {
    if (validateTarget()) {
      localStorage.setItem("shotsmith.lastTarget", nodes.targetUrl.value.trim());
    }
  });

  for (const button of $$("[data-quick]")) {
    button.addEventListener("click", () => {
      nodes.targetUrl.value = button.dataset.quick;
      runCapture();
    });
  }

  const toggles = [
    [nodes.fullPage, "fullPage"],
    [nodes.hideScrollbars, "hideScrollbars"],
    [nodes.omitBackground, "omitBackground"],
  ];
  for (const [input, key] of toggles) {
    input.addEventListener("change", () => setOption(key, input.checked));
  }

  nodes.quality.addEventListener("input", () => setOption("quality", Number(nodes.quality.value)));
  nodes.elementSelector.addEventListener(
    "input",
    debounce(() => setOption("element", nodes.elementSelector.value), 400),
  );
  nodes.extraWait.addEventListener("change", () => {
    const value = Math.max(0, Math.min(30000, Number(nodes.extraWait.value) || 0));
    nodes.extraWait.value = String(value);
    setOption("waitForTimeout", value);
  });

  nodes.comparePick.addEventListener("change", () => {
    state.compareId = nodes.comparePick.value || null;
    renderCompare();
  });

  // The button is also covered by the delegated [data-action] handler below.
  // Wiring it here as well would cycle the theme twice per click and make
  // "light" unreachable.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;
    const run = ACTIONS[trigger.dataset.action];
    if (!run) return;
    event.preventDefault();
    run(trigger);
  });

  wireAnnotationInputs();
  wireZoomControls(document, lightbox);
}

function wireAnnotationInputs() {
  nodes.wmLabel.addEventListener("input", () => setAnnotation("label", nodes.wmLabel.value));
  nodes.wmSub.addEventListener("input", () => setAnnotation("sublabel", nodes.wmSub.value));
  nodes.wmPadding.addEventListener("input", () => setAnnotation("padding", Number(nodes.wmPadding.value)));
  nodes.wmTimestamp.addEventListener("change", () =>
    setAnnotation("showTimestamp", nodes.wmTimestamp.checked),
  );
  nodes.wmUrl.addEventListener("change", () => setAnnotation("showUrl", nodes.wmUrl.checked));
}

/* ------------------------------------------------------------- state sync */

function setOption(key, value) {
  state.options = { ...state.options, [key]: value };
  prefs.save({ options: state.options });
  renderOptions();
}

function setAnnotation(key, value) {
  state.annotation = { ...state.annotation, [key]: value };
  prefs.save({ annotation: state.annotation });
  if (key === "padding") renderAnnotationInputs();
}

function setWmStyle(id) {
  const preset = WM_STYLES.find((s) => s.id === id) ?? WM_STYLES[0];
  state.annotation = { ...state.annotation, wmStyle: preset.id, mode: preset.mode, plate: preset.plate };
  prefs.save({ annotation: state.annotation });
  syncSegmented(nodes.wmStyle, preset.id);
}

function renderOptions() {
  const device = findDevice(state.options.deviceId);
  const jpeg = state.options.format === "jpeg";

  nodes.deviceFrame.className = `device device--${deviceClass(device)}`;
  nodes.qualityValue.textContent = String(state.options.quality);
  nodes.quality.disabled = !jpeg;
  nodes.qualityRow.dataset.disabled = String(!jpeg);
  // A transparent background only survives in PNG; JPG flattens onto white.
  nodes.omitBackground.disabled = jpeg;
  nodes.optionsSummary.textContent = describeOptions(state.options).join(" · ");

  syncSegmented(nodes.devicePicker, state.options.deviceId);
  syncSegmented(nodes.formatPicker, state.options.format);
  syncSegmented(nodes.waitPicker, String(state.options.waitForTimeout));
  syncSegmented(nodes.enginePicker, state.engineOrder.join(","));
  renderEngineStatus();
}

function deviceClass(device) {
  if (!device.mobile) return "desktop";
  return device.width < 500 ? "phone" : "tablet";
}

function renderEngineStatus() {
  const label = (id) => (id === "thumio" ? "thum.io" : "Microlink");
  const primary = $("[data-role='engine-primary']");
  const fallback = $("[data-role='engine-fallback']");
  const last = $("[data-role='engine-last']");
  if (primary) primary.textContent = label(state.engineOrder[0]);
  if (fallback) fallback.textContent = label(state.engineOrder[1] ?? "thumio");
  if (last) last.textContent = state.capture?.providerLabel ?? "—";
}

function renderAnnotationInputs() {
  const annotation = state.annotation;
  nodes.wmLabel.value = annotation.label ?? "";
  nodes.wmSub.value = annotation.sublabel ?? "";
  nodes.wmPadding.value = String(annotation.padding ?? 0);
  nodes.wmPaddingValue.textContent = `${annotation.padding ?? 0}px`;
  nodes.wmTimestamp.checked = annotation.showTimestamp !== false;
  nodes.wmUrl.checked = annotation.showUrl !== false;
  syncSegmented(nodes.wmCorner, annotation.corner);
  syncSegmented(nodes.wmStyle, annotation.wmStyle ?? "bar");
}

function resetAnnotation() {
  state.annotation = { ...ANNOTATION_DEFAULTS, wmStyle: "bar", mode: "none", plate: "bar" };
  prefs.save({ annotation: state.annotation });
  renderAnnotationInputs();
  toast("رجّعنا العلامة المائية للإعدادات الأصلية.");
}

/* ------------------------------------------------------------------ theme */

function cycleTheme() {
  const index = THEMES.findIndex((t) => t.id === state.theme);
  setTheme(THEMES[(index + 1) % THEMES.length].id);
}

function setTheme(theme) {
  state.theme = theme;
  prefs.save({ theme });

  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  const dark =
    theme === "dark" ||
    (theme === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const meta = $("#themeColor");
  if (meta) meta.setAttribute("content", dark ? "#131314" : "#f1f1f2");

  const entry = THEMES.find((t) => t.id === theme);
  nodes.themeToggleIcon.textContent = entry.icon;
  nodes.themeToggle.title = entry.label;
  nodes.themeToggle.setAttribute("aria-label", `المظهر: ${entry.label}`);
}

function renderThemeToggle() {
  const entry = THEMES.find((t) => t.id === state.theme);
  nodes.themeToggleIcon.textContent = entry.icon;
  nodes.themeToggle.title = entry.label;
  nodes.themeToggle.setAttribute("aria-label", `المظهر: ${entry.label}`);
}

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (state.theme === "auto") setTheme("auto");
});

/* -------------------------------------------------------------- validation */

function validateTarget() {
  try {
    const result = normalizeTarget(nodes.targetUrl.value);
    nodes.inputShell.classList.remove("input-shell--invalid");
    nodes.urlError.hidden = true;
    return result;
  } catch (error) {
    if (!(error instanceof TargetError)) throw error;
    nodes.inputShell.classList.add("input-shell--invalid");
    nodes.urlErrorText.textContent = error.message;
    nodes.urlError.hidden = false;
    return null;
  }
}

let validateTimer;

/* ----------------------------------------------------------------- capture */

const ACTIONS = {
  download: handleDownload,
  copy: handleCopy,
  "open-viewer": openViewer,
  "open-annotate": () => nodes.annotateDialog.showModal(),
  "open-compare": openCompare,
  "open-qr": openQr,
  "open-embed": openEmbed,
  share: handleShare,
  "open-studio": () => nodes.studioDialog.showModal(),
  "run-studio": runStudio,
  "download-all": downloadStudioAll,
  "close-viewer": () => lightbox.close(),
  "close-compare": () => nodes.compareDialog.close(),
  "close-annotate": () => nodes.annotateDialog.close(),
  "close-embed": () => nodes.embedDialog.close(),
  "close-qr": () => nodes.qrDialog.close(),
  "close-studio": () => nodes.studioDialog.close(),
  "close-help": () => nodes.helpDialog.close(),
  "open-help": () => nodes.helpDialog.showModal(),
  "open-palette": () => palette.open(),
  "toggle-theme": cycleTheme,
  "apply-annotate": () => applyAnnotation({ download: true }),
  "copy-annotated": () => applyAnnotation({ copy: true }),
  "reset-annotate": resetAnnotation,
  "copy-embed": copyEmbed,
  "open-embed-live": openEmbedLive,
  "download-qr": downloadQr,
  "clear-gallery": confirmClearGallery,
  cancel: cancelCapture,
};

async function runCapture() {
  state.inFlight?.abort();

  const target = validateTarget();
  if (!target) {
    // Without this the status bar keeps advertising the previous capture's
    // success while the new request never happened.
    showStatus("ما فيش التقاط", nodes.urlErrorText.textContent, { tone: "error" });
    toast(nodes.urlErrorText.textContent, { tone: "error", timeout: 5000 });
    nodes.targetUrl.focus();
    return null;
  }

  state.target = target.url;
  const controller = new AbortController();
  state.inFlight = controller;
  nodes.captureButton.disabled = true;
  nodes.stage.setAttribute("aria-busy", "true");
  showStatus("جاري الالتقاط…", `${target.host} · ${findDevice(state.options.deviceId).label}`, {
    busy: true,
  });

  try {
    const result = await engine.capture({
      target: target.url,
      options: state.options,
      signal: controller.signal,
      engineOrder: state.engineOrder,
    });

    state.capture = result;
    renderCapture();
    renderEngineStatus();
    renderPageMeta();
    saveToGallery(result);
    if (result.notes.length) toast(result.notes[0], { tone: "info", timeout: 6000 });
    showStatus(
      "تم الالتقاط بنجاح",
      `${result.providerLabel} · ${result.width}×${result.height}px`,
      { tone: "ok" },
    );
    writeHash({ url: target.url, options: state.options, annotation: state.annotation });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") return null;
    const message = error instanceof CaptureError ? error.message : "حصل خطأ غير متوقع.";
    showStatus("فشل الالتقاط", message, { tone: "error" });
    toast(message, { tone: "error", timeout: 7000 });
    return null;
  } finally {
    state.inFlight = null;
    nodes.captureButton.disabled = false;
  }
}

function cancelCapture() {
  if (!state.inFlight) return;
  state.inFlight.abort();
  showStatus(null);
  toast("ألغينا الالتقاط.");
}

function onCaptureStage({ phase, provider, attempt }) {
  if (phase !== "capture") return;
  showStatus(
    attempt > 1 ? `محاولة ${attempt} عبر ${provider}…` : `جاري الالتقاط عبر ${provider}…`,
    "ممكن ياخد ثواني حسب حجم الصفحة",
    { busy: true },
  );
}

function onQuota(quota) {
  if (!quota) return;
  const known =
    Number.isFinite(quota.remaining) && Number.isFinite(quota.limit) && quota.limit > 0;
  const ratio = known ? Math.max(0, Math.min(1, quota.remaining / quota.limit)) : null;

  nodes.quotaFill.style.width = ratio == null ? "100%" : `${ratio * 100}%`;
  nodes.quotaValue.textContent = known ? `${quota.remaining}/${quota.limit}` : "—";
  nodes.quota.dataset.level =
    ratio == null ? "ok" : ratio <= 0.05 ? "out" : ratio <= 0.25 ? "warn" : "ok";
  nodes.quotaLive.textContent = known
    ? `الحصة المتبقية التقريبية ${quota.remaining} من ${quota.limit}`
    : "الحصة غير معروفة";
}

function showStatus(title, detail = "", { busy = false, tone = "info" } = {}) {
  if (!title) {
    nodes.statusBar.hidden = true;
    clear(nodes.statusAside);
    return;
  }
  nodes.statusBar.hidden = false;
  nodes.statusBar.dataset.tone = tone;
  nodes.statusSpinner.style.display = busy ? "" : "none";
  nodes.statusTitle.textContent = title;
  nodes.statusDetail.textContent = detail;

  clear(nodes.statusAside);
  if (busy) {
    nodes.statusAside.append(
      el("button", { class: "btn", type: "button", dataset: { action: "cancel" } }, [
        icon("close", { size: 16 }),
        "إلغاء",
      ]),
    );
  }
}

function renderCapture() {
  const capture = state.capture;
  if (!capture) return;

  nodes.stageEmpty.hidden = true;
  nodes.deviceFrame.hidden = false;
  nodes.stageActions.hidden = false;
  nodes.captureImage.src = capture.imageUrl;
  nodes.captureImage.alt = `لقطة ${hostLabel(capture.meta?.resolvedUrl ?? state.target)}`;
  nodes.deviceFrame.className = `device device--${deviceClass(capture.device)}`;
  // The stage itself is the labelled image for assistive tech, so its name has
  // to describe the shot rather than repeat "not captured yet".
  nodes.stage.setAttribute(
    "aria-label",
    `لقطة ${hostLabel(capture.meta?.resolvedUrl ?? state.target)} · ${capture.width}×${capture.height}`,
  );
  nodes.stage.setAttribute("aria-busy", "false");

  const format = findFormat(state.options.format);
  nodes.stageCaption.textContent = [
    capture.device.label,
    `${capture.width}×${capture.height}px`,
    format.id === "jpeg" ? `JPG q${state.options.quality}` : "PNG",
    capture.providerLabel,
  ].join(" · ");

  clear(nodes.metaStrip);
  const facts = [
    { icon: "straighten", text: `${capture.width}×${capture.height}px` },
    { icon: "photo_size_select_large", text: format.label },
    { icon: "memory", text: `~${formatBytes(capture.bytes)}` },
    { icon: "dns", text: capture.providerLabel },
  ];
  if (capture.meta?.title) facts.push({ icon: "title", text: capture.meta.title });
  for (const fact of facts) {
    nodes.metaStrip.append(
      el("span", { class: "meta-strip__item" }, [
        icon(fact.icon, { size: 15 }),
        el("span", { text: fact.text }),
      ]),
    );
  }
}

function renderPageMeta() {
  const meta = state.capture?.meta;
  clear(nodes.pageMeta);
  if (!meta) {
    nodes.pageMeta.append(
      el("p", {
        class: "field__hint",
        text: "بيانات الصفحة غير متاحة من المحرك المستخدم (thum.io مثلا).",
      }),
    );
    return;
  }

  const rows = [
    ["العنوان", meta.title, "ltr"],
    ["النطاق", meta.publisher, "ltr"],
    ["اللغة", meta.lang, null],
    ["الرابط النهائي", meta.resolvedUrl, "ltr"],
    ["الوصف", meta.description, null],
  ];
  for (const [key, value, variant] of rows) {
    if (!value) continue;
    nodes.pageMeta.append(
      el("div", { class: "kv__row" }, [
        el("span", { class: "kv__key", text: key }),
        el("span", {
          class: variant === "ltr" ? "kv__val kv__val--ltr" : "kv__val",
          text: String(value),
        }),
      ]),
    );
  }
  if (meta.redirects?.length) {
    nodes.pageMeta.append(
      el("div", { class: "field" }, [
        el("span", { class: "field__label", text: `سلسلة التحويل (${meta.redirects.length})` }),
        el(
          "ol",
          { class: "redirect-chain" },
          meta.redirects.map((hop) => el("li", { "data-ltr": "true", text: String(hop) })),
        ),
      ]),
    );
  }
}

/* ----------------------------------------------------------------- actions */

async function handleDownload() {
  const capture = state.capture;
  if (!capture) return;
  try {
    const result = await exportCapture({
      image: capture.image,
      host: hostLabel(capture.meta?.resolvedUrl ?? state.target),
      format: findFormat(state.options.format),
      quality: state.options.quality,
      annotation: { ...state.annotation, enabled: false },
    });
    toast(`تم تنزيل ${result.filename} (${formatBytes(result.bytes)})`, { tone: "ok" });
  } catch (error) {
    toast(error.message || "فشل التنزيل.", { tone: "error" });
  }
}

async function handleCopy() {
  const capture = state.capture;
  if (!capture) return;
  try {
    await copyCaptureToClipboard({
      image: capture.image,
      format: findFormat(state.options.format),
      quality: state.options.quality,
      annotation: { ...state.annotation, enabled: false },
    });
    toast("اتنسخت الصورة للحافظة.", { tone: "ok" });
  } catch (error) {
    toast(error.message || "الحافظة مش متاحة.", { tone: "error" });
  }
}

async function applyAnnotation({ download, copy }) {
  const capture = state.capture;
  if (!capture) return;
  const url = capture.meta?.resolvedUrl ?? state.target;
  try {
    if (download) {
      const result = await exportCapture({
        image: capture.image,
        host: hostLabel(url),
        format: findFormat(state.options.format),
        quality: state.options.quality,
        annotation: { ...state.annotation, enabled: true, url },
      });
      toast(`تم الحفظ بالعلامة: ${result.filename}`, { tone: "ok" });
    }
    if (copy) {
      await copyCaptureToClipboard({
        image: capture.image,
        format: findFormat(state.options.format),
        quality: state.options.quality,
        annotation: { ...state.annotation, enabled: true, url },
      });
      toast("اتنسخت الصورة بالعلامة للحافظة.", { tone: "ok" });
    }
  } catch (error) {
    toast(error.message || "فشلت العملية.", { tone: "error" });
    return;
  }
  // Close on success only: if the export threw, the settings the user just
  // tuned are still on screen and closing would throw that work away.
  nodes.annotateDialog.close();
}

function openViewer() {
  const capture = state.capture;
  if (!capture) return;
  lightbox.open({
    url: capture.imageUrl,
    caption: hostLabel(capture.meta?.resolvedUrl ?? state.target),
    width: capture.width,
    height: capture.height,
  });
}

function openCompare() {
  const others = gallery.entries.filter((entry) => entry.imageUrl !== state.capture?.imageUrl);
  clear(nodes.comparePick);
  nodes.comparePick.append(
    el("option", {
      value: "",
      text: others.length ? "اختر لقطة من مكتبتك…" : "مفيش لقطات تانية في المكتبة",
    }),
  );
  for (const entry of others) {
    nodes.comparePick.append(
      el("option", {
        value: entry.id,
        text: `${entry.host} · ${entry.width}×${entry.height} · ${formatRelativeTime(entry.savedAt)}`,
      }),
    );
  }
  // Default to the newest counterpart so opening the dialog shows a real
  // comparison instead of an empty stage the user has to opt out of.
  state.compareId = others[0]?.id ?? null;
  nodes.comparePick.value = state.compareId ?? "";
  renderCompare();
  nodes.compareDialog.showModal();
}

function renderCompare() {
  const other = state.compareId ? gallery.find(state.compareId) : null;
  const currentHost = hostLabel(state.target) || "اللقطة الحالية";
  if (!state.capture || !other) {
    mountCompare(nodes.compareStage, {
      empty: true,
      before: "",
      after: "",
      labelA: currentHost,
      labelB: "اللقطة المختارة",
    });
    return;
  }
  mountCompare(nodes.compareStage, {
    before: other.imageUrl,
    after: state.capture.imageUrl,
    labelA: other.host,
    labelB: currentHost,
  });
}

function openQr() {
  const value = state.capture?.meta?.resolvedUrl ?? state.target;
  if (!value) return;
  try {
    const matrix = encodeQr(value, { ecc: "M" });
    drawToCanvas(nodes.qrCanvas, matrix, { scale: 6, margin: 4 });
    nodes.qrNote.textContent = `مستوى تصحيح الأخطاء M · الإصدار ${matrix.version} · القناع ${matrix.mask} · ${matrix.size}×${matrix.size} وحدة`;
    nodes.qrTag.textContent = `${value.length} حرف`;
    nodes.qrDialog.dataset.value = value;
    nodes.qrDialog.showModal();
  } catch (error) {
    toast(
      error instanceof QrError ? error.message : "الرابط طويل جداً على أن يتحول لرمز QR.",
      { tone: "error" },
    );
  }
}

function downloadQr() {
  const value = nodes.qrDialog.dataset.value;
  if (!value) return;
  nodes.qrCanvas.toBlob((blob) => {
    if (!blob) {
      toast("تعذر إنشاء ملف الرمز.", { tone: "error" });
      return;
    }
    downloadBlob(blob, `qr-${hostLabel(value)}-${stamp()}.png`);
    toast("تم تنزيل رمز QR.", { tone: "ok" });
  }, "image/png");
}

/* -------------------------------------------------------------- embed code */

function renderEmbed() {
  const target = state.capture?.meta?.resolvedUrl ?? state.target;
  if (!target) {
    clear(nodes.embedTabs);
    nodes.embedCode.textContent = "التقط أي موقع الأول عشان نولّدلك الكود.";
    nodes.embedNote.textContent = "";
    nodes.embedDialog.dataset.url = "";
    return;
  }

  // The tab row is built once and only its aria-selected is updated afterwards.
  // Re-creating it per render would drop keyboard focus to <body> on every
  // arrow key and invalidate any reference the caller holds.
  if (nodes.embedTabs.childElementCount !== EMBED_TABS.length) {
    clear(nodes.embedTabs);
    for (const tab of EMBED_TABS) {
      nodes.embedTabs.append(
        el(
          "button",
          {
            type: "button",
            role: "tab",
            dataset: { tab: tab.id },
            text: tab.label,
            onclick: () => {
              state.embedTab = tab.id;
              renderEmbed();
            },
          },
        ),
      );
    }
  }
  for (const button of $$("#embedTabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === state.embedTab));
  }

  const imageUrl = buildMicrolinkUrl(target, state.options, "image");
  const title = state.capture?.meta?.title ?? hostLabel(target);
  const snippets = {
    url: imageUrl,
    html: `<img\n  src="${imageUrl}"\n  alt="${escapeAttr(title)}"\n  loading="lazy">`,
    img: `![${title}](${imageUrl})`,
    curl: `curl -L --output shot.png "${imageUrl}"`,
  };
  nodes.embedCode.textContent = snippets[state.embedTab];
  nodes.embedNote.textContent =
    "الرابط ده بيشتغل في أي مكان — من غير API key. حطه في HTML أو README أو أي صفحة عادية، والطلب المتكرر بيتخدم من كاش المحرك.";
  nodes.embedDialog.dataset.url = imageUrl;
}

function openEmbed() {
  renderEmbed();
  nodes.embedDialog.showModal();
}

async function copyEmbed() {
  const ok = await copyText(nodes.embedCode.textContent);
  toast(ok ? "اتنسخ الكود." : "مقدرناش ننسخ — حدّد الكود يدوي.", { tone: ok ? "ok" : "error" });
}

function openEmbedLive() {
  const url = nodes.embedDialog.dataset.url;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/* ------------------------------------------------------------------ share */

async function handleShare() {
  if (!state.target) {
    toast("التقط أي موقع الأول.", { tone: "info" });
    return;
  }
  const url = shareUrl({ url: state.target, options: state.options, annotation: state.annotation });
  writeHash({ url: state.target, options: state.options, annotation: state.annotation });

  if (navigator.share) {
    try {
      await navigator.share({ title: "ShotSmith", url });
      return;
    } catch {
      /* the user dismissed the share sheet — fall through to the clipboard */
    }
  }
  const ok = await copyText(url);
  toast(ok ? "اتنسخ رابط المشاركة — كل الإعدادات جواه." : "مقدرناش ننسخ الرابط.", {
    tone: ok ? "ok" : "error",
  });
}

/* ---------------------------------------------------------------- gallery */

function saveToGallery(capture) {
  try {
    const entry = gallery.add({
      host: hostLabel(capture.meta?.resolvedUrl ?? state.target),
      url: capture.meta?.resolvedUrl ?? state.target,
      imageUrl: capture.imageUrl,
      thumbnail: thumbnailDataUrl(capture.image),
      width: capture.width,
      height: capture.height,
      device: capture.device.label,
      provider: capture.providerLabel,
      options: { ...state.options },
    });
    if (!gallery.writable) {
      toast("المكتبة امتلأت التخزين — اتحذفت أقدم اللقطات تلقائياً.", { tone: "info" });
    }
    return entry;
  } catch (error) {
    toast("مقدرناش نحفظ اللقطة في المكتبة (مساحة التخزين).", { tone: "error" });
    return null;
  }
}

function renderGallery(entries = gallery.entries) {
  clear(nodes.gallery);
  nodes.galleryCount.textContent = entries.length
    ? arabicCount(entries.length, { one: "لقطة", two: "لقطتان", few: "لقطات", many: "لقطة" })
    : "";
  nodes.galleryEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    nodes.gallery.append(
      el("div", { class: "shot" }, [
        el(
          "button",
          {
            class: "shot__thumb",
            type: "button",
            "aria-label": `فتح لقطة ${entry.host}`,
            onclick: () =>
              lightbox.open({
                url: entry.imageUrl,
                caption: entry.host,
                width: entry.width,
                height: entry.height,
              }),
          },
          [
            el("img", {
              src: entry.thumbnail,
              alt: `لقطة ${entry.host}`,
              loading: "lazy",
            }),
          ],
        ),
        el("div", { class: "shot__body" }, [
          el("span", { class: "shot__host", text: entry.host }),
          el("span", {
            class: "shot__sub",
            text: `${entry.width}×${entry.height} · ${entry.device} · ${formatRelativeTime(entry.savedAt)}`,
          }),
        ]),
        el(
          "button",
          {
            class: "shot__remove",
            type: "button",
            "aria-label": `حذف لقطة ${entry.host}`,
            onclick: () => gallery.remove(entry.id),
          },
          [icon("close", { size: 16 })],
        ),
      ]),
    );
  }
}

function confirmClearGallery() {
  if (!gallery.entries.length) return;

  const dialog = el("dialog", { class: "sheet", "aria-label": "مسح المكتبة" });
  dialog.style.setProperty("max-width", "420px");
  dialog.append(
    el("div", { class: "sheet__body" }, [
      el("div", { class: "sheet__head" }, [
        el("h2", { class: "sheet__title" }, [icon("delete_sweep", { size: 20 }), el("span", { text: "مسح المكتبة" })]),
      ]),
      el("div", { class: "sheet__content" }, [
        el("p", {
          text: `هنتخلي عن ${gallery.entries.length} لقطة محفوظة على جهازك. مش هينفع تراجعها.`,
        }),
      ]),
      el("div", { class: "sheet__foot" }, [
        el(
          "button",
          {
            class: "btn btn--primary",
            type: "button",
            text: "أكيد، امسح",
            onclick: () => {
              gallery.clear();
              dialog.close();
            },
          },
        ),
        el("button", { class: "btn", type: "button", text: "إلغاء", onclick: () => dialog.close() }),
      ]),
    ]),
  );
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

/* ------------------------------------------------------------ studio (3up) */

async function runStudio(trigger) {
  const target = validateTarget();
  if (!target) {
    nodes.studioDialog.close();
    nodes.targetUrl.focus();
    return;
  }
  trigger?.setAttribute("disabled", "");

  const shots = [];
  state.studioShots = shots;
  clear(nodes.studioGallery);
  const format = findFormat(state.options.format);

  try {
    for (const [index, step] of STUDIO_PLAN.entries()) {
      nodes.studioStatus.textContent = `بنلتقط ${step.label}… (${index + 1}/${STUDIO_PLAN.length})`;
      const result = await engine.capture({
        target: target.url,
        options: { ...state.options, deviceId: step.deviceId, fullPage: false },
        engineOrder: state.engineOrder,
      });

      const shot = {
        label: step.label,
        deviceId: step.deviceId,
        device: findDevice(step.deviceId),
        imageUrl: result.imageUrl,
        thumbnail: thumbnailDataUrl(result.image),
        width: result.width,
        height: result.height,
        providerLabel: result.providerLabel,
      };
      shots.push(shot);
      renderStudio();

      gallery.add({
        host: `${target.host} · ${step.label}`,
        url: target.url,
        imageUrl: result.imageUrl,
        thumbnail: shot.thumbnail,
        width: result.width,
        height: result.height,
        device: shot.device.label,
        provider: result.providerLabel,
        options: { ...state.options, deviceId: step.deviceId },
      });
    }
    nodes.studioStatus.textContent = shots
      .map((s) => `${s.label} ${s.width}×${s.height}`)
      .join("  ·  ");
  } catch (error) {
    nodes.studioStatus.textContent =
      error?.name === "AbortError" ? "أُلغي الالتقاط." : `فشل: ${error.message}`;
  } finally {
    trigger?.removeAttribute("disabled");
  }
}

function renderStudio() {
  clear(nodes.studioGallery);
  for (const shot of state.studioShots) {
    nodes.studioGallery.append(
      el("div", { class: "shot" }, [
        el(
          "button",
          {
            class: "shot__thumb",
            type: "button",
            "aria-label": `تكبير لقطة ${shot.label}`,
            onclick: () =>
              lightbox.open({
                url: shot.imageUrl,
                caption: `${shot.label} · ${shot.width}×${shot.height}`,
                width: shot.width,
                height: shot.height,
              }),
          },
          [el("img", { src: shot.thumbnail, alt: `لقطة ${shot.label}`, loading: "lazy" })],
        ),
        el("div", { class: "shot__body" }, [
          el("span", { class: "shot__host", text: shot.label }),
          el("span", { class: "shot__sub", text: `${shot.width}×${shot.height}px` }),
        ]),
      ]),
    );
  }
}

async function downloadStudioAll() {
  if (!state.studioShots.length) {
    toast("شغّل الالتقاط الأول.", { tone: "info" });
    return;
  }
  const format = findFormat(state.options.format);
  for (const shot of state.studioShots) {
    try {
      const blob = await engine.exportBlob({
        imageUrl: shot.imageUrl,
        format,
        quality: state.options.quality,
      });
      downloadBlob(blob, `${hostLabel(state.target)}-${shot.deviceId}.${format.ext}`);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch {
      toast(`فشل تنزيل ${shot.label}.`, { tone: "error" });
    }
  }
  toast("تم تنزيل كل المقاسات.", { tone: "ok" });
}

/* ------------------------------------------------------------- commands */

function registerCommands() {
  palette.register([
    { label: "التقاط الموقع", icon: "photo_camera", keywords: "capture screenshot التقاط", run: () => runCapture() },
    { label: "تركيز حقل الرابط", icon: "link", shortcut: "/", keywords: "focus url رابط", run: () => nodes.targetUrl.focus() },
    { label: "تكبير النتيجة", icon: "zoom_in_map", keywords: "zoom viewer تكبير", run: openViewer },
    { label: "تنزيل الصورة", icon: "download", keywords: "save download تنزيل", run: handleDownload },
    { label: "نسخ الصورة للحافظة", icon: "content_copy", keywords: "copy clipboard نسخ", run: handleCopy },
    { label: "علامة مائية", icon: "draw", keywords: "watermark annotate علامة", run: () => nodes.annotateDialog.showModal() },
    { label: "مقارنة لقطتين", icon: "compare", keywords: "compare diff مقارنة", run: openCompare },
    { label: "رمز QR للرابط", icon: "qr_code_2", keywords: "qr code رمز", run: openQr },
    { label: "الكود الجاهز للتضمين", icon: "code", keywords: "embed api html api كود", run: openEmbed },
    { label: "استوديو 3 مقاسات", icon: "photo_library", keywords: "studio responsive مقاسات", run: () => nodes.studioDialog.showModal() },
    { label: "رابط مشاركة", icon: "share", keywords: "share link مشاركة", run: handleShare },
    { label: "تبديل المظهر", icon: "contrast", keywords: "theme dark light مظهر", run: cycleTheme },
    { label: "مسح المكتبة", icon: "delete_sweep", keywords: "clear gallery مسح", run: confirmClearGallery },
    { label: "إعادة ضبط الإعدادات", icon: "restart_alt", keywords: "reset settings ضبط", run: resetAll },
    { label: "المساعدة والاختصارات", icon: "help", shortcut: "?", keywords: "help shortcuts مساعدة", run: () => nodes.helpDialog.showModal() },
  ]);
}

function resetAll() {
  prefs.reset();
  state.options = { ...DEFAULT_OPTIONS };
  state.annotation = { ...ANNOTATION_DEFAULTS, wmStyle: "bar", mode: "none", plate: "bar" };
  nodes.targetUrl.value = "";
  syncInputsFromState();
  renderOptions();
  renderAnnotationInputs();
  toast("رجّعنا كل الإعدادات للأصل.");
}

function syncInputsFromState() {
  nodes.fullPage.checked = state.options.fullPage;
  nodes.hideScrollbars.checked = state.options.hideScrollbars;
  nodes.omitBackground.checked = state.options.omitBackground;
  nodes.quality.value = String(state.options.quality);
  nodes.elementSelector.value = state.options.element ?? "";
  nodes.extraWait.value = String(state.options.waitForTimeout);
}

/* --------------------------------------------------------------- restore */

function restoreState() {
  const stored = prefs.load();
  state.options = { ...DEFAULT_OPTIONS, ...stored.options };
  state.annotation = { ...ANNOTATION_DEFAULTS, wmStyle: "bar", ...stored.annotation };
  state.theme = stored.theme === "light" || stored.theme === "dark" ? stored.theme : "auto";

  const shared = readHash();
  if (shared?.url) {
    nodes.targetUrl.value = shared.url;
    state.options = { ...state.options, ...shared.options };
    state.annotation = { ...state.annotation, ...shared.annotation, wmStyle: state.annotation.wmStyle };
    return { shared: true, url: shared.url };
  }

  const remembered = localStorage.getItem("shotsmith.lastTarget");
  if (remembered) nodes.targetUrl.value = remembered;
  return { shared: false, url: null };
}

/* ------------------------------------------------------------------ init */

function init() {
  cacheNodes();
  lightbox = new Lightbox(nodes.viewerDialog);
  palette = new CommandPalette($("#paletteDialog"));

  const restored = restoreState();
  buildStaticControls();
  bindForm();

  syncInputsFromState();
  setTheme(state.theme);
  renderThemeToggle();
  renderOptions();
  renderAnnotationInputs();
  renderEngineStatus();
  renderGallery();
  gallery.subscribe(() => renderGallery());

  registerCommands();

  bindShortcuts({
    "mod+k": () => palette.toggle(),
    "/": () => nodes.targetUrl.focus(),
    "?": () => nodes.helpDialog.showModal(),
  });

  window.addEventListener("hashchange", () => {
    const shared = readHash();
    if (!shared?.url) return;
    nodes.targetUrl.value = shared.url;
    state.options = { ...state.options, ...shared.options };
    state.annotation = { ...state.annotation, ...shared.annotation };
    syncInputsFromState();
    renderOptions();
    renderAnnotationInputs();
    runCapture();
  });

  if (restored.shared) {
    validateTarget();
    runCapture();
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is a bonus; never surface its failure */
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}