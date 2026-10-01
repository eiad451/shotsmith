/**
 * Device presets and the single place where capture options are translated
 * into provider query strings.
 *
 * Every option here is verified against the live engines; providers reject
 * unknown path segments (thum.io silently swallows the target URL), so this
 * module is deliberately the only place that knows provider syntax.
 */

export const DEVICES = [
  {
    id: "desktop-hd",
    label: "سطح مكتب HD",
    short: "1920×1080",
    width: 1920,
    height: 1080,
    scale: 1,
    mobile: false,
    icon: "desktop_windows",
  },
  {
    id: "laptop",
    label: "لابتوب ريتينا",
    short: "1440×900",
    width: 1440,
    height: 900,
    scale: 2,
    mobile: false,
    icon: "laptop_mac",
  },
  {
    id: "ipad-pro",
    label: "iPad Pro 11″",
    short: "834×1194",
    width: 834,
    height: 1194,
    scale: 2,
    mobile: true,
    icon: "tablet_mac",
  },
  {
    id: "iphone-15-pro",
    label: "iPhone 15 Pro",
    short: "393×852",
    width: 393,
    height: 852,
    scale: 3,
    mobile: true,
    icon: "smartphone",
  },
  {
    id: "pixel-8",
    label: "Pixel 8",
    short: "412×915",
    width: 412,
    height: 915,
    scale: 2.625,
    mobile: true,
    icon: "smartphone",
  },
  {
    id: "iphone-se",
    label: "iPhone SE",
    short: "375×667",
    width: 375,
    height: 667,
    scale: 2,
    mobile: true,
    icon: "smartphone",
  },
];

export const FORMATS = [
  { id: "png", label: "PNG", mime: "image/png", ext: "png", lossy: false },
  { id: "jpeg", label: "JPG", mime: "image/jpeg", ext: "jpg", lossy: true },
];

export const DEFAULT_OPTIONS = {
  deviceId: "desktop-hd",
  fullPage: false,
  format: "png",
  quality: 88,
  hideScrollbars: true,
  omitBackground: false,
  element: "",
  waitForTimeout: 1500,
  waitUntil: "networkidle2",
};

export function findDevice(id) {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0];
}

export function findFormat(id) {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}

function bool(value) {
  return value ? "true" : "false";
}

/**
 * Build the microlink request. `mode` decides the payload shape:
 *  - "render"  → JSON with metadata (one quota unit, gives redirects/publisher)
 *  - "image"   → the CORS-enabled CDN passthrough used for export bytes
 *  - "preview" → JSON without metadata, cheapest way to get pixels
 */
export function buildMicrolinkUrl(target, options, mode = "render") {
  const device = findDevice(options.deviceId);
  const format = findFormat(options.format);
  const params = new URLSearchParams();
  params.set("url", target);
  params.set("screenshot", "true");
  params.set("viewport.width", String(device.width));
  params.set("viewport.height", String(device.height));
  params.set("viewport.deviceScaleFactor", String(device.scale));
  if (device.mobile) params.set("viewport.mobile", "true");
  params.set("screenshot.fullPage", bool(options.fullPage));
  params.set("screenshot.type", format.id);
  if (format.lossy) params.set("screenshot.quality", String(options.quality));
  if (options.hideScrollbars) params.set("screenshot.hideScrollbars", "true");
  if (options.omitBackground && !format.lossy) {
    params.set("screenshot.omitBackground", "true");
  }
  if (options.element?.trim()) params.set("screenshot.element", options.element.trim());
  if (Number(options.waitForTimeout) > 0) {
    params.set("waitForTimeout", String(Math.min(Number(options.waitForTimeout), 30000)));
  }
  if (options.waitUntil) params.set("waitUntil", options.waitUntil);

  if (mode === "image") {
    params.set("meta", "false");
    params.set("embed", "screenshot.url");
  } else {
    params.set("meta", mode === "preview" ? "false" : "true");
  }
  return `https://api.microlink.io/?${params.toString()}`;
}

/**
 * thum.io fallback. Only these segments are known-good; anything else shifts
 * the trailing target URL out of its slot. Options are whole path segments
 * and the target is appended last, raw and unencoded — thum.io reads it as
 * the remainder of the path and answers 400 for a percent-encoded target.
 * Query strings therefore survive, which is what users expect from a link.
 */
export function buildThumioUrl(target, options) {
  const device = findDevice(options.deviceId);
  const parts = [`viewportWidth/${device.width}`, `viewportHeight/${device.height}`];
  parts.push(`width/${Math.min(device.width, 1600)}`);
  if (options.fullPage) parts.push("fullpage");
  if (options.format === "jpeg") parts.push("allowJPG");
  const waitSeconds = Math.min(Math.ceil(Number(options.waitForTimeout || 0) / 1000), 10);
  if (waitSeconds > 0) parts.push(`wait/${waitSeconds}`);
  parts.push("noanimate", "maxAge/6");
  parts.push(target);
  return `https://image.thum.io/get/${parts.join("/")}`;
}

export function buildProviderUrl(provider, target, options, mode = "render") {
  return provider === "thumio"
    ? buildThumioUrl(target, options)
    : buildMicrolinkUrl(target, options, mode);
}

/** Human sentence describing exactly what will be requested. */
export function describeOptions(options) {
  const device = findDevice(options.deviceId);
  const format = findFormat(options.format);
  const bits = [
    `${device.width}×${device.height} @${device.scale}x`,
    options.fullPage ? "الصفحة كاملة" : "الشاشة فقط",
    format.id === "jpeg" ? `JPG جودة ${options.quality}` : "PNG",
  ];
  if (options.element?.trim()) bits.push(`عنصر ${options.element.trim()}`);
  if (options.waitForTimeout > 0) bits.push(`انتظار ${options.waitForTimeout}ms`);
  return bits;
}
