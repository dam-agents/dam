import { type ReactNode, useCallback } from "react";

import { getBrand } from "../../../brand.js";
import type { AgentView } from "../../../types.js";
import { useDismissibleConfirms } from "../../connections/hooks/use-dismissible-confirm.js";
import {
  damAudienceSentence,
  damHoldWarns,
} from "../../connections/lib/dam-connection.js";
import {
  type SharedChannel,
  sharedChannelsTitle,
} from "../../sandboxes/lib/shared-channels.js";
import { BindSharingText } from "../components/bind/bind-sharing-text.js";
import { useAgentSharedAccess } from "./use-agent-shared-access.js";
import { useHoldsDamConnection } from "./use-holds-dam-connection.js";

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
  const dam = damHoldWarns(useHoldsDamConnection(agent))
    ? damAudienceSentence(getBrand().name, "anyone in this chat")
    : null;
  /* UNIT_BOUNDARY_DESCRIPTION: a person may stop being asked about sharing the Agent's connections, but never about driving it as its owner: while the Connection that acts as the owner is there the question cannot be dismissed, so the dismissal stops nothing that matters, and the notice under a dismissal carries the same sentence. */
  const confirms = useDismissibleConfirms();
  const dismissed = dam === null && confirms.dismissed(DISMISSED_STORAGE_KEY);
  const body = useCallback(
    (audience: SharedChannel | null, whisper = false) => {
      if (!agent || !audience) return null;
      const grants = names?.length !== 0 || whisper;
      if (!grants && dam === null) return null;
      return (
        <>
          {grants && (
            <BindSharingText
              agentName={agent.name}
              connectionNames={names}
              audience={audience}
              whisper={whisper}
            />
          )}
          {dam !== null && (
            <p className={grants ? "mt-2" : undefined}>
              <strong className="font-semibold text-foreground">{dam}</strong>
            </p>
          )}
        </>
      );
    },
    [agent, names, dam],
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
      return confirms.confirm(
        {
          title:
            names?.length === 0
              ? `Let anyone in ${where} whisper to ${agent.name}?`
              : `Share ${agent.name}'s connections with ${where}?`,
          body: text,
          confirmLabel,
        },
        dam === null ? [DISMISSED_STORAGE_KEY] : [],
      );
    },
    [agent, dam, names, body, confirms],
  );
  return { dismissed, body, confirm };
}
