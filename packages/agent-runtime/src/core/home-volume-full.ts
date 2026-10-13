import { statfsSync, writeFileSync } from "node:fs";

export const HOME_VOLUME_FULL_REASON = "HomeVolumeFull";

const NEARLY_FULL_BYTES = 64 * 1024 * 1024;

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
  {
    terminationLog = "/dev/termination-log",
    free = freeBytes,
  }: {
    terminationLog?: string;
    free?: (dir: string) => number | null;
  } = {},
): () => void {
  const monitor = (err: Error) => {
    if (!isHomeVolumeFull(err, homeDir, free)) return;
    process.stderr.write(
      `[server] the home volume ${homeDir} is full; exiting\n`,
    );
    try {
      writeFileSync(terminationLog, HOME_VOLUME_FULL_REASON, { flag: "r+" });
    } catch {}
  };
  process.on("uncaughtExceptionMonitor", monitor);
  return () => process.off("uncaughtExceptionMonitor", monitor);
}
