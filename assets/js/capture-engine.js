/**
 * Capture engine: provider orchestration, retry policy, error classification
 * and quota telemetry.
 *
 * Design notes that are not obvious from the code:
 *  - The image request and the metadata request are issued in parallel. The
 *    image is the critical path, metadata is a bonus, so a metadata failure
 *    must not fail the capture.
 *  - Preview and export share ONE url. The engines are asked for their CORS
 *    passthrough (`embed=screenshot.url`) precisely so the bytes we display are
 *    the bytes we save. Mixing in the CDN url would taint the export canvas.
 *  - Microlink's free quota is a shared public bucket, not a personal budget:
 *    the remaining counter moves because of other users. It is surfaced as an
 *    approximate health signal, and repeated identical requests are cache
 *    served, which is why local caching is a real quota saving.
 */

import {
  buildMicrolinkUrl,
  buildThumioUrl,
  findDevice,
  findFormat,
} from "./device-presets.js";

export const ENGINES = [
  {
    id: "microlink",
    label: "Microlink",
    supportsMeta: true,
    supportsElement: true,
    build: buildMicrolinkUrl,
  },
  {
    id: "thumio",
    label: "thum.io",
    supportsMeta: false,
    supportsElement: false,
    build: buildThumioUrl,
  },
];

const IMAGE_TIMEOUT_MS = 45000;
const META_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;

/** Microlink error codes that will never succeed on retry. */
const FATAL_CODES = new Set([
  "EINVALURL",
  "EFORBIDDENURL",
  "EPROTECTEDURL",
  "EINVALIDQUERY",
  "EINVALIDSELECTOR",
]);

export class CaptureError extends Error {
  constructor(message, { code = "EUNKNOWN", provider = null, retriable = false, hint = "" } = {}) {
    super(message);
    this.name = "CaptureError";
    this.code = code;
    this.provider = provider;
    this.retriable = retriable;
    this.hint = hint;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function backoffDelay(attempt) {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.random() * 250;
}

function describeHttpStatus(status) {
  if (status === 429) return "تجاوزت الحد المسموح من الطلبات على المحرك.";
  if (status === 403) return "المحرك رفض الطلب (قد يكون الموقع محمي أو محجوب).";
  if (status === 404) return "المحرك لم يجد الصفحة المطلوبة.";
  if (status >= 500) return `خطأ من خادم المحرك (${status}).`;
  return `استجابة غير متوقعة من المحرك (${status}).`;
}

/** Preload an image with a hard timeout so a hung CDN cannot wedge the UI. */
export function loadImage(url, { signal, timeout = IMAGE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    const timer = setTimeout(() => {
      img.src = "";
      reject(new CaptureError("انتهت مهلة تحميل الصورة.", { code: "ETIMEDOUT", retriable: true }));
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      img.src = "";
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(
        new CaptureError("تعذر جلب الصورة من المحرك.", {
          code: "EIMAGE",
          retriable: true,
        }),
      );
    };
    img.src = url;
  });
}

function readQuota(headers) {
  const remaining = headers.get("x-rate-limit-remaining");
  const limit = headers.get("x-rate-limit-limit");
  const reset = headers.get("x-rate-limit-reset");
  if (remaining == null && limit == null) return null;
  return {
    remaining: Number.isFinite(Number(remaining)) ? Number(remaining) : null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    resetsAt: Number.isFinite(Number(reset)) ? Number(reset) * 1000 : null,
    shared: true,
  };
}

async function readMeta(target, options, signal) {
  const url = buildMicrolinkUrl(target, options, "render");
  const res = await fetch(url, { signal, referrerPolicy: "no-referrer" });
  const quota = readQuota(res.headers);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = describeHttpStatus(res.status);
    let code = `EHTTP${res.status}`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.data?.url) message = parsed.data.url;
      if (parsed?.code) code = parsed.code;
    } catch {
      /* non-JSON error body: keep the HTTP-derived message */
    }
    throw Object.assign(
      new CaptureError(message, {
        code,
        provider: "microlink",
        retriable: res.status === 429 || res.status >= 500,
        hint: res.status === 429 ? "جرّب محرك thum.io الاحتياطي أو انتظر بداية نافذة الحد." : "",
      }),
      // Quota telemetry is useful even on failure — keep it on the error so the
      // health bar stays honest when metadata and pixels fail for different
      // reasons.
      { quota },
    );
  }

  const payload = await res.json();
  if (payload?.status !== "success") {
    const code = payload?.code ?? "EUNKNOWN";
    throw Object.assign(
      new CaptureError(payload?.data?.url || "فشل المحرك في التقاط الصفحة.", {
        code,
        provider: "microlink",
        retriable: !FATAL_CODES.has(code),
      }),
      { quota },
    );
  }
  return {
    meta: {
      ...(payload.data ?? {}),
      // The redirect chain sits at the top level of the envelope, not inside
      // `data`, so it has to be lifted into the metadata object here.
      redirects: payload.redirects ?? payload.data?.redirects ?? [],
    },
    quota,
  };
}

