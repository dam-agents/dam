// TEST_OVERVIEW: the browser panel draws the sandbox browser's frames on a canvas and sends the user's mouse and keys back as agent-browser input events. A click must land on the same page pixel the user pointed at, keys must type and edit like they do locally, and the latency readout must time the round trip from an input to the frame that answers it.
import { describe, expect, test } from "vitest";

import {
  addressUrl,
  createLatencyMeter,
  devicePoint,
  heldButton,
  keyboardInput,
  mouseButton,
  parseBinaryFrame,
  parseStreamMessage,
  viewportFor,
} from "../../modules/browser/lib/stream.js";

const noMods = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe("devicePoint", () => {
  // TEST_SCENARIO: the 1280x720 frame is letterboxed in a 640x480 canvas box — scaled by half, with 60px bars above and below. A click maps back through the scale and the bars, and a click on a bar maps to nothing.
  test("maps through the letterbox", () => {
    const box = { left: 100, top: 50, width: 640, height: 480 };
    const device = { width: 1280, height: 720 };
    expect(devicePoint(100, 110, box, device)).toEqual({ x: 0, y: 0 });
    expect(devicePoint(420, 290, box, device)).toEqual({ x: 640, y: 360 });
    expect(devicePoint(420, 80, box, device)).toBeNull();
  });
});

describe("mouseButton", () => {
  test("names the DOM buttons agent-browser knows", () => {
    expect(mouseButton(0)).toBe("left");
    expect(mouseButton(1)).toBe("middle");
    expect(mouseButton(2)).toBe("right");
    expect(mouseButton(3)).toBe("none");
  });
});

describe("heldButton", () => {
  // TEST_SCENARIO: a move event names no button of its own, only the held ones as a bitmask; a drag must reach the page as a move with its button held, or text selection and drag-and-drop break.
  test("names the held button during a drag", () => {
    expect(heldButton(0)).toBe("none");
    expect(heldButton(1)).toBe("left");
    expect(heldButton(2)).toBe("right");
    expect(heldButton(4)).toBe("middle");
  });
});

