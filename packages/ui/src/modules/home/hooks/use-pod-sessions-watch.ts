import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "../../../api.js";
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

    const subscription = api.events.podSessions.subscribe(undefined, {
      onData: (notice) => {
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
    });

    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);
}