function normalizeMeta(raw, target) {
  const pick = (v) => (typeof v === "string" ? v : (v?.url ?? null));
  return {
    title: pick(raw.title),
    description: pick(raw.description),
    publisher: pick(raw.publisher),
    lang: pick(raw.lang),
    logo: pick(raw.logo) ?? pick(raw.favicon),
    hero: pick(raw.image),
    resolvedUrl: pick(raw.url) ?? target,
    redirects: Array.isArray(raw.redirects) ? raw.redirects.map((r) => pick(r)).filter(Boolean) : [],
    dimensions: null,
  };
}

async function attemptProvider(engine, target, options, signal) {
  const imageUrl = engine.build(target, options, engine.id === "microlink" ? "image" : "render");

  const metaPromise = engine.supportsMeta
    ? readMeta(target, options, signal).then(
        (r) => ({ ok: true, ...r }),
        (error) => ({ ok: false, error }),
      )
    : Promise.resolve({ ok: false, skipped: true });

  const imagePromise = loadImage(imageUrl, { signal });
  const [metaResult, img] = await Promise.all([metaPromise, imagePromise]);

  const device = findDevice(options.deviceId);
  const format = findFormat(options.format);

  return {
    imageUrl,
    provider: engine.id,
    providerLabel: engine.label,
    width: img.naturalWidth,
    height: img.naturalHeight,
    bytes: img.naturalWidth * img.naturalHeight * (format.lossy ? 0.3 : 0.45),
    meta: metaResult.ok ? normalizeMeta(metaResult.meta, target) : null,
    metaWarning: metaResult.ok ? null : (metaResult.error?.message ?? null),
    quota: metaResult.ok ? metaResult.quota : (metaResult.error?.quota ?? null),
    device,
    format,
    degraded:
      !metaResult.ok ||
      (options.element?.trim() && !engine.supportsElement) ||
      (options.omitBackground && format.id === "jpeg"),
    notes: buildNotes(engine, options, format, metaResult),
    image: img,
  };
}

function buildNotes(engine, options, format, metaResult) {
  const notes = [];
  if (!metaResult.ok && !metaResult.skipped) {
    notes.push(`بيانات الصفحة غير متاحة من محرك ${engine.label}.`);
  }
  if (options.element?.trim() && !engine.supportsElement) {
    notes.push(`محرك ${engine.label} لا يدعم التقاط عنصر محدد، فتم التقاط الصفحة كاملة.`);
  }
  if (options.omitBackground && format.id === "jpeg") {
    notes.push("الخلفية الشفافة تحتاج PNG، فتم تجاهلها مع JPG.");
  }
  return notes;
}

export class CaptureEngine {
  constructor({ onStage = () => {}, onQuota = () => {} } = {}) {
    this.onStage = onStage;
    this.onQuota = onQuota;
  }

  /**
   * Run the provider chain until one engine produces pixels.
   * @returns {Promise<object>} capture result
   */
  async capture({ target, options, signal, engineOrder = ENGINES.map((e) => e.id) }) {
    const chain = engineOrder
      .map((id) => ENGINES.find((e) => e.id === id))
      .filter(Boolean);

    const failures = [];
    for (const engine of chain) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        this.onStage({ phase: "capture", provider: engine.label, attempt, target });
        try {
          const result = await attemptProvider(engine, target, options, signal);
          if (result.quota) this.onQuota(result.quota);
          this.onStage({ phase: "done", provider: engine.label });
          return { ...result, failures };
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          const wrapped =
            error instanceof CaptureError
              ? error
              : new CaptureError(error?.message || "خطأ غير متوقع.", { code: "EUNKNOWN", retriable: true });
          failures.push({ provider: engine.label, code: wrapped.code, message: wrapped.message });
          if (wrapped.quota) this.onQuota(wrapped.quota);
          if (!wrapped.retriable) break;
          if (attempt < MAX_ATTEMPTS) {
            await sleep(backoffDelay(attempt), signal);
          }
        }
      }
    }

    const last = failures.at(-1);
    throw new CaptureError(
      last?.message || "فشل كل محركات الالتقاط.",
      { code: last?.code ?? "EALLFAILED" },
    );
  }

  /**
   * Fetch the CORS-enabled bytes for a capture url so the export canvas is
   * never tainted. Falls back to re-encoding the already-loaded <img> when the
   * engine omits CORS headers.
   */
  async exportBlob({ imageUrl, image, format, quality }) {
    try {
      const res = await fetch(imageUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (format.lossy && blob.type !== format.mime) return reencode(image, format, quality);
      return blob;
    } catch {
      if (image) return reencode(image, format, quality);
      throw new CaptureError("تعذر تجهيز الملف للتنزيل.", { code: "EXPORT_FAILED" });
    }
  }
}

function reencode(image, format, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (format.id === "png") {
    ctx.drawImage(image, 0, 0);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
  }
  const dataUrl = canvas.toDataURL(format.mime, format.id === "jpeg" ? quality / 100 : undefined);
  const [header, payload] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)[1];
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
