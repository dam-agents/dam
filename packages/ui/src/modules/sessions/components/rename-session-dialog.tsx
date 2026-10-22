import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import type { SessionView } from "api-server-api";
import { useEffect, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useRenameSession } from "../api/mutations.js";
import { useAgentSession } from "../api/queries.js";
import { renameDefaults } from "../lib/session-title.js";

interface Props {
  agentId: string;
  session: SessionView;
  onClose: () => void;
}

export function RenameSessionDialog({ agentId, session, onClose }: Props) {
  const knowsTitleSource = session.customTitle !== undefined;
  const pod = useAgentSession(agentId, session.sessionId, {
    enabled: !knowsTitleSource,
  });
  const loading = !knowsTitleSource && pod.isPending;
  const { value: initial, placeholder } = renameDefaults(
    knowsTitleSource ? session : (pod.data ?? session),
  );
  const [edited, setEdited] = useState<string | null>(null);
  const title = edited ?? initial;
  const inputRef = useRef<HTMLInputElement>(null);
  const rename = useRenameSession(agentId);
  const pending = rename.isPending;

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const save = () => {
    if (pending || loading) return;
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
            ref={inputRef}
            data-testid="session-rename-input"
            value={title}
            placeholder={placeholder}
            disabled={loading}
            onFocus={(e) =>
              e.currentTarget.setSelectionRange(
                0,
                e.currentTarget.value.length,
                "backward",
              )
            }
            maxLength={SESSION_TITLE_MAX_LENGTH}
            onChange={(e) => setEdited(e.target.value)}
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