describe("addressUrl", () => {
  // TEST_SCENARIO: a user types a dev server the way they would in a browser — `localhost:3000`, which a URL parser reads as the scheme `localhost:`. Anything without `<scheme>://` gets http, so it opens instead of being refused as a non-web address.
  test("adds http to an address without a scheme", () => {
    expect(addressUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(addressUrl(" 127.0.0.1:4444/x ")).toBe("http://127.0.0.1:4444/x");
    expect(addressUrl("example.com")).toBe("http://example.com");
    expect(addressUrl("https://github.com/login")).toBe(
      "https://github.com/login",
    );
    expect(addressUrl("   ")).toBeNull();
  });
});

describe("keyboardInput", () => {
  // TEST_SCENARIO: Chromium inserts a character only when the key-down carries its text, and acts on Backspace or Enter only with the virtual key code. A printable key sends its text, Enter sends a carriage return, Backspace sends its code with no text.
  test("sends text for printable keys and Enter, key codes for all", () => {
    expect(
      keyboardInput("keyDown", {
        key: "a",
        code: "KeyA",
        keyCode: 65,
        ...noMods,
      }),
    ).toMatchObject({ key: "a", text: "a", windowsVirtualKeyCode: 65 });
    expect(
      keyboardInput("keyDown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        ...noMods,
      }),
    ).toMatchObject({ text: "\r", windowsVirtualKeyCode: 13 });
    const backspace = keyboardInput("keyDown", {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      ...noMods,
    });
    expect(backspace).toMatchObject({ windowsVirtualKeyCode: 8 });
    expect(backspace).not.toHaveProperty("text");
  });

  // TEST_SCENARIO: a shortcut such as Ctrl+A must select, not type an "a"; the modifier travels as agent-browser's bitmask (Alt 1, Ctrl 2, Meta 4, Shift 8), and a key-up never carries text.
  test("sends modifiers and no text for shortcuts or key-ups", () => {
    const ctrlA = keyboardInput("keyDown", {
      key: "a",
      code: "KeyA",
      keyCode: 65,
      ...noMods,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(ctrlA).toMatchObject({ modifiers: 10 });
    expect(ctrlA).not.toHaveProperty("text");
    expect(
      keyboardInput("keyUp", {
        key: "a",
        code: "KeyA",
        keyCode: 65,
        ...noMods,
      }),
    ).not.toHaveProperty("text");
  });
});

describe("parseStreamMessage", () => {
  test("reads url updates and errors, and ignores the rest", () => {
    expect(parseStreamMessage('{"type":"url","url":"http://a/"}')).toEqual({
      type: "url",
      url: "http://a/",
    });
    expect(
      parseStreamMessage('{"type":"preview_error","message":"no"}'),
    ).toEqual({ type: "preview_error", message: "no" });
    expect(parseStreamMessage('{"type":"frame","data":"AA"}')).toBeNull();
    expect(parseStreamMessage('{"type":"status"}')).toBeNull();
    expect(parseStreamMessage("{")).toBeNull();
  });
});

describe("createLatencyMeter", () => {
  // TEST_SCENARIO: the readout times input to the next frame on the browser's own clock, so the sandbox clock never skews it. Inputs that change nothing on screen get no frame back; a frame that turns up much later is not counted as their answer.
  test("times input to the next frame, ignoring unanswered input", () => {
    const meter = createLatencyMeter();
    meter.input(1_000);
    meter.input(1_010);
    meter.frame(1_080, 1_024);
    meter.input(2_000);
    meter.frame(2_120, 1_024);
    meter.input(3_000);
    meter.frame(9_000, 1_024);
    expect(meter.stats(9_000).roundTripMs).toBe(120);
    meter.input(10_000);
    meter.frame(10_120.6, 1_024);
    meter.input(11_000);
    meter.frame(11_130.4, 1_024);
    expect(Number.isInteger(meter.stats(12_000).roundTripMs)).toBe(true);
  });

  test("counts frames and their bytes in the last second", () => {
    const meter = createLatencyMeter();
    for (const t of [0, 100, 600, 1_200, 1_300]) meter.frame(t, 2_048);
    expect(meter.stats(1_300).fps).toBe(3);
    expect(meter.stats(1_300).kbPerSec).toBe(6);
    expect(meter.stats(5_000).roundTripMs).toBeNull();
  });
});

describe("parseBinaryFrame", () => {
  // TEST_SCENARIO: the runtime sends each frame as one binary message — a 4-byte header length, a JSON header with the sequence number and viewport size, then the raw JPEG. The panel needs the sequence number to acknowledge the frame and the viewport size to map clicks; a truncated or malformed message is dropped, not drawn.
  test("splits header and JPEG, and rejects malformed messages", async () => {
    const head = new TextEncoder().encode(
      JSON.stringify({
        seq: 4,
        metadata: { deviceWidth: 800, deviceHeight: 600 },
      }),
    );
    const buf = new Uint8Array(4 + head.byteLength + 3);
    new DataView(buf.buffer).setUint32(0, head.byteLength);
    buf.set(head, 4);
    buf.set([0xff, 0xd8, 0xff], 4 + head.byteLength);

    const frame = parseBinaryFrame(buf.buffer)!;
    expect(frame.seq).toBe(4);
    expect(frame.metadata).toEqual({ deviceWidth: 800, deviceHeight: 600 });
    expect([...new Uint8Array(await frame.jpeg.arrayBuffer())]).toEqual([
      0xff, 0xd8, 0xff,
    ]);
    expect(frame.jpeg.type).toBe("image/jpeg");
    expect(parseBinaryFrame(new ArrayBuffer(2))).toBeNull();
    expect(parseBinaryFrame(buf.buffer.slice(0, 6))).toBeNull();
  });
});

describe("viewportFor", () => {
  // TEST_SCENARIO: the sandbox browser's viewport follows the panel's CSS size, so the page lays out at the size the user sees it. It carries no pixel ratio: the user's zoom or screen must not change what the agent's screenshot pixels mean. Fractional sizes round to whole pixels, and a collapsed or huge panel stays within what the runtime accepts.
  test("rounds the panel size and keeps it within bounds", () => {
    expect(viewportFor(812.4, 633.6)).toEqual({ width: 812, height: 634 });
    expect(viewportFor(0, 50)).toEqual({ width: 200, height: 200 });
    expect(viewportFor(9000, 700)).toEqual({ width: 4096, height: 700 });
  });
});
