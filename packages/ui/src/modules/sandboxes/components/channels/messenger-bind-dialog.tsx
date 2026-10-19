import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { useSlackInstallRequestUrl } from "../../../links/api/queries.js";
import { SlackInstallRequest } from "../../../slack/components/slack-install-request.js";
import {
  type BindMessenger,
  MessengerInstructions,
} from "./messenger-instructions.js";

const TITLE: Record<BindMessenger, string> = {
  slack: "Add to Slack channel",
  telegram: "Add to Telegram chat",
};

// UNIT_BOUNDARY_DESCRIPTION: the steps that bind an agent to a Slack channel or a Telegram chat, opened from places that have no room for them inline, such as a sidebar row's menu.
export function MessengerBindDialog({
  messenger,
  onClose,
}: {
  messenger: BindMessenger;
  onClose: () => void;
}) {
  const installRequestUrl = useSlackInstallRequestUrl();
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title={
          <span className="flex items-center gap-2">
            <ConnectionIcon iconSlug={messenger} alt="" size={20} />
            {TITLE[messenger]}
          </span>
        }
        onClose={onClose}
      />
      <DialogBody>
        <MessengerInstructions messenger={messenger} />
      </DialogBody>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-3 px-5 pb-5 md:px-6 md:pb-6">
        {messenger === "slack" && installRequestUrl && (
          <div className="mr-auto">
            <SlackInstallRequest
              href={installRequestUrl}
              workspaceLabel="Slack workspace"
            />
          </div>
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
