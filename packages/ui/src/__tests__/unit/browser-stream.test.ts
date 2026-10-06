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
  viewportDiffers,
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
  const envelope = (head: object, payload: number[]) => {
    const h = new TextEncoder().encode(JSON.stringify(head));
    const buf = new Uint8Array(4 + h.byteLength + payload.length);
    new DataView(buf.buffer).setUint32(0, h.byteLength);
    buf.set(h, 4);
    buf.set(payload, 4 + h.byteLength);
    return buf.buffer;
  };

  // TEST_SCENARIO: the runtime sends each video frame as one binary message — a 4-byte header length, a JSON header naming the codec, the sequence number, whether it is a keyframe and the viewport size, then the H.264 access unit. The decoder can only start, or restart after a resize, at a keyframe, and the viewport size maps clicks.
  test("reads an H.264 frame and its keyframe flag", () => {
    const frame = parseBinaryFrame(
      envelope(
        {
          codec: "h264",
          seq: 9,
          key: true,
          metadata: { deviceWidth: 900, deviceHeight: 700 },
        },
        [0, 0, 0, 1],
      ),
    )!;
    expect(frame).toMatchObject({
      seq: 9,
      key: true,
      metadata: { deviceWidth: 900, deviceHeight: 700 },
    });
    expect([...frame.data]).toEqual([0, 0, 0, 1]);
  });

  // TEST_SCENARIO: video is the only stream; anything else in the envelope — an old JPEG frame, a truncated or malformed message — is dropped, not drawn.
  test("drops anything that is not a whole H.264 frame", () => {
    expect(
      parseBinaryFrame(
        envelope(
          { seq: 4, metadata: { deviceWidth: 800, deviceHeight: 600 } },
          [0xff, 0xd8, 0xff],
        ),
      ),
    ).toBeNull();
    expect(parseBinaryFrame(new ArrayBuffer(2))).toBeNull();
    expect(
      parseBinaryFrame(
        envelope({ codec: "h264", seq: 1 }, [0, 0, 0, 1]).slice(0, 6),
      ),
    ).toBeNull();
  });
});

describe("stream info", () => {
  // TEST_SCENARIO: when video starts, the runtime says what it streams, so the panel can show the codec and capture size next to the frame rate.
  test("reads the codec and capture size", () => {
    expect(
      parseStreamMessage(
        '{"type":"stream_info","codec":"h264","width":570,"height":800,"scale":1,"fps":30}',
      ),
    ).toEqual({
      type: "stream_info",
      codec: "h264",
      width: 570,
      height: 800,
      scale: 1,
      fps: 30,
    });
    expect(
      parseStreamMessage('{"type":"stream_info","codec":"h264"}'),
    ).toBeNull();
  });
});

describe("viewportFor", () => {
  // TEST_SCENARIO: the sandbox browser's viewport follows the panel's CSS size, so the page lays out at the size the user sees it, and renders at the screen's pixel ratio, rounded to a quarter and capped — at 1 for now, since a sandbox with one CPU cannot capture and encode four times the pixels at 30 frames a second. Fractional sizes round to whole pixels, and a collapsed or huge panel stays within what the runtime accepts.
  test("rounds the panel size, carries the pixel ratio, and keeps both within bounds", () => {
    expect(viewportFor(812.4, 633.6, 1)).toEqual({
      width: 812,
      height: 634,
      scale: 1,
    });
    expect(viewportFor(0, 50, 1.1)).toEqual({
      width: 200,
      height: 200,
      scale: 1,
    });
    expect(viewportFor(9000, 700, 3)).toEqual({
      width: 4096,
      height: 700,
      scale: 1,
    });
  });
});

describe("viewportDiffers", () => {
  // TEST_SCENARIO: a browser launched before the panel connected, or by the agent afterwards, starts at agent-browser's default 1280x720. Every frame says its viewport size, so the panel notices the mismatch and sends its own size again; a one-pixel rounding difference is not a mismatch.
  test("spots a viewport that does not match the panel", () => {
    expect(
      viewportDiffers(
        { deviceWidth: 1280, deviceHeight: 720 },
        { width: 560, height: 1063 },
      ),
    ).toBe(true);
    expect(
      viewportDiffers(
        { deviceWidth: 560, deviceHeight: 1063 },
        { width: 561, height: 1063 },
      ),
    ).toBe(false);
  });
});
