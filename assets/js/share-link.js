/**
 * Shareable state in the URL fragment.
 *
 * The hash is used rather than the query string because fragments are never
 * sent to a server or written to access logs, and because changing state must
 * not trigger a navigation. Values are compact JSON -> base64url so a link
 * stays readable and survives copy/paste through chat apps that mangle raw
 * query strings.
 */

const VERSION = 1;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState({ url, options, annotation }) {
  const payload = { v: VERSION, u: url, o: options, a: annotation };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeState(token) {
  try {
    const parsed = JSON.parse(fromBase64Url(token));
    if (!parsed || parsed.v !== VERSION) return null;
    return { url: parsed.u ?? "", options: parsed.o ?? {}, annotation: parsed.a ?? {} };
  } catch {
    return null;
  }
}

export function writeHash(state) {
  const token = encodeState(state);
  history.replaceState(null, "", `#${token}`);
  return token;
}

export function readHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw || raw.length < 8) return null;
  return decodeState(raw);
}

export function shareUrl(state) {
  const token = encodeState(state);
  const { origin, pathname } = location;
  return `${origin}${pathname}#${token}`;
}

export function clearHash() {
  history.replaceState(null, "", location.pathname + location.search);
}
