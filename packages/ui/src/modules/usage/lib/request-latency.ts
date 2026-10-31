import { loggerLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

type LatencyListener = (path: string, elapsedMs: number) => void;

let listener: LatencyListener | null = null;

export function onRequestLatency(next: LatencyListener): void {
  listener = next;
}

export const requestLatencyLink = loggerLink<AppRouter>({
  enabled: (opts) => opts.direction === "down",
  logger: (opts) => {
    if (opts.direction === "down" && opts.type !== "subscription") {
      listener?.(opts.path, opts.elapsedMs);
    }
  },
});
