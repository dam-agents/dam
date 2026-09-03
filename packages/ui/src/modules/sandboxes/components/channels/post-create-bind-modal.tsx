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

type MessengerKind = "slack" | "telegram";

interface Props {
  channels: MessengerKind[];
  onClose: () => void;
  onBindComplete?: (kind: MessengerKind, channelId?: string) => void;
  initialKind?: MessengerKind;
}

export function PostCreateBindModal({
  channels,
  onClose,
  onBindComplete,
  initialKind,
}: Props) {
  const hasSlack = channels.includes("slack");
  const hasTelegram = channels.includes("telegram");
  const hasBoth = hasSlack && hasTelegram;
  const totalSteps = channels.length;

  const [currentKind, setCurrentKind] = useState<MessengerKind>(
    initialKind ?? (hasSlack ? "slack" : "telegram"),
  );

  const currentStep = currentKind === "slack" ? 1 : hasSlack ? 2 : 1;

  function advanceToTelegram() {
    setCurrentKind("telegram");
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
        {currentKind === "slack" && <BindWalkthrough kind="slack" />}
        {currentKind === "telegram" && <BindWalkthrough kind="telegram" />}
      </DialogBody>

      {currentKind === "slack" && hasBoth && (
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
