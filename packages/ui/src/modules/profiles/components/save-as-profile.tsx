import type { SessionPair } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useCreateProfile, useUpdateProfile } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: "Save as a profile" names the pick the picker is
 * holding, and "Update {name}" writes it back to the profile it came from; both
 * take the values as they are, since that is exactly what the user tuned.
 */
export function SaveAsProfile({
  pair,
  providerTemplate,
  profile,
  onClose,
  onSaved,
}: {
  pair: SessionPair;
  providerTemplate: string;
  /** UNIT_BOUNDARY_DESCRIPTION: present when the pick is the named profile's own values, so the save updates it instead of creating a second one. */
  profile: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: (profileId: string, name: string) => void;
}) {
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const [name, setName] = useState(profile?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give the profile a name.");
      return;
    }
    const body = {
      harness: pair.harness,
      providerTemplate,
      model: pair.model ?? "",
      ...(pair.settings && { settings: pair.settings }),
    };
    if (profile) {
      update.mutate(
        { id: profile.id, name: trimmed, ...body },
        {
          onSuccess: () => onSaved(profile.id, trimmed),
          onError: (err) => setError(err.message),
        },
      );
      return;
    }
    create.mutate(
      { name: trimmed, ...body },
      {
        onSuccess: (saved) => onSaved(saved.id, saved.name),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <Modal onClose={onClose}>
      <DialogHeader
        onClose={onClose}
        closeDisabled={saving}
        title={profile ? `Update “${profile.name}”` : "Save as a profile"}
      />
      <DialogBody>
        <p className="mb-3 text-sm text-muted-foreground">
          {profile
            ? "Every chat default, channel and schedule that uses this profile takes these values."
            : "Name this harness, model and settings, then point your defaults, channels and schedules at it."}
        </p>
        <FormField
          label="Name"
          error={error ?? undefined}
          hint={
            profile
              ? undefined
              : "A name you will recognise in the model picker."
          }
        >
          <Input
            autoFocus
            aria-label="Profile name"
            placeholder="e.g. Fast review"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </FormField>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={saving}
        label={profile ? "Update profile" : "Save profile"}
        pendingLabel="Saving…"
        pending={saving}
        onSubmit={save}
      />
    </Modal>
  );
}
