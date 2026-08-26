import type { KbPublishService } from "agent-runtime-api";

import { executeBatch } from "./executor.js";
import { planShare } from "./walker.js";

export interface KbPublishRuntime {
  service: KbPublishService;
  isActive: () => boolean;
}

export function composeKbPublish(opts: {
  workDir: string;
  log: (msg: string) => void;
}): KbPublishRuntime {
  let active = 0;
  const track = async <T>(run: () => Promise<T>): Promise<T> => {
    active += 1;
    try {
      return await run();
    } finally {
      active -= 1;
    }
  };
  return {
    isActive: () => active > 0,
    service: {
      plan: (input) =>
        track(() =>
          planShare({
            workDir: opts.workDir,
            roots: input.roots,
            caps: input.caps,
          }),
        ),
      execute: (input) =>
        track(() => executeBatch({ workDir: opts.workDir, input, log: opts.log })),
    },
  };
}
