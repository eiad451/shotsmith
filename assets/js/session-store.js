/**
 * Local persistence: capture history and user preferences.
 *
 * Two storage decisions worth stating:
 *  - History stores a DOWNSCALED jpeg data URL, never the original bytes.
 *    Full-resolution PNGs routinely exceed the ~5 MB localStorage budget after
 *    two or three entries, which would silently break settings too.
 *  - Every write is guarded. A quota failure drops the oldest entry and retries
 *    once; if it still fails the gallery degrades to memory-only rather than
 *    throwing into the capture flow.
 */

const HISTORY_KEY = "shotsmith.history.v1";
const PREFS_KEY = "shotsmith.prefs.v1";
const HISTORY_LIMIT = 24;
const THUMB_WIDTH = 420;

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

class Gallery {
  #entries = [];
  #listeners = new Set();
  #writable = true;

  constructor() {
    const stored = safeParse(localStorage.getItem(HISTORY_KEY), []);
    this.#entries = Array.isArray(stored) ? stored.filter(isValidEntry) : [];
  }

  get entries() {
    return this.#entries;
  }

  get writable() {
    return this.#writable;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener(this.#entries);
  }

  #persist() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.#entries));
      this.#writable = true;
      return true;
    } catch {
      // Evict oldest until it fits; history is a cache, not a ledger.
      while (this.#entries.length > 1) {
        this.#entries.pop();
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(this.#entries));
          this.#writable = true;
          this.#notifyEvicted();
          return true;
        } catch {
          /* keep evicting */
        }
      }
      this.#writable = false;
      return false;
    }
  }

  #notifyEvicted() {
    for (const listener of this.#listeners) listener(this.#entries, { evicted: true });
  }

  add(entry) {
    const record = { id: crypto.randomUUID(), savedAt: Date.now(), ...entry };
    this.#entries = [record, ...this.#entries.filter((e) => e.imageUrl !== record.imageUrl)].slice(
      0,
      HISTORY_LIMIT,
    );
    this.#persist();
    this.#emit();
    return record;
  }

  remove(id) {
    this.#entries = this.#entries.filter((entry) => entry.id !== id);
    this.#persist();
    this.#emit();
  }

  clear() {
    this.#entries = [];
    this.#persist();
    this.#emit();
  }

  find(id) {
    return this.#entries.find((entry) => entry.id === id) ?? null;
  }
}

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.imageUrl === "string" &&
    typeof entry.host === "string"
  );
}

export const gallery = new Gallery();

export const prefs = {
  load() {
    const stored = safeParse(localStorage.getItem(PREFS_KEY), {});
    return { options: {}, annotation: {}, ...stored };
  },
  save(patch) {
    const current = this.load();
    const next = {
      ...current,
      ...patch,
      options: { ...current.options, ...(patch.options ?? {}) },
      annotation: { ...current.annotation, ...(patch.annotation ?? {}) },
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* preferences are nice-to-have; never block a capture on them */
    }
    return next;
  },
  reset() {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      /* ignore */
    }
  },
};

export function estimateGalleryBytes() {
  try {
    return new Blob([localStorage.getItem(HISTORY_KEY) ?? ""]).size;
  } catch {
    return 0;
  }
}
