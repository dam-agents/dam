import type { HarnessClient } from "./harness-client.js";
import { safeReport } from "./infrastructure/report.js";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

export interface ArtifactTouchReporter {
  report: (touch: {
    sessionId: string;
    artifactId: string;
    version: number;
  }) => void;
}

export function createArtifactTouchReporter(opts: {
  client: HarnessClient;
  log: (msg: string) => void;
}): ArtifactTouchReporter {
  return {
    report(touch) {
      void safeReport(
        () => opts.client.artifactLibrary.v1.reportTouch.mutate(touch),
        opts.log,
        `${touch.artifactId}@${touch.version}`,
        { attempts: ATTEMPTS, delayMs: RETRY_DELAY_MS },
      );
    },
  };
}
