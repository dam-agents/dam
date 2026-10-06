import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const VIDEO_DISPLAY = ":99";
export const VIDEO_FPS = 60;

const AUD = Buffer.from([0, 0, 0, 1, 9]);
const IDR_NAL = 5;
const FLUSH_AFTER_MS = 4;

export const VIDEO_TOOLS = [
  "/usr/bin/sway",
  "/opt/platform-vnc/bin/wayvnc",
  "/opt/ms-playwright/chromium",
] as const;

export function videoAvailable(
  exists: (path: string) => boolean = existsSync,
): boolean {
  return VIDEO_TOOLS.every((path) => exists(path));
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
): { width: number; height: number } {
  const even = (v: number) => Math.max(2, v - (v % 2));
  return { width: even(width), height: even(height) };
}

export function encoderArgs(region: {
  width: number;
  height: number;
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
    `${VIDEO_DISPLAY}.0+0,0`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-crf",
    "24",
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

export interface VideoStream {
  stop(): void;
}

export function startVideo(opts: {
  width: number;
  height: number;
  scale: number;
  onFrame: (frame: Buffer, key: boolean) => void;
  onExit: () => void;
  log: (msg: string) => void;
}): VideoStream {
  const region = captureRegion(
    Math.round(opts.width * opts.scale),
    Math.round(opts.height * opts.scale),
  );
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
  let stopped = false;
  ffmpeg.on("error", (err) => opts.log(`ffmpeg: ${err.message}`));
  ffmpeg.on("close", (code, signal) => {
    if (timer) clearTimeout(timer);
    if (stopped) return;
    opts.log(`ffmpeg exited (${signal ?? code})`);
    opts.onExit();
  });
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      ffmpeg.kill("SIGKILL");
    },
  };
}
