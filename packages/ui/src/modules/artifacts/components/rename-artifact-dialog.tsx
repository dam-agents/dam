import type { LibraryArtifact } from "api-server-api";
import { ARTIFACT_TITLE_MAX_LENGTH, isArtifactIcon } from "api-server-api";
import { useState } from "react";

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner renames an artifact and changes the
 * icon its Agent picked, one emoji, which marks it in the library and in its
 * browser tab. An empty icon field clears the icon.
 */
export function RenameArtifactDialog({ artifact, onClose }: Props) {
  const [title, setTitle] = useState(artifact.title);
  const [icon, setIcon] = useState(artifact.icon ?? "");
  const update = useUpdateArtifact();
  const pending = update.isPending;
  const trimmedIcon = icon.trim();
  const iconValid = trimmedIcon === "" || isArtifactIcon(trimmedIcon);

  const save = () => {
    if (pending) return;
    const trimmed = title.trim();
    if (!trimmed || !iconValid) return;
    const nextIcon = trimmedIcon === "" ? null : trimmedIcon;
    const titleChanged = trimmed !== artifact.title;
    const iconChanged = nextIcon !== artifact.icon;
    if (!titleChanged && !iconChanged) {
      onClose();
      return;
    }
    update.mutate(
      {
        id: artifact.id,
        ...(titleChanged ? { title: trimmed } : {}),
        ...(iconChanged ? { icon: nextIcon } : {}),
      },
      { onSuccess: onClose },
    );
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
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
            onKeyDown={onEnter}
          />
        </FormField>
        <FormField
          label="Icon"
          hint="One emoji. It marks the artifact in the list and in its browser tab."
          error={iconValid ? undefined : "Use exactly one emoji, such as 📈."}
        >
          <Input
            value={icon}
            aria-label="Icon"
            placeholder="📄"
            className="w-20 text-center text-base"
            onChange={(e) => setIcon(e.target.value)}
            onKeyDown={onEnter}
          />
        </FormField>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={pending}
        label="Save"
        pendingLabel="Saving…"
        pending={pending}
        disabled={!title.trim() || !iconValid}
        onSubmit={save}
      />
    </Modal>
  );
}
