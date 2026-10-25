import {
  ARTIFACT_PICK_CANCEL_TYPE,
  ARTIFACT_PICK_MAX_ELEMENTS,
  ARTIFACT_PICK_SELECTOR_MAX_LENGTH,
  ARTIFACT_PICK_SNIPPET_MAX_LENGTH,
  ARTIFACT_PICK_START_TYPE,
  ARTIFACT_PICK_STOP_TYPE,
  ARTIFACT_PICK_TYPE,
} from "api-server-api";

export const ARTIFACT_PICKER_SHIM_BODY = `
(() => {
  const MAX_ELEMENTS = ${ARTIFACT_PICK_MAX_ELEMENTS};
  const SELECTOR_MAX = ${ARTIFACT_PICK_SELECTOR_MAX_LENGTH};
  const SNIPPET_MAX = ${ARTIFACT_PICK_SNIPPET_MAX_LENGTH};
  const MAX_DEPTH = 6;
  const DRAG_THRESHOLD = 4;
  const MARK = "data-platform-pick";
  let active = false;
  let releasing = false;
  let start = null;
  let dragging = false;
  let layers = [];

  const layer = (tag, css) => {
    const el = document.createElement(tag);
    el.setAttribute(MARK, "");
    if (css) el.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;" + css;
    document.documentElement.append(el);
    layers.push(el);
    return el;
  };
  let hover = null;
  let band = null;
  const place = (el, r) => {
    el.style.display = "block";
    el.style.left = r.left + "px";
    el.style.top = r.top + "px";
    el.style.width = r.width + "px";
    el.style.height = r.height + "px";
  };

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "\\u2026" : s);
  const step = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    const parent = el.parentElement;
    if (!parent) return tag;
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    return same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(el) + 1) + ")" : tag;
  };
  const selectorOf = (el) => {
    const steps = [];
    for (let node = el; node && node !== document.body && node !== document.documentElement && steps.length < MAX_DEPTH; node = node.parentElement) {
      steps.unshift(step(node));
      if (node.id) break;
    }
    while (steps.length > 1 && steps.join(" > ").length > SELECTOR_MAX) steps.shift();
    return clip(steps.join(" > "), SELECTOR_MAX);
  };
  const snippetOf = (el) => {
    const html = el.outerHTML.replace(/\\s+/g, " ").trim();
    if (html.length <= SNIPPET_MAX) return html;
    const open = clip(html.slice(0, html.indexOf(">") + 1), Math.floor(SNIPPET_MAX / 2));
    const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    return clip(text ? open + " " + text : open, SNIPPET_MAX);
  };

  const pickable = (el) => !!el && el !== document.body && el !== document.documentElement && !el.hasAttribute(MARK);
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return pickable(el) ? el : null;
  };
  const inside = (r, b) => r.width > 0 && r.height > 0 && r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
  const within = (b) => {
    const picked = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (picked.length === MAX_ELEMENTS) break;
      if (!pickable(el) || picked.some((p) => p.contains(el))) continue;
      if (inside(el.getBoundingClientRect(), b)) picked.push(el);
    }
    return picked;
  };
  const bandRect = (x, y) => {
    const left = Math.min(start.x, x);
    const top = Math.min(start.y, y);
    return { left, top, right: Math.max(start.x, x), bottom: Math.max(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
  };

  const stop = () => {
    active = false;
    start = null;
    dragging = false;
    for (const el of layers) el.remove();
    layers = [];
  };
  const post = (message) => window.parent.postMessage(message, "*");
  const finish = (elements) => {
    post({ type: ${JSON.stringify(ARTIFACT_PICK_TYPE)}, elements: elements.map((el) => ({ selector: selectorOf(el), snippet: snippetOf(el) })) });
    stop();
    releasing = true;
    setTimeout(() => { releasing = false; }, 0);
  };
  const cancel = () => {
    post({ type: ${JSON.stringify(ARTIFACT_PICK_CANCEL_TYPE)} });
    stop();
  };
  const begin = () => {
    if (active || !document.body) return;
    active = true;
    layer("style").textContent = "* { cursor: crosshair !important; }";
    hover = layer("div", "outline:2px solid #0f62fe;background:rgba(15,98,254,.08);border-radius:2px;");
    band = layer("div", "border:1px dashed #0f62fe;background:rgba(15,98,254,.12);");
  };

  const swallow = (event) => {
    if (!active && !releasing) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };
  window.addEventListener("pointerdown", (event) => {
    if (!swallow(event) || !active || event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    dragging = false;
  }, true);
  window.addEventListener("pointermove", (event) => {
    if (!swallow(event) || !active) return;
    if (start && !dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD) dragging = true;
    if (dragging) {
      hover.style.display = "none";
      place(band, bandRect(event.clientX, event.clientY));
      return;
    }
    const el = at(event.clientX, event.clientY);
    if (el) place(hover, el.getBoundingClientRect());
    else hover.style.display = "none";
  }, true);
  window.addEventListener("pointerup", (event) => {
    if (!swallow(event) || !active || !start) return;
    const rect = dragging ? bandRect(event.clientX, event.clientY) : null;
    const centre = rect ? at(rect.left + rect.width / 2, rect.top + rect.height / 2) : at(event.clientX, event.clientY);
    const elements = rect ? within(rect) : [];
    start = null;
    dragging = false;
    band.style.display = "none";
    if (elements.length > 0) finish(elements);
    else if (centre) finish([centre]);
  }, true);
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart"]) {
    window.addEventListener(type, swallow, { capture: true, passive: false });
  }
  window.addEventListener("keydown", (event) => {
    if (active && event.key === "Escape") {
      swallow(event);
      cancel();
    }
  }, true);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === ${JSON.stringify(ARTIFACT_PICK_START_TYPE)}) begin();
    else if (data.type === ${JSON.stringify(ARTIFACT_PICK_STOP_TYPE)}) stop();
  });
})();
`;

export const ARTIFACT_PICKER_SHIM = `<script>${ARTIFACT_PICKER_SHIM_BODY}</script>`;
