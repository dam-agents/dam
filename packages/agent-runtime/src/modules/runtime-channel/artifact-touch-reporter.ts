import type { HarnessClient } from "./harness-client.js";

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
  log?: (msg: string) => void;
}): ArtifactTouchReporter {
  async function send(touch: {
    sessionId: string;
    artifactId: string;
    version: number;
  }): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await opts.client.artifactLibrary.v1.reportTouch.mutate(touch);
        return;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          const reason = err instanceof Error ? err.message : String(err);
          opts.log?.(
            `giving up on ${touch.artifactId}@${touch.version}: ${reason}`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  return {
    report(touch) {
      void send(touch);
    },
  };
}
