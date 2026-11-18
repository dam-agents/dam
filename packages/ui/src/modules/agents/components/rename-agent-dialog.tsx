import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/errors";

import type { AgentView } from "../../../types.js";
import { useUpdateAgent } from "../api/mutations.js";
import { resolveCharacter } from "./avatar/agent-avatar.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The design's Rename agent dialog, opened from the
 * agent menu in the chat: one Name field, saved on Save or Enter. An Agent
 * whose avatar came from its name keeps that avatar, as an in-place rename
 * does.
 */
export function RenameAgentDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const [value, setValue] = useState(agent.name);
  const [error, setError] = useState<string | null>(null);
  const rename = useUpdateAgent({ inlineError: true });
  const next = value.trim();

  const save = async () => {
    if (!next || rename.isPending) return;
    if (next === agent.name) {
      onClose();
      return;
    }
    try {
      await rename.mutateAsync({
        id: agent.id,
        name: next,
        ...(agent.avatar
          ? {}
          : { avatar: resolveCharacter(agent.name, agent.avatar) }),
      });
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't rename the agent."));
    }
  };

  return (
    <Modal onClose={rename.isPending ? undefined : onClose}>
      <DialogHeader onClose={onClose} title="Rename agent" />
      <DialogBody>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <Input
            size="sm"
            aria-label="Name"
            value={value}
            autoFocus
            maxLength={64}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
            }}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        label="Save"
        pendingLabel="Saving…"
        pending={rename.isPending}
        disabled={!next}
        onSubmit={() => void save()}
      />
    </Modal>
  );
}
