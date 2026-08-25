import type { PodSession, SessionsService } from "agent-runtime-api";

import {
  composeSessionList,
  type ListedHarnessSession,
} from "../domain/session-list.js";
import { noticeStream } from "../../../core/notice-stream.js";
import { createInProcessCaller } from "../infrastructure/in-process-request.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { AcpRuntime } from "./acp-runtime/acp-runtime.js";
import type { SessionChanges } from "./session-changes.js";

export function createSessionsService(deps: {
  acpRuntime: AcpRuntime;
  sessionMetadata: SessionMetadataStore;
  isRunning: (sessionId: string) => boolean;
  changes: SessionChanges;
}): SessionsService {
  return {
    async list(): Promise<PodSession[]> {
      const caller = createInProcessCaller((channel) =>
        deps.acpRuntime.attach(channel, { viewer: false }),
      );
      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: {} },
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const result = await caller.request<{
          sessions?: ListedHarnessSession[];
        }>("session/list", { cwd: "." });
        return composeSessionList(
          result.sessions ?? [],
          deps.sessionMetadata,
          deps.isRunning,
        );
      } finally {
        caller.close();
      }
    },

    watch: (signal) =>
      noticeStream(
        { topic: "sessions" } as const,
        (onChange) => {
          const unsubscribe = deps.changes.subscribe(onChange);
          return { close: unsubscribe };
        },
        signal,
      ),
  };
}
