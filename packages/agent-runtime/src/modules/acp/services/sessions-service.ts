import type {
  PodSession,
  PodSessionNotice,
  SessionsService,
} from "agent-runtime-api";

import {
  composeSessionList,
  type ListedHarnessSession,
} from "../domain/session-list.js";
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

    async *watch(signal): AsyncGenerator<PodSessionNotice> {
      const pending: PodSessionNotice[] = [{ topic: "sessions" }];
      let wake: (() => void) | undefined;
      const unsubscribe = deps.changes.subscribe(() => {
        if (pending.length === 0) pending.push({ topic: "sessions" });
        wake?.();
      });
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const next = pending.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          yield next;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        unsubscribe();
      }
    },
  };
}
