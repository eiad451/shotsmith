/**
 * Target validation and normalisation.
 *
 * Runs entirely client-side. The upstream engines already refuse private
 * ranges server-side (microlink answers EFORBIDDENURL), but failing fast here
 * saves a rate-limit unit and gives the operator an immediate, specific reason.
 */

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "about:"]);

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /\.local$/i,
  /\.internal$/i,
];

export class TargetError extends Error {
  constructor(reason, code) {
    super(reason);
    this.name = "TargetError";
    this.code = code;
  }
}

/**
 * @param {string} raw user input, may omit scheme
 * @returns {{ url: string, host: string, secure: boolean, normalized: string }}
 */
export function normalizeTarget(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!trimmed) {
    throw new TargetError("اكتب رابط الموقع الأول.", "empty");
  }
  if (trimmed.length > 2048) {
    throw new TargetError("الرابط طويل جداً (الحد 2048 حرف).", "too-long");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new TargetError("الرابط مش صالح. مثال صحيح: example.com", "malformed");
  }

  if (BLOCKED_SCHEMES.has(parsed.protocol) || parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TargetError("المسموح بروابط http و https فقط.", "scheme");
  }
  if (!parsed.hostname) {
    throw new TargetError("اسم النطاق ناقص. اكتب example.com", "host");
  }
  // Private ranges are checked before the public-suffix rule so `localhost`
  // reports the real reason (private network) instead of "name is missing a dot".
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) {
    throw new TargetError("لا يمكن التقاط عناوين الشبكة الداخلية أو المحلية.", "private");
  }
  if (!parsed.hostname.includes(".")) {
    throw new TargetError("اسم النطاق ناقص. اكتب example.com", "host");
  }
  if (parsed.port && !["80", "443", "8080", "8443"].includes(parsed.port)) {
    throw new TargetError(`المنفذ ${parsed.port} غير مسموح.`, "port");
  }

  parsed.hash = "";
  const normalized = parsed.href;

  return {
    url: normalized,
    host: parsed.hostname.replace(/^www\./, ""),
    secure: parsed.protocol === "https:",
    normalized,
  };
}

/** Human label for the gallery, without a scheme or leading www. */
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
