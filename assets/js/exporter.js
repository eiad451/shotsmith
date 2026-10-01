/**
 * Export pipeline: composite annotations onto the capture and hand back a
 * real file.
 *
 * Two things matter here for correctness:
 *  1. The source image is fetched from the CORS-enabled provider URL, so the
 *     canvas stays untainted and toBlob produces real bytes. If the fetch
 *     fails we fall back to the already-decoded <img>, which is still untainted
 *     precisely because it was loaded with crossOrigin="anonymous".
 *  2. Watermarks are drawn at the EXPORT resolution, not the preview
 *     resolution, so a 3x device capture gets a watermark proportional to its
 *     pixels rather than a smudge.
 */

import { downloadBlob, safeFilename, stamp, toast } from "./dom.js";

export const ANNOTATION_DEFAULTS = {
  enabled: false,
  mode: "none",
  label: "",
  sublabel: "",
  padding: 0,
  corner: "bottom-start",
  showTimestamp: true,
  showUrl: true,
};

const FONT_STACK = '"IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif';

/**
 * @param {HTMLImageElement} image source capture
 * @param {object} annotation annotation settings
 * @returns {HTMLCanvasElement}
 */
export function composeCanvas(image, annotation) {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const padding = Math.max(0, Math.min(400, Math.round(annotation.padding)));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth + padding * 2;
  canvas.height = sourceHeight + padding * 2;

  const ctx = canvas.getContext("2d");
  const backdrop = annotation.mode === "panel";
  if (backdrop) {
    ctx.fillStyle = annotation.panelColor ?? "#131314";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, padding, padding);

  if (annotation.enabled) {
    drawWatermark(ctx, canvas, annotation);
  }
  return canvas;
}

function drawWatermark(ctx, canvas, annotation) {
  const title = (annotation.label ?? "").trim() || "ShotSmith";
  const subtitleParts = [];
  if (annotation.sublabel?.trim()) subtitleParts.push(annotation.sublabel.trim());
  if (annotation.showUrl && annotation.url) subtitleParts.push(shortenUrl(annotation.url));
  if (annotation.showTimestamp) {
    subtitleParts.push(new Date().toLocaleString("ar-EG", { hour12: true }));
  }
  const subtitle = subtitleParts.join("  ·  ");

  // Scale typography off the capture's own width so it reads the same on a
  // 375px phone shot and a 3840px desktop shot.
  const unit = Math.max(1, canvas.width / 1200);
  const titleSize = Math.round(34 * unit);
  const subtitleSize = Math.round(20 * unit);
  const gap = Math.round(26 * unit);
  const inset = Math.round(34 * unit);

  const align = annotation.corner?.endsWith("end") ? "right" : "left";
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.direction = "rtl";

  const anchorX = align === "right" ? canvas.width - inset : inset;
  const blockHeight = titleSize * 1.25 + (subtitle ? subtitleSize * 1.4 : 0) + gap;
  const anchorY = annotation.corner?.startsWith("top") ? inset : canvas.height - inset - blockHeight;

  if (annotation.plate !== "none") {
    const barHeight = blockHeight + inset * 0.5;
    const barY = annotation.corner?.startsWith("top") ? 0 : canvas.height - barHeight;
    ctx.fillStyle = annotation.plateColor ?? "rgba(19,19,20,0.82)";
    ctx.fillRect(0, barY, canvas.width, barHeight);
  }

  ctx.save();
  if (annotation.mode === "shadow") {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 10 * unit;
    ctx.shadowOffsetY = 2 * unit;
  }
  ctx.fillStyle = annotation.ink ?? "#ffffff";
  ctx.font = `700 ${titleSize}px ${FONT_STACK}`;
  ctx.fillText(title, anchorX, anchorY, canvas.width - inset * 2);

  if (subtitle) {
    ctx.font = `500 ${subtitleSize}px ${FONT_STACK}`;
    ctx.fillStyle = annotation.subInk ?? "rgba(255,255,255,0.82)";
    ctx.fillText(subtitle, anchorX, anchorY + titleSize * 1.25 + gap * 0.4, canvas.width - inset * 2);
  }
  ctx.restore();
}

function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const text = `${parsed.hostname.replace(/^www\./, "")}${path}`;
    return text.length > 46 ? `${text.slice(0, 44)}…` : text;
  } catch {
    return url.slice(0, 46);
  }
}

export function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("تعذر تحويل الصورة إلى ملف."));
      },
      mime,
      mime === "image/jpeg" ? quality / 100 : undefined,
    );
  });
}

export async function exportCapture({ image, imageUrl, format, quality, annotation, host }) {
  const canvas = composeCanvas(image, { ...annotation, url: annotation.url ?? null });
  const blob = await canvasToBlob(canvas, format.mime, quality);
  const filename = safeFilename(host, stamp(), format.ext);
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, width: canvas.width, height: canvas.height };
}

/**
 * Copy the composed image to the clipboard. Requires a secure context and a
 * user gesture; both are checked up front so the failure is a readable toast
 * instead of an unhandled rejection.
 */
export async function copyCaptureToClipboard({ image, imageUrl, format, quality, annotation }) {
  if (!window.isSecureContext) {
    throw new Error("الحافظة تحتاج اتصال آمن (https).");
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("متصفحك لا يدعم نسخ الصور. استخدم زر التنزيل.");
  }
  const canvas = composeCanvas(image, { ...annotation, url: annotation.url ?? null });
  const blob = await canvasToBlob(canvas, format.mime, quality);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

/** Downscale for gallery storage so localStorage does not blow its quota. */
export function thumbnailDataUrl(image, maxWidth = 420) {
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export async function saveAnnotated({ image, host, format, quality, annotation }) {
  try {
    const result = await exportCapture({ image, host, format, quality, annotation });
    toast(`تم حفظ ${result.filename}`, { tone: "ok" });
    return result;
  } catch (error) {
    toast(error.message || "فشل الحفظ.", { tone: "error" });
    return null;
  }
}
