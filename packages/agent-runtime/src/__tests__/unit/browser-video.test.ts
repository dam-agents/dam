import { describe, it, expect } from "vitest";
import {
  bestContentTop,
  captureRegion,
  createAccessUnitSplitter,
  encoderArgs,
  isKeyframe,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  videoFrame,
} from "../../modules/browser-video.js";

// TEST_OVERVIEW: The browser panel's video stream captures the shared browser's screen on the virtual display with ffmpeg and sends it as H.264. ffmpeg's output is one byte stream; the runtime must cut it into whole frames, mark the keyframes a decoder can start from, and capture exactly the page's region of the screen — below whatever Chrome draws above it, and within the screen.

const nal = (type: number, body: number[] = [0xaa, 0xbb]) => [
  0,
  0,
  0,
  1,
  type,
  ...body,
];

describe("createAccessUnitSplitter", () => {
  // TEST_SCENARIO: x264 starts every frame with an access-unit delimiter. Frames arrive split and joined arbitrarily across reads; each delimiter ends the frame before it, and a flush emits the last one, so a still page's final frame is sent without waiting for another.
  it("cuts the stream at access-unit delimiters and flushes the last frame", () => {
    const frames: number[][] = [];
    const splitter = createAccessUnitSplitter((au) => frames.push([...au]));
    const a = [...nal(9, [0xf0]), ...nal(5)];
    const b = [...nal(9, [0xf0]), ...nal(1)];
    const stream = Buffer.from([...a, ...b]);
    splitter.push(stream.subarray(0, 7));
    splitter.push(stream.subarray(7, a.length + 3));
    expect(frames).toEqual([]);
    splitter.push(stream.subarray(a.length + 3));
    expect(frames).toEqual([a]);
    splitter.flush();
    expect(frames).toEqual([a, b]);
    splitter.flush();
    expect(frames).toHaveLength(2);
  });
});

describe("isKeyframe", () => {
  it("finds an IDR slice and nothing else", () => {
    expect(isKeyframe(Buffer.from([...nal(9), ...nal(7), ...nal(5)]))).toBe(
      true,
    );
    expect(isKeyframe(Buffer.from([...nal(9), ...nal(1)]))).toBe(false);
  });
});

describe("videoFrame", () => {
  // TEST_SCENARIO: a video frame travels in the same envelope as a JPEG frame — a 4-byte header length, a JSON header, then the payload — so the relay passes it unchanged and the panel tells the two apart by the header's codec.
  it("wraps an access unit with its codec, sequence, keyframe flag and viewport", () => {
    const packed = videoFrame(3, true, 900, 700, Buffer.from([1, 2, 3]));
    const len = packed.readUInt32BE(0);
    expect(JSON.parse(packed.subarray(4, 4 + len).toString())).toEqual({
      codec: "h264",
      seq: 3,
      key: true,
      metadata: { deviceWidth: 900, deviceHeight: 700 },
    });
    expect([...packed.subarray(4 + len)]).toEqual([1, 2, 3]);
  });
});

describe("captureRegion", () => {
  // TEST_SCENARIO: H.264 at 4:2:0 needs even sides, and the region must stay on the virtual screen even for a panel larger than it.
  it("keeps the region even and on the screen", () => {
    expect(captureRegion(901, 701, 56)).toEqual({
      width: 900,
      height: 700,
      top: 56,
    });
    expect(captureRegion(4096, 4096, 56)).toEqual({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT - 56,
      top: 56,
    });
  });

  it("captures the region below the top offset on the display", () => {
    const args = encoderArgs({ width: 900, height: 700, top: 56 });
    expect(args).toContain("900x700");
    expect(args).toContain(":99.0+0,56");
    expect(args).toContain("libx264");
  });
});

describe("bestContentTop", () => {
  const width = 40;
  const pattern = (y: number, x: number) => (y * 7 + x * 3) % 251;

  // TEST_SCENARIO: the page's screenshot matches the screen capture at exactly one vertical offset — the height of whatever Chrome draws above the page. A page too uniform to match anywhere gives no answer, so the caller falls back to the known offset.
  it("finds the offset where the page's screenshot matches the screen", () => {
    const shotHeight = 60;
    const shot = new Uint8Array(width * shotHeight);
    for (let y = 0; y < shotHeight; y++)
      for (let x = 0; x < width; x++) shot[y * width + x] = pattern(y, x);
    const top = 37;
    const screenHeight = shotHeight + 160;
    const screen = new Uint8Array(width * screenHeight).fill(255);
    for (let y = 0; y < shotHeight; y++)
      for (let x = 0; x < width; x++)
        screen[(top + y) * width + x] = pattern(y, x);
    expect(bestContentTop(screen, width, shot, width, shotHeight)).toBe(top);

    const blank = new Uint8Array(width * shotHeight).fill(255);
    const blankScreen = new Uint8Array(width * screenHeight).fill(255);
    expect(
      bestContentTop(blankScreen, width, blank, width, shotHeight),
    ).toBeNull();
  });
});
