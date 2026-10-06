import { describe, it, expect } from "vitest";
import {
  captureRegion,
  createAccessUnitSplitter,
  encoderArgs,
  isKeyframe,
  videoAvailable,
  videoFrame,
} from "../../modules/browser-video.js";

// TEST_OVERVIEW: The browser panel's video stream captures the virtual display the shared browser fills with ffmpeg and sends it as H.264. ffmpeg's output is one byte stream; the runtime must cut it into whole frames and mark the keyframes a decoder can start from.

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
  // TEST_SCENARIO: the screen is sized to the panel and the browser fills it, so the encoder captures the whole screen from its corner — no offset to measure. H.264 at 4:2:0 needs even sides.
  it("keeps the region even and captures from the screen's corner", () => {
    expect(captureRegion(901, 701)).toEqual({ width: 900, height: 700 });
    const args = encoderArgs({ width: 900, height: 700 });
    expect(args).toContain("900x700");
    expect(args).toContain(":99.0+0,0");
    expect(args).toContain("libx264");
  });
});

describe("videoAvailable", () => {
  // TEST_SCENARIO: on a fresh boot the virtual display is not running yet — platform-browser starts it when it first launches the browser. Whether an agent can stream is what its image has — Xvnc, ffmpeg and the full Chromium — not whether the display already runs, or the panel would be refused before anything could launch it.
  it("depends on the image's tools, not on a running display", () => {
    expect(videoAvailable(() => true)).toBe(true);
    expect(videoAvailable((p) => p !== "/tmp/.X11-unix/X99")).toBe(true);
    expect(videoAvailable((p) => p !== "/usr/bin/ffmpeg")).toBe(false);
    expect(videoAvailable((p) => p !== "/usr/bin/Xvnc")).toBe(false);
  });
});
