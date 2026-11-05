import type { ProfileWithUsage } from "api-server-api";
import { PROFILE_NAME_MAX_LENGTH } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useUpdateProfile } from "../api/mutations.js";

/** UNIT_BOUNDARY_DESCRIPTION: a profile's new name; Save waits for a name that differs from the current one, and the server's refusal stays in the dialog until the name is edited. */
export function RenameProfileDialog({
  profile,
  onClose,
}: {
  profile: ProfileWithUsage;
  onClose: () => void;
}) {
  const update = useUpdateProfile({ silent: true });
  const [name, setName] = useState(profile.name);
  const trimmed = name.trim();
  const unchanged = trimmed === "" || trimmed === profile.name;
  const save = () => {
    if (unchanged || update.isPending) return;
    update.mutate({ id: profile.id, name: trimmed }, { onSuccess: onClose });
  };
  return (
    <Modal size="sm" onClose={() => !update.isPending && onClose()}>
      <DialogHeader
        onClose={onClose}
        closeDisabled={update.isPending}
        title="Rename profile"
      />
      <DialogBody>
        <FormField label="Name" error={update.error?.message}>
          <Input
            autoFocus
            aria-label="Profile name"
            value={name}
            maxLength={PROFILE_NAME_MAX_LENGTH}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setName(e.target.value);
              if (update.isError) update.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
            }}
          />
        </FormField>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={update.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={update.isPending}
        disabled={unchanged}
        onSubmit={save}
      />
    </Modal>
  );
}
