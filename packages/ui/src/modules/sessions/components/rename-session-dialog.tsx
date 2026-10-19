import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import type { SessionView } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useRenameSession } from "../api/mutations.js";

interface Props {
  agentId: string;
  session: SessionView;
  onClose: () => void;
}

export function RenameSessionDialog({ agentId, session, onClose }: Props) {
  const initial = (session.title ?? "").replace(/…$/, "");
  const [title, setTitle] = useState(initial);
  const rename = useRenameSession(agentId);
  const pending = rename.isPending;

  const save = () => {
    if (pending) return;
    const trimmed = title.trim();
    if (trimmed === initial.trim()) {
      onClose();
      return;
    }
    rename.mutate(
      { sessionId: session.sessionId, title: trimmed || null },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <DialogHeader
        onClose={onClose}
        closeDisabled={pending}
        title="Rename session"
      />
      <DialogBody>
        <FormField
          label="Title"
          hint="Leave empty to show the title the agent gave it."
        >
          <Input
            data-testid="session-rename-input"
            value={title}
            autoFocus
            onFocus={(e) =>
              e.currentTarget.setSelectionRange(
                0,
                e.currentTarget.value.length,
                "backward",
              )
            }
            maxLength={SESSION_TITLE_MAX_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
            }}
          />
        </FormField>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={pending}
        label="Save"
        pendingLabel="Saving…"
        pending={pending}
        onSubmit={save}
      />
    </Modal>
  );
}
