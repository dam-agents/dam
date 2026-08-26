import { createHarnessClient } from "./harness-client.js";

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
  apiServerUrl: string;
  agentId: string;
  log?: (msg: string) => void;
}): ArtifactTouchReporter {
  const client = createHarnessClient({
    apiServerUrl: opts.apiServerUrl,
    agentId: opts.agentId,
  });

  async function send(touch: {
    sessionId: string;
    artifactId: string;
    version: number;
  }): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await client.runtime.v1.reportArtifactTouch.mutate(touch);
        return;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          opts.log?.(
            `giving up on ${touch.artifactId}@${touch.version}: ${(err as Error).message}`,
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
