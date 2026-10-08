import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import type { SessionView } from "api-server-api";
import { useEffect, useState } from "react";

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
  const [title, setTitle] = useState(session.title ?? "");
  const rename = useRenameSession(agentId);
  const pending = rename.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const save = () => {
    if (pending) return;
    const trimmed = title.trim();
    if (trimmed === (session.title ?? "")) {
      onClose();
      return;
    }
    rename.mutate(
      { sessionId: session.sessionId, title: trimmed || null },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal>
      <DialogHeader
        onClose={onClose}
        closeDisabled={pending}
        title="Rename session"
      />
      <DialogBody>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <Input
            size="sm"
            aria-label="Title"
            data-testid="session-rename-input"
            value={title}
            autoFocus
            maxLength={SESSION_TITLE_MAX_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
            }}
          />
          <span className="text-xs text-muted-foreground">
            Leave empty to show the title the agent gave it.
          </span>
        </div>
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
