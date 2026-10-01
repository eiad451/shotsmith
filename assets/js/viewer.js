/**
 * Image viewing: a zoomable/panable lightbox and a drag-to-compare slider.
 *
 * Both are transform-based rather than layout-based so a 4000px tall full-page
 * capture stays at 60fps on a phone. Pointer Events cover mouse, touch and pen
 * with one code path, including two-finger pinch.
 */

import { $, el, icon, $$ } from "./dom.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;

export class Lightbox {
  #dialog;
  #stage;
  #img;
  #hud;
  #state = { scale: 1, x: 0, y: 0, fitted: true };
  #panOrigin = null;
  #captionNode;
  #onKeyDown;

  constructor(dialog) {
    this.#dialog = dialog;
    this.#stage = $(".viewer-canvas", dialog);
    this.#img = $("[data-role='viewer-image']", dialog);
    this.#hud = $("[data-role='viewer-zoom']", dialog);
    this.#captionNode = $("[data-role='viewer-caption']", dialog);
    this.#bindPanZoom();
    this.#bindKeys();
  }

  get currentScale() {
    return this.#state.scale;
  }

  #bindPanZoom() {
    const pointers = new Map();
    let pinchStart = null;

    const apply = () => {
      const { scale, x, y } = this.#state;
      this.#img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      if (this.#hud) this.#hud.textContent = `${Math.round(scale * 100)}%`;
    };

    this.fit = () => {
      const box = this.#stage.getBoundingClientRect();
      const natural = { w: this.#img.naturalWidth || 1, h: this.#img.naturalHeight || 1 };
      const scale = Math.min(box.width / natural.w, box.height / natural.h, 1);
      this.#state = {
        scale,
        x: (box.width - natural.w * scale) / 2,
        y: (box.height - natural.h * scale) / 2,
        fitted: true,
      };
      apply();
    };

