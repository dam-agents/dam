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
  channels: readonly SharedChannel[],
): SharedConnectionConfirm {
  const { dismissed, confirm: confirmDismissible } = useDismissibleConfirm(
    DISMISSED_STORAGE_KEY,
  );
  const confirm = useCallback(async () => {
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
