import type { LibraryArtifact } from "api-server-api";
import { ARTIFACT_TITLE_MAX_LENGTH } from "api-server-api";
import { useEffect, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useUpdateArtifact } from "../api/mutations.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function RenameArtifactDialog({ artifact, onClose }: Props) {
  const [title, setTitle] = useState(artifact.title);
  const update = useUpdateArtifact();
  const pending = update.isPending;

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
    if (!trimmed) return;
    if (trimmed === artifact.title) {
      onClose();
      return;
    }
    update.mutate({ id: artifact.id, title: trimmed }, { onSuccess: onClose });
  };

  return (
    <Modal onClose={pending ? undefined : onClose}>
      <DialogHeader
        onClose={onClose}
        closeDisabled={pending}
        title="Rename artifact"
      />
      <DialogBody>
        <FormField label="Title">
          <Input
            value={title}
            autoFocus
            maxLength={ARTIFACT_TITLE_MAX_LENGTH}
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
        disabled={!title.trim()}
        onSubmit={save}
      />
    </Modal>
  );
}
