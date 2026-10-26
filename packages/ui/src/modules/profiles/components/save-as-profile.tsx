import { Add, Save } from "@carbon/icons-react";
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
 * names the pick, and on a pick that came from a profile "Update {name}"
 * writes it back to that profile beside "Save as a new profile" (D95 B). Not
 * offered on a shared agent, whose editor uses the owner's profiles and never
 * changes them. The dialog renders outside the picker's popover, which an
 * outside click closes.
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
  const [open, setOpen] = useState<"create" | "update" | null>(null);
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

  const updating = open === "update" ? from : null;
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
        setOpen(null);
        onSaved(saved);
      },
      onError: (err: { message: string }) => setError(err.message),
    };
    if (updating)
      update.mutate(
        { id: updating.id, ...body },
        {
          ...done,
          onSuccess: () => done.onSuccess({ id: updating.id, name: trimmed }),
        },
      );
    else create.mutate(body, done);
  };
  const ask = (mode: "create" | "update") => {
    setName(mode === "update" ? (from?.name ?? "") : "");
    setError(null);
    setOpen(mode);
  };
  const action =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground";

  return {
    row: (
      <div className="flex flex-col">
        {from && (
          <button
            type="button"
            onClick={() => ask("update")}
            className={action}
          >
            <Save size={14} aria-hidden />
            {`Update “${from.name}”`}
          </button>
        )}
        <button type="button" onClick={() => ask("create")} className={action}>
          {from ? (
            <Add size={14} aria-hidden />
          ) : (
            <Save size={14} aria-hidden />
          )}
          {from ? "Save as a new profile" : "Save as a profile"}
        </button>
      </div>
    ),
    dialog: open && (
      <Modal onClose={() => setOpen(null)}>
        <DialogHeader
          onClose={() => setOpen(null)}
          closeDisabled={saving}
          title={updating ? `Update “${updating.name}”` : "Save as a profile"}
        />
        <DialogBody>
          <p className="mb-3 text-sm text-muted-foreground">
            {updating
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
          onCancel={() => setOpen(null)}
          cancelDisabled={saving}
          label={updating ? "Update profile" : "Save profile"}
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
