import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import { shortNameForTemplate } from "api-server-api";
import { useId, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

import { useAgent } from "../../agents/api/queries.js";
import { isOwnAgent } from "../../agents/lib/agent-editors.js";
import { useHarnessCatalog } from "../../sessions/api/session-pair.js";
import { prettyModelLabel } from "../../sessions/lib/model-families.js";
import { harnessDisplayName } from "../../sessions/lib/session-pair-options.js";
import { sessionSettingOptions } from "../../sessions/lib/session-settings.js";
import { profileSettings } from "../../sessions/lib/subagent-choice.js";
import { useCreateProfile } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the More options header of the picker: "Save as
 * profile" names the pick, or "Save as a new profile" when the pick came from
 * or matches an existing one, subagent included (D193B). It always creates a
 * profile; the picker has no Update action. Not offered on a shared agent,
 * whose editor uses the owner's profiles and never changes them. The dialog
 * renders outside the picker's popover, which an outside click closes.
 */
export function useSaveAsProfile({
  agentId,
  pair,
  providerTemplate,
  subagent = null,
  from,
  capability,
  onSaved,
}: {
  agentId: string | null;
  pair: SessionPair | null;
  providerTemplate: string | undefined;
  /** UNIT_BOUNDARY_DESCRIPTION: the subagent the profile carries (D193B), which a slot following the profile resolves to; null is "Same as agent". */
  subagent?: { providerTemplate: string; model: string } | null;
  from: { id: string; name: string } | null;
  capability: HarnessCapability | undefined;
  onSaved: (profile: { id: string; name: string }) => void;
}) {
  const agent = useAgent(agentId);
  const { data: catalog } = useHarnessCatalog();
  const nameId = useId();
  const create = useCreateProfile();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending;
  if (
    !agentId ||
    !pair?.model ||
    providerTemplate === undefined ||
    (agent !== null && !isOwnAgent(agent))
  )
    return { row: null, dialog: null };

  const effort = sessionSettingOptions(capability).find(
    (o) => o.category === "thought_level" && !o.subagents,
  );
  const effortValue = effort
    ? (pair.settings?.[effort.id] ?? effort.default)
    : undefined;
  const effortLabel = effortValue
    ? (effort?.choices.find((c) => c.value === effortValue)?.name ??
      effortValue)
    : undefined;
  const summary = [
    harnessDisplayName(pair.harness, catalog?.harnesses) ?? pair.harness,
    prettyModelLabel(pair.model) ?? pair.model,
    effortLabel,
    providerTemplate
      ? (shortNameForTemplate(providerTemplate) ?? providerTemplate)
      : undefined,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
  const subagentSummary = subagent
    ? `subagents on ${prettyModelLabel(subagent.model) ?? subagent.model}`
    : null;
  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return setError("Give the profile a name.");
    const body = {
      agentId,
      name: trimmed,
      harness: pair.harness,
      providerTemplate,
      model: pair.model ?? "",
      settings: profileSettings(pair, capability),
      subagent,
    };
    create.mutate(body, {
      onSuccess: (saved: { id: string; name: string }) => {
        setOpen(false);
        onSaved(saved);
      },
      onError: (err: { message: string }) => setError(err.message),
    });
  };
  const ask = () => {
    setName("");
    setError(null);
    setOpen(true);
  };
  const action =
    "text-left text-[13px] text-accent underline-offset-2 hover:underline";

  return {
    row: (
      <button type="button" onClick={ask} className={action}>
        {from ? "Save as a new profile" : "Save as profile"}
      </button>
    ),
    dialog: open && (
      <Modal onClose={() => !saving && setOpen(false)}>
        <DialogHeader
          onClose={() => setOpen(false)}
          closeDisabled={saving}
          title="Save as profile"
        />
        <DialogBody>
          <label htmlFor={nameId} className="mb-2 block text-sm">
            Name
          </label>
          <Input
            id={nameId}
            autoFocus
            aria-label="Profile name"
            placeholder="e.g. Deep review"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          {error && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">
            {summary}
            {subagentSummary ? ` · ${subagentSummary}` : ""}
          </p>
        </DialogBody>
        <DialogActions
          onCancel={() => setOpen(false)}
          cancelDisabled={saving}
          label="Save profile"
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
