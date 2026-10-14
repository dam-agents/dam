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
  body: (audience: SharedChannel | null, whisper?: boolean) => ReactNode;
  confirm: (
    audience: SharedChannel | null,
    confirmLabel: string,
    whisper?: boolean,
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
    (audience: SharedChannel | null, whisper = false) =>
      agent && audience && (names?.length !== 0 || whisper) ? (
        <BindSharingText
          agentName={agent.name}
          connectionNames={names}
          audience={audience}
          whisper={whisper}
        />
      ) : null,
    [agent, names],
  );
  const confirm = useCallback(
    async (
      audience: SharedChannel | null,
      confirmLabel: string,
      whisper = false,
    ) => {
      const text = body(audience, whisper);
      if (!agent || !audience || !text) return true;
      const where = sharedChannelsTitle([audience]);
      return confirmDismissible({
        title:
          names?.length === 0
            ? `Let anyone in ${where} whisper to ${agent.name}?`
            : `Share ${agent.name}'s connections with ${where}?`,
        body: text,
        confirmLabel,
      });
    },
    [agent, names, body, confirmDismissible],
  );
  return { dismissed, body, confirm };
}
