import type { KbPublishService } from "agent-runtime-api";

import { noticeStream } from "../../core/notice-stream.js";
import { createFilesWatcher } from "../files-watch.js";
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
  const watcher = createFilesWatcher(opts.workDir);
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
      watchRoots: (roots, signal) =>
        noticeStream(
          { topic: "kb-roots" } as const,
          (onChange) => {
            const handles = roots.map((root) =>
              watcher.watchTree(root, onChange),
            );
            return {
              close() {
                for (const handle of handles) handle.close();
              },
            };
          },
          signal,
        ),
    },
  };
}
