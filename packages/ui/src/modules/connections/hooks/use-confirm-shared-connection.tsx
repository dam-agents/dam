import { useCallback } from "react";

import { ConnectionAudienceSentence } from "../components/connection-audience-sentence.js";
import {
  type AudienceKind,
  audiencesToWarn,
  type ConnectionAudience,
  noticeAudience,
  sharedConnectionTitle,
} from "../lib/connection-audience.js";
import {
  connectionLabel,
  type NamedConnection,
} from "../lib/connection-label.js";
import { useDismissibleConfirms } from "./use-dismissible-confirm.js";

const DISMISSED_STORAGE_KEY: Record<AudienceKind, string> = {
  channels: "platform-shared-connection-confirm-dismissed",
  editors: "platform-editors-connection-confirm-dismissed",
};

export interface SharedConnectionConfirm {
  notice: ConnectionAudience | null;
  confirm: (connection?: NamedConnection) => Promise<boolean>;
}

export function useConfirmSharedConnection(
  audience: ConnectionAudience,
): SharedConnectionConfirm {
  const { dismissed, confirm: confirmDismissible } = useDismissibleConfirms();
  const confirm = useCallback(
    async (connection?: NamedConnection) => {
      const shown = audiencesToWarn(audience, (kind) =>
        dismissed(DISMISSED_STORAGE_KEY[kind]),
      );
      if (shown.length === 0) return true;
      return confirmDismissible(
        {
          title: sharedConnectionTitle(audience),
          body: (
            <ConnectionAudienceSentence
              audience={audience}
              uses={
                connection ? (
                  <strong className="font-semibold text-foreground">
                    {connectionLabel(connection)}
                  </strong>
                ) : (
                  "the connections you add"
                )
              }
            />
          ),
          confirmLabel: "Add connection",
        },
        shown.map((kind) => DISMISSED_STORAGE_KEY[kind]),
      );
    },
    [audience, dismissed, confirmDismissible],
  );
  const notice = noticeAudience(audience, (kind) =>
    dismissed(DISMISSED_STORAGE_KEY[kind]),
  );
  return { notice, confirm };
}
