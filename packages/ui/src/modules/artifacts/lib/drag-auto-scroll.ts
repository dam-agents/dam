const EDGE_BAND_PX = 64;
const MAX_STEP_PX = 18;
const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function edgeScrollStep(pointer: Point, box: Box): number {
  if (pointer.x < box.left || pointer.x > box.right) return 0;
  const band = Math.min(EDGE_BAND_PX, (box.bottom - box.top) / 4);
  if (band <= 0) return 0;
  const intoTop = box.top + band - pointer.y;
  if (intoTop > 0) return -Math.ceil(MAX_STEP_PX * Math.min(1, intoTop / band));
  const intoBottom = pointer.y - (box.bottom - band);
  if (intoBottom > 0)
    return Math.ceil(MAX_STEP_PX * Math.min(1, intoBottom / band));
  return 0;
}

function scrollContainerOf(source: Element): Element {
  for (let el = source.parentElement; el; el = el.parentElement) {
    if (
      el.scrollHeight > el.clientHeight &&
      SCROLLABLE_OVERFLOW.has(getComputedStyle(el).overflowY)
    )
      return el;
  }
  return document.scrollingElement ?? document.documentElement;
}

function visibleBox(container: Element): Box {
  if (container === document.scrollingElement)
    return {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
    };
  return container.getBoundingClientRect();
}

export function startDragAutoScroll(source: Element): () => void {
  const container = scrollContainerOf(source);
  let pointer: Point | null = null;
  let frame = 0;

  const track = (e: DragEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  const leave = (e: DragEvent) => {
    if (e.relatedTarget === null) pointer = null;
  };
  const tick = () => {
    if (pointer) {
      const step = edgeScrollStep(pointer, visibleBox(container));
      if (step !== 0) container.scrollTop += step;
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("dragover", track, true);
    window.removeEventListener("dragleave", leave, true);
    window.removeEventListener("drop", stop, true);
    window.removeEventListener("dragend", stop, true);
  };

  window.addEventListener("dragover", track, true);
  window.addEventListener("dragleave", leave, true);
  window.addEventListener("drop", stop, true);
  window.addEventListener("dragend", stop, true);
  frame = requestAnimationFrame(tick);
  return stop;
}
