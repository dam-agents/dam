import { statfsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import type { HomeVolume } from "agent-runtime-api";

export const HOME_VOLUME_FULL_REASON = "HomeVolumeFull";

const NEARLY_FULL_BYTES = 64 * 1024 * 1024;

export async function readHomeVolume(
  homeDir: string,
): Promise<HomeVolume | null> {
  try {
    const s = await statfs(homeDir);
    const freeBytes = s.bavail * s.bsize;
    return {
      freeBytes,
      totalBytes: s.blocks * s.bsize,
      full: freeBytes < NEARLY_FULL_BYTES,
    };
  } catch {
    return null;
  }
}

function freeBytes(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

export function isHomeVolumeFull(
  err: unknown,
  homeDir: string,
  free: (dir: string) => number | null = freeBytes,
): boolean {
  if ((err as NodeJS.ErrnoException | null)?.code !== "ENOSPC") return false;
  const bytes = free(homeDir);
  return bytes !== null && bytes < NEARLY_FULL_BYTES;
}

export function reportHomeVolumeFullOnCrash(
  homeDir: string,
  { free = freeBytes }: { free?: (dir: string) => number | null } = {},
): () => void {
  const monitor = (err: Error) => {
    if (!isHomeVolumeFull(err, homeDir, free)) return;
    process.stderr.write(
      `[server] the home volume ${homeDir} is full; exiting\n`,
    );
  };
  process.on("uncaughtExceptionMonitor", monitor);
  return () => process.off("uncaughtExceptionMonitor", monitor);
}
