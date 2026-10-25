import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import type { AgentView } from "../../../types.js";
import { useUpdateAgent } from "../api/mutations.js";
import { AgentAvatar, resolveCharacter } from "./avatar/agent-avatar.js";
import { AvatarPicker } from "./avatar/avatar-picker.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's name and avatar in one dialog, both
 * editable at once rather than behind a pencil: the row's menu opens it, and
 * Save renames the Agent and sets the avatar the owner picked, keeping the
 * name-derived character when nothing was picked.
 */
export function RenameAgentDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const update = useUpdateAgent();
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState(
    agent.avatar ?? resolveCharacter(agent.name, agent.avatar),
  );
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const next = name.trim();
    if (!next) {
      setError("Enter a name.");
      return;
    }
    if (next === agent.name && avatar === agent.avatar) {
      onClose();
      return;
    }
    update.mutate({ id: agent.id, name: next, avatar }, { onSuccess: onClose });
  };

  return (
    <Modal onClose={onClose}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <DialogHeader title="Rename agent" onClose={onClose} />
        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <AvatarPicker value={avatar} onChange={setAvatar}>
              <button
                type="button"
                aria-label="Choose an avatar"
                data-testid="rename-agent-avatar"
                className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AgentAvatar name={name} avatar={avatar} size={56} />
              </button>
            </AvatarPicker>
            <div className="min-w-0 flex-1">
              <FormField label="Name" error={error ?? undefined}>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                />
              </FormField>
            </div>
          </div>
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          label="Save"
          pendingLabel="Saving…"
          pending={update.isPending}
        />
      </form>
    </Modal>
  );
}
