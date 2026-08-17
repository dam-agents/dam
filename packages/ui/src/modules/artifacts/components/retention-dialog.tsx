import {
  ARTIFACT_RESTORE_WINDOW_DAYS,
  type LibraryArtifact,
} from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Select } from "@/components/ui/select";
import { emitToast } from "@/lib/toast";

import { useSetArtifactSharing } from "../api/mutations.js";
import { deletionDate, deletionSummary } from "../lib/format.js";

const KEEP = "keep";
const NEVER = "never";

const RETENTION_OPTIONS = [
  { value: NEVER, label: "Never delete" },
  { value: "1", label: "Delete in 1 hour" },
  { value: "24", label: "Delete in 1 day" },
  { value: "168", label: "Delete in 7 days" },
  { value: "720", label: "Delete in 30 days" },
] as const;

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function RetentionDialog({ artifact, onClose }: Props) {
  const scheduled = artifact.expiresAt;
  const scheduledDate = scheduled ? deletionDate(scheduled) : null;
  const [choice, setChoice] = useState<string>(
    scheduledDate === null ? NEVER : KEEP,
  );
  const sharing = useSetArtifactSharing();
  const statusText = deletionSummary(scheduled);

  const save = () => {
    if (choice === KEEP) {
      onClose();
      return;
    }
    sharing.mutate(
      {
        id: artifact.id,
        expiresInHours: choice === NEVER ? null : Number(choice),
      },
      {
        onSuccess: ({ expiresAt }) => {
          emitToast({
            kind: "success",
            message: expiresAt
              ? `This artifact deletes on ${deletionDate(expiresAt)}.`
              : "Automatic deletion turned off — this artifact is kept until you delete it.",
          });
          onClose();
        },
      },
    );
  };

  return (
    <Modal>
      <DialogHeader
        title={`Delete “${artifact.title}” automatically`}
        onClose={onClose}
        closeDisabled={sharing.isPending}
      />
      <DialogBody>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              This artifact and all its versions are permanently deleted on the
              date you choose. This happens whether the artifact is public or
              private.
            </p>
            <p className="text-sm text-muted-foreground">
              {`You can still restore it for ${ARTIFACT_RESTORE_WINDOW_DAYS} days afterwards by choosing a new date.`}
            </p>
          </div>

          <p className="text-sm text-muted-foreground">{statusText}</p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Delete after
            </span>
            <Select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={sharing.isPending}
            >
              {scheduledDate && (
                <option value={KEEP}>
                  {`Keep current date (${scheduledDate})`}
                </option>
              )}
              {RETENTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Cancel"
        label="Save"
        pendingLabel="Saving…"
        pending={sharing.isPending}
        cancelDisabled={sharing.isPending}
        destructive={choice !== KEEP && choice !== NEVER}
        onSubmit={save}
      />
    </Modal>
  );
}
