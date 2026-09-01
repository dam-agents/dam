import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { ConnectionIcon } from "@/modules/connections/components/connection-icon";

import { BindWalkthrough } from "./bind-walkthrough.js";
import { ChannelIdForm } from "./channel-id-form.js";

type MessengerKind = "slack" | "telegram";
type SlackView = "steps" | "id";

interface Props {
  channels: MessengerKind[];
  onClose: () => void;
  onBindComplete?: (kind: MessengerKind, channelId?: string) => void;
  initialSlackView?: SlackView;
  initialKind?: MessengerKind;
}

export function PostCreateBindModal({
  channels,
  onClose,
  onBindComplete,
  initialSlackView,
  initialKind,
}: Props) {
  const hasSlack = channels.includes("slack");
  const hasTelegram = channels.includes("telegram");
  const hasBoth = hasSlack && hasTelegram;
  const totalSteps = channels.length;

  const [currentKind, setCurrentKind] = useState<MessengerKind>(
    initialKind ?? (hasSlack ? "slack" : "telegram"),
  );
  const [slackView, setSlackView] = useState<SlackView>(
    initialSlackView ?? "steps",
  );

  const currentStep = currentKind === "slack" ? 1 : hasSlack ? 2 : 1;

  function advanceToTelegram() {
    setCurrentKind("telegram");
    setSlackView("steps");
  }

  function handleSlackIdSubmit(channelId: string, _ambient: boolean) {
    onBindComplete?.("slack", channelId);
    if (hasTelegram) {
      advanceToTelegram();
    } else {
      onClose();
    }
  }

  function handleBack() {
    if (currentKind === "telegram" && hasSlack) {
      setCurrentKind("slack");
    }
  }

  const subtitle =
    totalSteps > 1 ? `Step ${currentStep} of ${totalSteps}` : undefined;

  return (
    <Modal>
      <DialogHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="shrink-0">
              <ConnectionIcon iconSlug={currentKind} alt="" size={16} />
            </span>
            {currentKind === "slack"
              ? "Add to Slack Channel"
              : "Add to Telegram Chat"}
          </span>
        }
        subtitle={subtitle}
        onClose={onClose}
        closeTestId="walk-close"
      />

      <DialogBody className="flex flex-col gap-4">
        {currentKind === "slack" && slackView === "steps" && (
          <BindWalkthrough
            kind="slack"
            onUseChannelId={() => setSlackView("id")}
          />
        )}

        {currentKind === "slack" && slackView === "id" && (
          <ChannelIdForm
            onCancel={() => setSlackView("steps")}
            onSubmit={handleSlackIdSubmit}
          />
        )}

        {currentKind === "telegram" && <BindWalkthrough kind="telegram" />}
      </DialogBody>

      {currentKind === "slack" && slackView === "steps" && hasBoth && (
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={advanceToTelegram}>Set up Telegram next</Button>
        </DialogFooter>
      )}

      {currentKind === "telegram" && (
        <DialogFooter>
          {hasSlack && (
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      )}
    </Modal>
  );
}
