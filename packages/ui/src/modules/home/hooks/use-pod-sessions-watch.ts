import { useQueryClient } from "@tanstack/react-query";
import { podSessionsNoticeSchema } from "api-server-api";
import { useEffect } from "react";

import { api } from "../../../api.js";
import { watchWithRetry } from "../../../lib/watch-retry.js";
import { acpSessionsKeys } from "../../sessions/api/queries.js";
import { homeKeys } from "../api/queries.js";

const COALESCE_MS = 250;

export function usePodSessionsWatch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      timer = undefined;
      for (const agentId of dirty) {
        void queryClient.invalidateQueries({
          queryKey: homeKeys.sessions(agentId),
        });
      }
      dirty.clear();
    };

    const dispose = watchWithRetry((onError) =>
      api.events.podSessions.subscribe(undefined, {
        onData: (raw) => {
          const parsed = podSessionsNoticeSchema.safeParse(raw);
          if (!parsed.success) return;
          const notice = parsed.data;
          if (notice.topic === "sync") {
            dirty.clear();
            void queryClient.invalidateQueries({
              queryKey: acpSessionsKeys.all,
            });
            return;
          }
          dirty.add(notice.agentId);
          timer ??= setTimeout(flush, COALESCE_MS);
        },
        onError,
      }),
    );

    return () => {
      dispose();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);
}
