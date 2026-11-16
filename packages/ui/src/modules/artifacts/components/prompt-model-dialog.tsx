import { isPlatformSubagentSetting } from "agent-runtime-api";
import type {
  LibraryArtifact,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useSessionDefaults } from "../../sessions/api/session-pair.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { nextSlots } from "../../sessions/lib/subagent-choice.js";
import { useSetArtifactPromptChoice } from "../api/mutations.js";
import { useArtifactPromptChoice } from "../api/queries.js";

/** UNIT_BOUNDARY_DESCRIPTION: what the Sessions that an interactive page's prompts open run on, picked with the chat's own picker as a channel's pick is and saved as it is made; "Use agent default" clears it, so the page follows the agent's model for channels again. A pick already running in a Session stays there. */
export function PromptModelDialog({
  artifact,
  agentId,
  onClose,
}: {
  artifact: LibraryArtifact;
  agentId: string;
  onClose: () => void;
}) {
  const { data: saved } = useArtifactPromptChoice(artifact.id);
  const { data: status } = useHarnessConfigStatus(agentId);
  const defaults = useSessionDefaults(agentId).data;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setChoice = useSetArtifactPromptChoice();
  const [draft, setDraft] = useState<SessionChoiceSlots | null>(null);
  const slots = draft ?? saved;

  const choose = (pair: SessionPair, references: SessionChoiceReferences) => {
    if (!slots) return;
    const next = nextSlots(slots, pair, references);
    if (!next.profileId && !pair.model) return setDraft(next);
    setDraft(null);
    const settings = {
      ...Object.fromEntries(
        Object.entries(pair.settings ?? {}).filter(
          ([id]) => !isPlatformSubagentSetting(id),
        ),
      ),
      ...next.platformSubagentSettings,
    };
    setChoice.mutate({
      id: artifact.id,
      pair: { ...pair, settings },
      profileId: next.profileId,
      platformSubagentProfileId: next.platformSubagentProfileId,
    });
  };

  return (
    <Modal onClose={onClose}>
      <DialogHeader title={`Model for “${artifact.title}”`} onClose={onClose} />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground">
            A prompt from this page opens a session of its own on the agent, one
            for each person who uses the page. Pick the profile or model those
            sessions run on.
          </p>
          <p className="text-sm text-muted-foreground">
            A session that already runs keeps the model it started on.
          </p>
          {slots && (
            <fieldset disabled={setChoice.isPending} className="min-w-0">
              <SessionPairPicker
                agentId={agentId}
                carried={status?.harnesses ?? []}
                defaultHarness={status?.defaultHarness ?? ""}
                routed={status?.modelRouter ?? false}
                row
                onConnectProviders={() =>
                  navigateToSandboxHome(agentId, "providers")
                }
                target={{
                  slots,
                  label: "Page harness and model",
                  placeholder: "The agent's model for channels",
                  agentDefault: {
                    detail: "Follows the agent's model for channels",
                    pair: defaults?.channel ?? defaults?.chat ?? null,
                    onClear: () => {
                      setDraft(null);
                      setChoice.mutate({
                        id: artifact.id,
                        pair: null,
                        profileId: null,
                        platformSubagentProfileId: null,
                      });
                    },
                  },
                  onChoose: choose,
                }}
              />
            </fieldset>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Modal>
  );
}
