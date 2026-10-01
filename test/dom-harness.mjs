/**
 * Test harness: build a browser-ish environment around index.html, then hand
 * the app module the globals it expects.
 *
 * The DOM comes from linkedom, not jsdom, on purpose: jsdom@22 corrupts the
 * heap on Node 24 once the document reaches a few hundred nodes
 * (`double free or corruption`, SIGABRT, reproducible), which makes it useless
 * for testing a page this size. linkedom is pure JS and stable here.
 *
 * Everything visual is shimmed in one place — dialogs, canvas 2D context, image
 * loading, matchMedia, rAF, fetch, localStorage — and the shims record what they
 * were asked to do so the tests can assert on it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHTML } from "linkedom";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

/** Provider response the capture flow will see (matches microlink's envelope). */
const FIXTURE_META = {
  status: "success",
  data: {
    url: "https://example.com/pricing",
    title: "Pricing — Example",
    description: "Plans and pricing for Example.",
    publisher: "example.com",
    lang: "en",
    image: { url: "https://example.com/og.png" },
    logo: { url: "https://example.com/logo.png" },
  },
  redirects: [
    "https://example.com",
    "https://www.example.com",
    "https://example.com/pricing",
  ],
};

class MemoryStorage {
  #map = new Map();

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  setItem(key, value) {
    this.#map.set(key, String(value));
  }

  removeItem(key) {
    this.#map.delete(key);
  }

  clear() {
    this.#map.clear();
  }
}