    this.zoomTo = (scale, anchorX, anchorY) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
      const factor = next / this.#state.scale;
      const box = this.#stage.getBoundingClientRect();
      const px = anchorX ?? box.width / 2;
      const py = anchorY ?? box.height / 2;
      this.#state.x = px - (px - this.#state.x) * factor;
      this.#state.y = py - (py - this.#state.y) * factor;
      this.#state.scale = next;
      this.#state.fitted = false;
      apply();
    };

    this.#stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const box = this.#stage.getBoundingClientRect();
        this.zoomTo(
          this.#state.scale * Math.exp(-event.deltaY * 0.0016),
          event.clientX - box.left,
          event.clientY - box.top,
        );
      },
      { passive: false },
    );

    this.#stage.addEventListener("pointerdown", (event) => {
      this.#stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        this.#panOrigin = { x: event.clientX - this.#state.x, y: event.clientY - this.#state.y };
        this.#stage.dataset.panning = "true";
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: this.#state.scale };
      }
    });

    this.#stage.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.distance > 0) this.zoomTo((pinchStart.scale * distance) / pinchStart.distance);
        return;
      }
      if (pointers.size === 1 && this.#panOrigin) {
        this.#state.x = event.clientX - this.#panOrigin.x;
        this.#state.y = event.clientY - this.#panOrigin.y;
        this.#state.fitted = false;
        apply();
      }
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        this.#panOrigin = null;
        this.#stage.dataset.panning = "false";
      }
    };
    this.#stage.addEventListener("pointerup", release);
    this.#stage.addEventListener("pointercancel", release);

    this.#stage.addEventListener("dblclick", (event) => {
      const box = this.#stage.getBoundingClientRect();
      if (this.#state.scale > 1.05) {
        this.fit();
      } else {
        this.zoomTo(2.5, event.clientX - box.left, event.clientY - box.top);
      }
    });

    this.apply = apply;
  }

  #bindKeys() {
    this.#onKeyDown = (event) => {
      if (!this.#dialog.open) return;
      if (event.key === "Escape") return;
      const step = event.shiftKey ? 120 : 40;
      if (event.key === "+" || event.key === "=") this.zoomTo(this.#state.scale * 1.25);
      else if (event.key === "-" || event.key === "_") this.zoomTo(this.#state.scale / 1.25);
      else if (event.key === "0") this.fit();
      else if (event.key === "ArrowRight") this.#state.x -= step;
      else if (event.key === "ArrowLeft") this.#state.x += step;
      else if (event.key === "ArrowUp") this.#state.y -= step;
      else if (event.key === "ArrowDown") this.#state.y += step;
      else return;
      event.preventDefault();
      this.apply();
    };
    document.addEventListener("keydown", this.#onKeyDown);
  }

  open({ url, caption, width, height }) {
    this.#img.src = url;
    this.#img.alt = caption ? `لقطة شاشة لـ ${caption}` : "لقطة شاشة";
    if (this.#captionNode) this.#captionNode.textContent = caption ?? "";
    const sizeNode = $("[data-role='viewer-size']", this.#dialog);
    if (sizeNode && width && height) {
      sizeNode.textContent = `${width}×${height}px`;
    }
    this.#dialog.showModal();
    this.#img.decode?.().catch(() => {}).finally(() => this.fit());
    this.fit();
  }

  close() {
    this.#dialog.close();
  }
}

/**
 * Drag-to-compare. The two panes must describe the same scene at the same
 * intrinsic width, otherwise the seam slides while dragging and the comparison
 * lies about what changed.
 */
export function mountCompare(node, { before, after, labelA, labelB, empty = false }) {
  if (empty) {
    node.replaceChildren(
      el("div", { class: "compare__empty" }, [
        icon("compare_arrows", { size: 26 }),
        el("p", { text: "اختر لقطة مقابلة من مكتبتك عشان تقارن." }),
      ]),
    );
    node.dataset.empty = "true";
    return node;
  }
  node.dataset.empty = "false";

  const bottom = el("img", { src: before, alt: labelA || "قبل" });
  const top = el("img", { src: after, alt: labelB || "بعد" });
  const topWrap = el("div", { class: "compare__top" }, [top]);
  const grip = el("div", { class: "compare__grip" }, [icon("unfold_more", { size: 22 })]);

  node.replaceChildren(
    el("div", { class: "compare__label compare__label--a", text: labelA ?? "قبل" }),
    el("div", { class: "compare__label compare__label--b", text: labelB ?? "بعد" }),
    bottom,
    topWrap,
    el("div", { class: "compare__handle" }, [grip]),
  );

  const handle = node.querySelector(".compare__handle");
  const setSplit = (ratio) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    topWrap.style.width = `${clamped * 100}%`;
    handle.style.insetInlineStart = `${clamped * 100}%`;
  };
  setSplit(0.5);

  // Wire the drag once per node: the pane contents are rebuilt on every
  // selection change, and re-binding on each rebuild would stack duplicate
  // pointer listeners that fight over the seam.
  if (node.dataset.compareWired !== "true") {
    node.dataset.compareWired = "true";
    let dragging = false;

    const move = (clientX) => {
      const box = node.getBoundingClientRect();
      if (!box.width) return;
      // getBoundingClientRect is LTR-relative, so measure from the physical left.
      setSplit((clientX - box.left) / box.width);
    };

    node.addEventListener("pointerdown", (event) => {
      if (node.dataset.empty === "true") return;
      dragging = true;
      node.setPointerCapture(event.pointerId);
      move(event.clientX);
    });
    node.addEventListener("pointermove", (event) => {
      if (dragging) move(event.clientX);
    });
    const stop = (event) => {
      dragging = false;
      if (event.pointerId != null && node.hasPointerCapture?.(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }
    };
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
    node.addEventListener("dblclick", () => setSplit(0.5));
  }

  // The clipped pane must be as wide as the unclipped one or the seam drifts.
  const alignWidth = () => {
    if (bottom.clientWidth) top.style.width = `${bottom.clientWidth}px`;
  };
  top.addEventListener("load", alignWidth, { once: true });
  requestAnimationFrame(alignWidth);

  node.setSplit = setSplit;
  return node;
}

export function wireZoomControls(scope, lightbox) {
  const handlers = {
    "[data-action='zoom-in']": () => lightbox.zoomTo(lightbox.currentScale * 1.4),
    "[data-action='zoom-out']": () => lightbox.zoomTo(lightbox.currentScale / 1.4),
    "[data-action='zoom-fit']": () => lightbox.fit(),
  };
  for (const [selector, run] of Object.entries(handlers)) {
    for (const button of $$(selector, scope)) {
      button.addEventListener("click", run);
    }
  }
}
