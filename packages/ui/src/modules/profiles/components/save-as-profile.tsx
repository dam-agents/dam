import { Save } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
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

import { useAgent } from "../../agents/api/queries.js";
import { isOwnAgent } from "../../agents/lib/agent-editors.js";
import { isProfileSetting } from "../../sessions/lib/subagent-choice.js";
import { useCreateProfile, useUpdateProfile } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the foot of the full picker: "Save as a profile"
 * names the pick, and "Update {name}" writes it back to the profile it came
 * from (D95 B). Not offered on a shared agent, whose editor uses the owner's
 * profiles and never changes them. The dialog renders outside the picker's
 * popover, which an outside click closes.
 */
export function useSaveAsProfile({
  agentId,
  pair,
  providerTemplate,
  from,
  capability,
  onSaved,
}: {
  agentId: string | null;
  pair: SessionPair | null;
  providerTemplate: string | undefined;
  from: { id: string; name: string } | null;
  capability: HarnessCapability | undefined;
  onSaved: (profile: { id: string; name: string }) => void;
}) {
  const agent = useAgent(agentId);
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;
  if (
    !agentId ||
    !pair?.model ||
    providerTemplate === undefined ||
    (agent !== null && !isOwnAgent(agent))
  )
    return { row: null, dialog: null };

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return setError("Give the profile a name.");
    const body = {
      agentId,
      name: trimmed,
      harness: pair.harness,
      providerTemplate,
      model: pair.model ?? "",
      settings: Object.fromEntries(
        Object.entries(pair.settings ?? {}).filter(([id]) =>
          isProfileSetting(id, capability),
        ),
      ),
    };
    const done = {
      onSuccess: (saved: { id: string; name: string }) => {
        setOpen(false);
        onSaved(saved);
      },
      onError: (err: { message: string }) => setError(err.message),
    };
    if (from)
      update.mutate(
        { id: from.id, ...body },
        {
          ...done,
          onSuccess: () => done.onSuccess({ id: from.id, name: trimmed }),
        },
      );
    else create.mutate(body, done);
  };

  return {
    row: (
      <button
        type="button"
        onClick={() => {
          setName(from?.name ?? "");
          setError(null);
          setOpen(true);
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Save size={14} aria-hidden />
        {from ? `Update “${from.name}”` : "Save as a profile"}
      </button>
    ),
    dialog: open && (
      <Modal onClose={() => setOpen(false)}>
        <DialogHeader
          onClose={() => setOpen(false)}
          closeDisabled={saving}
          title={from ? `Update “${from.name}”` : "Save as a profile"}
        />
        <DialogBody>
          <p className="mb-3 text-sm text-muted-foreground">
            {from
              ? "Every chat default, channel and schedule that uses this profile takes these values."
              : "Name this harness, model and settings, then point your defaults, channels and schedules at it."}
          </p>
          <FormField label="Name" error={error ?? undefined}>
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
          onCancel={() => setOpen(false)}
          cancelDisabled={saving}
          label={from ? "Update profile" : "Save profile"}
          pendingLabel="Saving…"
          pending={saving}
          onSubmit={save}
        />
      </Modal>
    ),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a pick came from, so Update writes
 * back to it, held for one scope: an agent's next session, or one session. A
 * picker stays mounted when its agent or session changes, so a pick made in
 * another scope never carries over and never offers to overwrite that profile.
 */
export function usePickedProfile(scope: string) {
  const [origin, setOrigin] = useState<{
    scope: string;
    profile: { id: string; name: string };
  } | null>(null);
  return [
    origin?.scope === scope ? origin.profile : null,
    (profile: { id: string; name: string }) =>
      setOrigin({ scope, profile: { id: profile.id, name: profile.name } }),
  ] as const;
}