export function createEnvironment({ html = readFileSync(resolve(ROOT, "index.html"), "utf8") } = {}) {
  const { document, window } = parseHTML(html);
  window.document = document;
  window.location = new URL("https://shotsmith.test/index.html");

  /* -------------------------------- focus ---------------------------------- */
  // linkedom has no focus model, and "did focus move?" is exactly what the
  // accessibility phase needs to answer. Tracked by hand: focus() sets the
  // active element, and showModal()/close() move focus the way a browser does.
  let activeElement = document.body;
  const elementProto = window.Element?.prototype ?? Object.getPrototypeOf(document.createElement("div"));
  if (typeof elementProto.focus !== "function" || !("_linkedomFocus" in elementProto)) {
    elementProto._linkedomFocus = true;
    elementProto.focus = function focus() {
      activeElement = this;
    };
    elementProto.blur = function blur() {
      if (activeElement === this) activeElement = document.body;
    };
  }
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => activeElement,
  });

  /* ------------------------------- dialogs --------------------------------- */
  const openDialogs = [];
  // Declared before the dialog methods below, which close over it.
  const returnFocus = new WeakMap();
  const proto = window.HTMLDialogElement?.prototype ?? Object.getPrototypeOf(document.createElement("dialog"));
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal() {
      if (this.hasAttribute("open")) return;
      this.setAttribute("open", "");
      openDialogs.push(this);
      returnFocus.set(this, activeElement === document.body ? null : activeElement);
      const first = this.querySelector(
        "[autofocus], button:not([disabled]), input:not([disabled]), select, a[href], [tabindex]:not([tabindex='-1'])"
      );
      if (first) activeElement = first;
    };
    proto.show = function show() {
      this.setAttribute("open", "");
    };
    proto.close = function close() {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      const index = openDialogs.indexOf(this);
      if (index >= 0) openDialogs.splice(index, 1);
      const opener = returnFocus.get(this);
      returnFocus.delete(this);
      if (opener) activeElement = opener;
      this.dispatchEvent(new window.Event("close"));
    };
  }

  // linkedom exposes <select>.value as a getter only. Browsers allow assigning
  // it, and the app does exactly that to pre-select a comparison, so the
  // setter is added here to match the platform.
  const selectProto = window.HTMLSelectElement?.prototype;
  if (selectProto && !Object.getOwnPropertyDescriptor(selectProto, "value")?.set) {
    Object.defineProperty(selectProto, "value", {
      configurable: true,
      get() {
        const selected = this.querySelector("option[selected]");
        if (selected) return selected.getAttribute("value") ?? "";
        return this.querySelector("option")?.getAttribute("value") ?? "";
      },
      set(next) {
        for (const option of this.querySelectorAll("option")) {
          if ((option.getAttribute("value") ?? "") === String(next)) {
            option.setAttribute("selected", "");
          } else {
            option.removeAttribute("selected");
          }
        }
      },
    });
  }

  // A browser closes the topmost modal dialog on Escape and fires "cancel".
  // linkedom has no dialog behaviour at all, so it is emulated here — otherwise
  // every "escape closes the dialog" assertion would be testing the shim.
  if (typeof window.addEventListener === "function") {
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const top = openDialogs.at(-1);
      if (!top) return;
      const cancelled = new window.Event("cancel", { cancelable: true });
      top.dispatchEvent(cancelled);
      if (!cancelled.defaultPrevented) top.close();
    });
  }

  // linkedom's `open` accessor mirrors the attribute; keep a boolean view for
  // readable assertions in the tests.
  Object.defineProperty(proto, "open", {
    configurable: true,
    get() {
      return this.hasAttribute("open");
    },
  });

  /* ---------------------------- canvas 2D context ------------------------- */
  const canvasCalls = { fillRect: 0, drawImage: 0, fillText: [], toBlob: 0, images: [], rectangles: [] };
  const contexts = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== "2d") return null;
    if (contexts.has(this)) return contexts.get(this);
    const canvas = this;
    const ctx = new Proxy(
      {
        canvas,
        measureText: (text) => ({ width: String(text).length * 8, actualBoundingBoxAscent: 8 }),
        fillRect: (...args) => {
          canvasCalls.fillRect += 1;
          canvasCalls.rectangles.push(args.slice(0, 4));
        },
        drawImage: (image, ...rest) => {
          canvasCalls.drawImage += 1;
          canvasCalls.images.push({ width: image?.naturalWidth ?? image?.width, height: image?.naturalHeight ?? image?.height });
          void rest;
        },
        fillText: (text, x, y, max) => {
          canvasCalls.fillText.push({ text, x, y, max, font: ctx.font, fillStyle: ctx.fillStyle });
        },
      },
      {
        // Unknown properties resolve to a no-op function: the real 2D context has
        // dozens of methods and a strict shim would turn "not implemented" into
        // a TypeError that looks like an application bug.
        get: (target, prop) => {
          if (prop in target) return target[prop];
          return () => {};
        },
        set: (target, prop, value) => {
          target[prop] = value;
          return true;
        },
      },
    );
    contexts.set(this, ctx);
    return ctx;
  };
  window.HTMLCanvasElement.prototype.toDataURL = function toDataURL(type = "image/jpeg") {
    const prefix = type.includes("png") ? "iVBORw0KGgo" : "/9j/4AAQSkZJRgABAQAAAQABAAD";
    return `data:${type};base64,${prefix}`;
  };
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type = "image/png") {
    canvasCalls.toBlob += 1;
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type }));
  };

  /* --------------------------- image loading ------------------------------- */
  const imageRequests = [];
  class FakeImage {
    constructor() {
      this.naturalWidth = 1280;
      this.naturalHeight = 720;
      this.crossOrigin = null;
      this.referrerPolicy = "";
      this.decoding = "auto";
    }

    get src() {
      return this.__src ?? "";
    }

    set src(value) {
      this.__src = value;
      imageRequests.push(value);
      queueMicrotask(() => {
        if (this.onload) this.onload({ type: "load" });
      });
    }

    decode() {
      return Promise.resolve();
    }
  }

  /* ------------------------------ media query ------------------------------ */
  const mediaListeners = new Set();
  let prefersDark = false;
  const matchMedia = (query) => ({
    media: query,
    get matches() {
      return /dark/.test(query) ? prefersDark : false;
    },
    addEventListener: (_type, fn) => mediaListeners.add(fn),
    removeEventListener: (_type, fn) => mediaListeners.delete(fn),
    addListener: (fn) => mediaListeners.add(fn),
    removeListener: (fn) => mediaListeners.delete(fn),
    dispatchEvent: () => true,
  });

  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.queueMicrotask = queueMicrotask;

  /* --------------------------------- fetch --------------------------------- */
  const fetches = [];
  const fetchStub = async (url, init) => {
    fetches.push({ url: String(url), init });
    if (String(url).includes("image.thum.io")) {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (String(url).includes("api.microlink.io")) {
      return new Response(JSON.stringify(FIXTURE_META), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-rate-limit-remaining": "22",
          "x-rate-limit-limit": "50",
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  /* --------------------------- install the globals -------------------------
     Only what Node does not already provide globally. Node ships Event,
     CustomEvent, Blob, Response and DOMException itself, and mixing realms for
     those is unnecessary. */
  const storage = new MemoryStorage();
  // linkedom ships no KeyboardEvent; every browser has one and the app binds
  // real key handlers, so the shim carries the fields the app reads.
  if (typeof window.KeyboardEvent !== "function") {
    class KeyboardEventShim extends window.Event {
      constructor(type, init = {}) {
        super(type, init);
        this.key = init.key ?? "";
        this.code = init.code ?? "";
        this.ctrlKey = Boolean(init.ctrlKey);
        this.metaKey = Boolean(init.metaKey);
        this.shiftKey = Boolean(init.shiftKey);
        this.altKey = Boolean(init.altKey);
        this.repeat = Boolean(init.repeat);
      }
    }
    window.KeyboardEvent = KeyboardEventShim;
  }

  const globals = {
    window,
    document,
    navigator: { share: undefined, clipboard: undefined },
    location: window.location,
    history: { replaceState: (_state, _title, url) => setLocationHash(url) },
    localStorage: storage,
    Image: FakeImage,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    matchMedia,
    fetch: fetchStub,
  };

  function setLocationHash(url) {
    const hash = String(url).startsWith("#") ? String(url) : new URL(String(url), window.location).hash;
    window.location.hash = hash;
  }
  Object.defineProperty(window.location, "hash", {
    configurable: true,
    get() {
      return this._hash ?? "";
    },
    set(value) {
      this._hash = value;
    },
  });

  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }

  return {
    document,
    window,
    storage,
    canvasCalls,
    imageRequests,
    fetches,
    openDialogs,
    setPrefersDark(value) {
      prefersDark = value;
      for (const fn of mediaListeners) fn({ matches: value });
    },
    teardown() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

/** Let the microtask queue and pending 0ms timers drain. */
export async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}