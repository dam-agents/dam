export const H264_CODEC = "avc1.42E033";

let supported: Promise<boolean> | null = null;

export function videoSupported(): Promise<boolean> {
  if (typeof VideoDecoder === "undefined") return Promise.resolve(false);
  supported ??= VideoDecoder.isConfigSupported({
    codec: H264_CODEC,
    optimizeForLatency: true,
  })
    .then((r) => r.supported === true)
    .catch(() => false);
  return supported;
}

export interface VideoPlayer {
  decode(frame: {
    seq: number;
    key: boolean;
    metadata: { deviceWidth: number; deviceHeight: number };
    data: Uint8Array;
  }): void;
  close(): void;
}

export function createVideoPlayer(opts: {
  canvas: () => HTMLCanvasElement | null;
  onDrawn: () => void;
  onError: (error: Error) => void;
}): VideoPlayer {
  let configuredFor: string | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      const canvas = opts.canvas();
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        if (canvas.width !== frame.displayWidth)
          canvas.width = frame.displayWidth;
        if (canvas.height !== frame.displayHeight)
          canvas.height = frame.displayHeight;
        ctx.drawImage(frame, 0, 0);
        opts.onDrawn();
      }
      frame.close();
    },
    error: (e) => opts.onError(e instanceof Error ? e : new Error(String(e))),
  });

  return {
    decode(frame) {
      const size = `${frame.metadata.deviceWidth}x${frame.metadata.deviceHeight}`;
      if (frame.key && configuredFor !== size) {
        decoder.configure({ codec: H264_CODEC, optimizeForLatency: true });
        configuredFor = size;
      }
      if (!configuredFor || decoder.state !== "configured") return;
      decoder.decode(
        new EncodedVideoChunk({
          type: frame.key ? "key" : "delta",
          timestamp: frame.seq * 1000,
          data: frame.data,
        }),
      );
    },
    close() {
      if (decoder.state !== "closed") decoder.close();
    },
  };
}
