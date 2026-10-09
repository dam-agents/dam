import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ProcessOutput } from "agent-runtime-api";

export interface OutputReader {
  tail(path: string, maxBytes: number): Promise<ProcessOutput | null>;
}

function skipPartialCharacter(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start);
}

export function createOutputReader(): OutputReader {
  return {
    async tail(path, maxBytes) {
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
        const info = await handle.stat();
        if (!info.isFile()) return null;
        const length = Math.min(info.size, maxBytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          length,
          info.size - length,
        );
        const truncated = info.size > maxBytes;
        const bytes = buffer.subarray(0, bytesRead);
        return {
          text: (truncated ? skipPartialCharacter(bytes) : bytes).toString(
            "utf8",
          ),
          truncated,
        };
      } catch {
        return null;
      } finally {
        await handle?.close();
      }
    },
  };
}
