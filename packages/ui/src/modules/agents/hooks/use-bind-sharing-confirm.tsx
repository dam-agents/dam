import { type ReactNode, useCallback } from "react";

import type { AgentView } from "../../../types.js";
import { useDismissibleConfirm } from "../../connections/hooks/use-dismissible-confirm.js";
import {
  type SharedChannel,
  sharedChannelsTitle,
} from "../../sandboxes/lib/shared-channels.js";
import { BindSharingText } from "../components/bind/bind-sharing-text.js";
import { useAgentSharedAccess } from "./use-agent-shared-access.js";

const DISMISSED_STORAGE_KEY =
  "platform-bind-shared-connections-confirm-dismissed";

export interface BindSharingConfirm {
  dismissed: boolean;
  body: (audience: SharedChannel | null) => ReactNode;
  confirm: (
    audience: SharedChannel | null,
    confirmLabel: string,
  ) => Promise<boolean>;
}

export function useBindSharingConfirm(
  agent: AgentView | null,
): BindSharingConfirm {
  const names = useAgentSharedAccess(agent);
  const { dismissed, confirm: confirmDismissible } = useDismissibleConfirm(
    DISMISSED_STORAGE_KEY,
  );
  const body = useCallback(
    (audience: SharedChannel | null) =>
      agent && audience && names?.length !== 0 ? (
        <BindSharingText
          agentName={agent.name}
          connectionNames={names}
          audience={audience}
        />
      ) : null,
    [agent, names],
  );
  const confirm = useCallback(
    async (audience: SharedChannel | null, confirmLabel: string) => {
      const text = body(audience);
      if (!agent || !audience || !text) return true;
      return confirmDismissible({
        title: `Share ${agent.name}'s connections with ${sharedChannelsTitle([audience])}?`,
        body: text,
        confirmLabel,
      });
    },
    [agent, body, confirmDismissible],
  );
  return { dismissed, body, confirm };
}
