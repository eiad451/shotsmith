/**
 * Command palette (Ctrl/Cmd+K) plus global shortcuts.
 *
 * Shortcuts are suppressed while the user is typing, and `?` only opens the
 * help sheet when no modifier is held, so browser find and devtools shortcuts
 * keep working.
 */

import { $, el, icon } from "./dom.js";

export class CommandPalette {
  #dialog;
  #input;
  #list;
  #commands = [];
  #activeIndex = 0;
  #filtered = [];

  constructor(dialog) {
    this.#dialog = dialog;
    this.#input = $(".palette__input input", dialog);
    this.#list = $(".palette__list", dialog);

    this.#input.addEventListener("input", () => this.#render());
    this.#input.addEventListener("keydown", (event) => this.#onKey(event));
    dialog.addEventListener("close", () => {
      this.#input.value = "";
      this.#filtered = [];
    });
  }

  register(commands) {
    this.#commands = commands.filter((command) => command && command.label);
    return this;
  }

  open() {
    this.#input.value = "";
    this.#activeIndex = 0;
    this.#render();
    this.#dialog.showModal();
    this.#input.focus();
  }

  close() {
    this.#dialog.close();
  }

  get isOpen() {
    return this.#dialog.open;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  #render() {
    const query = this.#input.value.trim().toLowerCase();
    this.#filtered = this.#commands
      .map((command) => ({ command, haystack: `${command.label} ${command.keywords ?? ""}`.toLowerCase() }))
      .filter(({ haystack }) => !query || haystack.includes(query));

    this.#list.replaceChildren();
    if (!this.#filtered.length) {
      this.#list.append(el("li", { class: "palette__empty", text: "مفيش أمر مطابق." }));
      return;
    }

    this.#activeIndex = Math.min(this.#activeIndex, this.#filtered.length - 1);
    this.#filtered.forEach(({ command }, index) => {
      const row = el(
        "li",
        {},
        [
          el(
            "button",
            {
              class: "palette__item",
              type: "button",
              dataset: { active: String(index === this.#activeIndex) },
              onclick: () => {
                this.close();
                command.run();
              },
            },
            [
              icon(command.icon ?? "bolt", { size: 20 }),
              el("span", { text: command.label }),
              command.shortcut ? el("small", { text: command.shortcut }) : null,
            ],
          ),
        ],
      );
      row.firstChild.addEventListener("pointerenter", () => {
        this.#activeIndex = index;
        this.#render();
      });
      this.#list.append(row);
    });
  }

  #onKey(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.#activeIndex = (this.#activeIndex + 1) % Math.max(1, this.#filtered.length);
      this.#render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.#activeIndex =
        (this.#activeIndex - 1 + this.#filtered.length) % Math.max(1, this.#filtered.length);
      this.#render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = this.#filtered[this.#activeIndex]?.command;
      if (chosen) {
        this.close();
        chosen.run();
      }
    }
  }
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target) {
  return TYPING_TAGS.has(target?.tagName) || target?.isContentEditable;
}

/**
 * @param {Record<string, () => void>} bindings single-key bindings, lowercase
 */
export function bindShortcuts(bindings) {
  document.addEventListener("keydown", (event) => {
    const combo = `${event.ctrlKey || event.metaKey ? "mod+" : ""}${event.key.toLowerCase()}`;
    const run = bindings[combo];
    if (!run) return;
    if (!combo.startsWith("mod+") && isTyping(event.target)) return;
    event.preventDefault();
    run();
  });
}
