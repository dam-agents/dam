// TEST_OVERVIEW: the browser panel draws the sandbox browser's frames on a canvas and sends the user's mouse and keys back as agent-browser input events. A click must land on the same page pixel the user pointed at, keys must type and edit like they do locally, and the latency readout must time the round trip from an input to the frame that answers it.
import { describe, expect, test } from "vitest";

import {
  createLatencyMeter,
  devicePoint,
  jpegBytes,
  keyboardInput,
  mouseButton,
  parseStreamMessage,
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
  test("reads frames, url updates and errors, and ignores the rest", () => {
    expect(
      parseStreamMessage(
        JSON.stringify({
          type: "frame",
          seq: 3,
          data: "AA",
          metadata: { deviceWidth: 10, deviceHeight: 5, timestamp: 1 },
        }),
      ),
    ).toEqual({
      type: "frame",
      seq: 3,
      data: "AA",
      metadata: { deviceWidth: 10, deviceHeight: 5 },
    });
    expect(parseStreamMessage('{"type":"url","url":"http://a/"}')).toEqual({
      type: "url",
      url: "http://a/",
    });
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
    meter.frame(1_080);
    meter.input(2_000);
    meter.frame(2_120);
    meter.input(3_000);
    meter.frame(9_000);
    expect(meter.stats(9_000).roundTripMs).toBe(120);
  });

  test("counts frames in the last second", () => {
    const meter = createLatencyMeter();
    for (const t of [0, 100, 600, 1_200, 1_300]) meter.frame(t);
    expect(meter.stats(1_300).fps).toBe(3);
    expect(meter.stats(5_000).roundTripMs).toBeNull();
  });
});

describe("jpegBytes", () => {
  test("decodes a frame's base64 payload to its bytes", () => {
    expect([...jpegBytes("/9j/")]).toEqual([0xff, 0xd8, 0xff]);
  });
});
