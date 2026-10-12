import { useCallback } from "react";

import {
  type SharedChannel,
  sharedChannelsTitle,
} from "../../sandboxes/lib/shared-channels.js";
import { SharedChannelsPhrase } from "../components/shared-channels-phrase.js";
import { useDismissibleConfirm } from "./use-dismissible-confirm.js";

const DISMISSED_STORAGE_KEY = "platform-shared-connection-confirm-dismissed";

export interface SharedConnectionConfirm {
  dismissed: boolean;
  confirm: () => Promise<boolean>;
}

export function useConfirmSharedConnection(
  channels: readonly SharedChannel[] | null,
): SharedConnectionConfirm {
  const { dismissed, confirm: confirmDismissible } = useDismissibleConfirm(
    DISMISSED_STORAGE_KEY,
  );
  const confirm = useCallback(async () => {
    if (channels === null)
      return confirmDismissible({
        title: "This connection may be shared with a Slack or Telegram chat",
        body: (
          <>
            The agent's channels did not load. If it is bound to a Slack channel
            or a group chat, anyone there can ask it to use the connections you
            add, with your access.
          </>
        ),
        confirmLabel: "Add connection",
      });
    if (channels.length === 0) return true;
    return confirmDismissible({
      title: `This connection will be shared with ${sharedChannelsTitle(channels)}`,
      body: (
        <>
          This agent is bound to <SharedChannelsPhrase channels={channels} />.
          Anyone there can ask it to use the connections you add, with your
          access.
        </>
      ),
      confirmLabel: "Add connection",
    });
  }, [channels, confirmDismissible]);
  return { dismissed, confirm };
}
