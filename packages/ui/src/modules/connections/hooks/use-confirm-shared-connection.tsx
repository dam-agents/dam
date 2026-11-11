import { useCallback } from "react";

import { getBrand } from "../../../brand.js";
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
import { damPreGrantSentence } from "../lib/dam-connection.js";
import { useDismissibleConfirms } from "./use-dismissible-confirm.js";

const DISMISSED_STORAGE_KEY: Record<AudienceKind, string> = {
  channels: "platform-shared-connection-confirm-dismissed",
  editors: "platform-editors-connection-confirm-dismissed",
};

export interface SharedConnectionConfirm {
  notice: ConnectionAudience | null;
  confirm: (
    connection?: NamedConnection & { templateId?: string },
  ) => Promise<boolean>;
}

export function useConfirmSharedConnection(
  audience: ConnectionAudience,
  damSentence: string | null = null,
): SharedConnectionConfirm {
  const { dismissed, confirm: confirmDismissible } = useDismissibleConfirms();
  const confirm = useCallback(
    async (connection?: NamedConnection & { templateId?: string }) => {
      const shown = audiencesToWarn(audience, (kind) =>
        dismissed(DISMISSED_STORAGE_KEY[kind]),
      );
      const dam =
        damSentence ?? damPreGrantSentence(getBrand().name, connection);
      if (shown.length === 0 && dam === null) return true;
      return confirmDismissible(
        {
          title:
            shown.length > 0
              ? sharedConnectionTitle(audience)
              : "Let this agent act as you?",
          body: (
            <>
              {shown.length > 0 && (
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
              )}
              {dam !== null && (
                <p className={shown.length > 0 ? "mt-2" : undefined}>
                  <strong className="font-semibold text-foreground">
                    {dam}
                  </strong>
                </p>
              )}
            </>
          ),
          confirmLabel: "Add connection",
        },
        shown.map((kind) => DISMISSED_STORAGE_KEY[kind]),
      );
    },
    [audience, damSentence, dismissed, confirmDismissible],
  );
  const notice = noticeAudience(audience, (kind) =>
    dismissed(DISMISSED_STORAGE_KEY[kind]),
  );
  return { notice, confirm };
}
