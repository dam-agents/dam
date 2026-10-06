import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const VIDEO_DISPLAY = ":99";
export const VIDEO_X_SOCKET = "/tmp/.X11-unix/X99";
export const SCREEN_WIDTH = 3840;
export const SCREEN_HEIGHT = 2400;
export const DEFAULT_CONTENT_TOP = 56;
export const VIDEO_FPS = 15;

const AUD = Buffer.from([0, 0, 0, 1, 9]);
const IDR_NAL = 5;
const FLUSH_AFTER_MS = 4;
const CALIBRATION_SEARCH = 160;
const CALIBRATION_ROWS = 48;

export function videoAvailable(): boolean {
  return existsSync(VIDEO_X_SOCKET) && existsSync("/usr/bin/ffmpeg");
}

export function createAccessUnitSplitter(onAccessUnit: (au: Buffer) => void): {
  push(chunk: Buffer): void;
  flush(): void;
} {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      let i: number;
      while ((i = buf.indexOf(AUD, 1)) > 0) {
        onAccessUnit(buf.subarray(0, i));
        buf = buf.subarray(i);
      }
    },
    flush() {
      if (buf.length === 0) return;
      onAccessUnit(buf);
      buf = Buffer.alloc(0);
    },
  };
}

export function isKeyframe(au: Buffer): boolean {
  for (let i = 0; i + 3 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) {
      if ((au[i + 3]! & 0x1f) === IDR_NAL) return true;
      i += 2;
    }
  }
  return false;
}

export function videoFrame(
  seq: number,
  key: boolean,
  width: number,
  height: number,
  au: Buffer,
): Buffer {
  const head = Buffer.from(
    JSON.stringify({
      codec: "h264",
      seq,
      key,
      metadata: { deviceWidth: width, deviceHeight: height },
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(head.byteLength);
  return Buffer.concat([length, head, au]);
}

export function captureRegion(
  width: number,
  height: number,
  top: number,
): { width: number; height: number; top: number } {
  const even = (v: number) => Math.max(2, v - (v % 2));
  return {
    width: even(Math.min(width, SCREEN_WIDTH)),
    height: even(Math.min(height, SCREEN_HEIGHT - top)),
    top,
  };
}

export function encoderArgs(region: {
  width: number;
  height: number;
  top: number;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-framerate",
    String(VIDEO_FPS),
    "-video_size",
    `${region.width}x${region.height}`,
    "-draw_mouse",
    "0",
    "-i",
    `${VIDEO_DISPLAY}.0+0,${region.top}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-crf",
    "30",
    "-profile:v",
    "baseline",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "600",
    "-bf",
    "0",
    "-x264-params",
    "aud=1:repeat-headers=1",
    "-flush_packets",
    "1",
    "-f",
    "h264",
    "-",
  ];
}

export function bestContentTop(
  screen: Uint8Array,
  screenWidth: number,
  shot: Uint8Array,
  shotWidth: number,
  shotHeight: number,
): number | null {
  const rows = Math.min(CALIBRATION_ROWS, shotHeight);
  const cols = Math.floor(shotWidth * 0.8);
  const screenRows = Math.floor(screen.length / screenWidth);
  const scores: number[] = [];
  for (let top = 0; top <= CALIBRATION_SEARCH; top++) {
    if (top + rows > screenRows) break;
    let sad = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x += 4)
        sad += Math.abs(
          screen[(top + y) * screenWidth + x]! - shot[y * shotWidth + x]!,
        );
    scores.push(sad);
  }
  if (scores.length === 0) return null;
  const best = scores.indexOf(Math.min(...scores));
  const rival = Math.min(
    ...scores.filter((_, top) => Math.abs(top - best) > 2),
  );
  return scores[best]! * 1.5 < rival ? best : null;
}

const grayFrame = (args: string[]) =>
  new Promise<Buffer>((resolve, reject) =>
    execFile(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...args,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 15_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    ),
  );

export async function calibrateTop(
  screenshot: (path: string) => Promise<unknown>,
  width: number,
  height: number,
): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "browser-video-"));
  try {
    const path = join(dir, "viewport.png");
    await screenshot(path);
    const shot = await grayFrame(["-i", path]);
    const screenWidth = Math.min(width, SCREEN_WIDTH);
    const screen = await grayFrame([
      "-f",
      "x11grab",
      "-video_size",
      `${screenWidth}x${Math.min(height + CALIBRATION_SEARCH, SCREEN_HEIGHT)}`,
      "-i",
      `${VIDEO_DISPLAY}.0+0,0`,
    ]);
    return (
      bestContentTop(screen, screenWidth, shot, width, height) ??
      DEFAULT_CONTENT_TOP
    );
  } catch {
    return DEFAULT_CONTENT_TOP;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface VideoStream {
  stop(): void;
}

export function startVideo(opts: {
  width: number;
  height: number;
  top: number;
  onFrame: (frame: Buffer, key: boolean) => void;
  log: (msg: string) => void;
}): VideoStream {
  const region = captureRegion(opts.width, opts.height, opts.top);
  const ffmpeg = spawn("ffmpeg", encoderArgs(region), {
    env: { ...process.env, DISPLAY: VIDEO_DISPLAY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const splitter = createAccessUnitSplitter((au) => {
    const key = isKeyframe(au);
    opts.onFrame(videoFrame(++seq, key, opts.width, opts.height, au), key);
  });
  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    splitter.push(chunk);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => splitter.flush(), FLUSH_AFTER_MS);
  });
  ffmpeg.stderr.on("data", (d: Buffer) => opts.log(d.toString().trim()));
  ffmpeg.on("error", (err) => opts.log(`ffmpeg: ${err.message}`));
  return {
    stop() {
      if (timer) clearTimeout(timer);
      ffmpeg.kill("SIGKILL");
    },
  };
}
