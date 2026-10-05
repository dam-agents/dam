export interface FrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
}

export type StreamMessage =
  | { type: "frame"; seq: number; data: string; metadata: FrameMetadata }
  | { type: "url"; url: string }
  | { type: "preview_error"; message: string };

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MOUSE_BUTTONS = ["left", "middle", "right"] as const;
export type MouseButton = (typeof MOUSE_BUTTONS)[number] | "none";

const ALT = 1;
const CTRL = 2;
const META = 4;
const SHIFT = 8;

export function parseStreamMessage(raw: string): StreamMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "frame" && typeof m.data === "string") {
    const meta = m.metadata as Partial<FrameMetadata> | undefined;
    if (
      typeof meta?.deviceWidth !== "number" ||
      typeof meta.deviceHeight !== "number"
    )
      return null;
    return {
      type: "frame",
      seq: typeof m.seq === "number" ? m.seq : 0,
      data: m.data,
      metadata: {
        deviceWidth: meta.deviceWidth,
        deviceHeight: meta.deviceHeight,
      },
    };
  }
  if (m.type === "url" && typeof m.url === "string")
    return { type: "url", url: m.url };
  if (m.type === "preview_error" && typeof m.message === "string")
    return { type: "preview_error", message: m.message };
  return null;
}

export function devicePoint(
  clientX: number,
  clientY: number,
  box: Box,
  device: { width: number; height: number },
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / device.width, box.height / device.height);
  const offsetX = (box.width - device.width * scale) / 2;
  const offsetY = (box.height - device.height * scale) / 2;
  const x = (clientX - box.left - offsetX) / scale;
  const y = (clientY - box.top - offsetY) / scale;
  if (x < 0 || y < 0 || x > device.width || y > device.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

export function mouseButton(button: number): MouseButton {
  return MOUSE_BUTTONS[button] ?? "none";
}

export function heldButton(buttons: number): MouseButton {
  if (buttons & 1) return "left";
  if (buttons & 2) return "right";
  if (buttons & 4) return "middle";
  return "none";
}

export function modifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (e.altKey ? ALT : 0) |
    (e.ctrlKey ? CTRL : 0) |
    (e.metaKey ? META : 0) |
    (e.shiftKey ? SHIFT : 0)
  );
}

export function keyboardInput(
  eventType: "keyDown" | "keyUp",
  e: {
    key: string;
    code: string;
    keyCode: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
) {
  const text =
    eventType !== "keyDown" || e.ctrlKey || e.metaKey
      ? null
      : e.key === "Enter"
        ? "\r"
        : e.key.length === 1
          ? e.key
          : null;
  return {
    type: "input_keyboard",
    eventType,
    key: e.key,
    code: e.code,
    windowsVirtualKeyCode: e.keyCode,
    modifiers: modifiers(e),
    ...(text !== null ? { text } : {}),
  };
}

export const FOCUS_RELEASE_KEY = "F6";

const SAMPLE_WINDOW = 20;
const UNANSWERED_INPUT_MS = 2_000;

export interface LatencyMeter {
  input(now: number): void;
  frame(now: number): void;
  stats(now: number): { roundTripMs: number | null; fps: number };
}

export function createLatencyMeter(): LatencyMeter {
  let pendingInputAt: number | null = null;
  const roundTrips: number[] = [];
  const frameTimes: number[] = [];
  return {
    input(now) {
      pendingInputAt ??= now;
    },
    frame(now) {
      frameTimes.push(now);
      while (frameTimes.length > 0 && now - frameTimes[0]! > 1_000)
        frameTimes.shift();
      if (pendingInputAt === null) return;
      const roundTrip = now - pendingInputAt;
      pendingInputAt = null;
      if (roundTrip > UNANSWERED_INPUT_MS) return;
      roundTrips.push(roundTrip);
      if (roundTrips.length > SAMPLE_WINDOW) roundTrips.shift();
    },
    stats(now) {
      const sorted = [...roundTrips].sort((a, b) => a - b);
      return {
        roundTripMs:
          sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : null,
        fps: frameTimes.filter((t) => now - t <= 1_000).length,
      };
    },
  };
}

export function jpegBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export function addressUrl(raw: string): string | null {
  const address = raw.trim();
  if (!address) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(address)
    ? address
    : `http://${address}`;
}

const VIEWPORT_MIN = 200;
const VIEWPORT_MAX = 4096;

export function viewportFor(
  width: number,
  height: number,
): { width: number; height: number } {
  const side = (v: number) =>
    Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, Math.round(v)));
  return { width: side(width), height: side(height) };
}
