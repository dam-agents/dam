import { Add } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/list-section";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { findAgent, useAgents } from "../../agents/api/queries.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import { CustomPairScreen } from "../../sessions/components/custom-pair-screen.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { SessionPairTrigger } from "../../sessions/components/session-pair-trigger.js";
import { pairSummary } from "../../sessions/lib/session-settings.js";
import { isProfileSetting } from "../../sessions/lib/subagent-choice.js";
import {
  useCreateProfile,
  useDeleteProfile,
  useSetDefaultProfile,
  useUpdateProfile,
} from "../api/mutations.js";
import { useProfiles } from "../api/queries.js";
import { profileProviderName, usedBy } from "../lib/profile-detail.js";

/** UNIT_BOUNDARY_DESCRIPTION: the owner's profiles in Settings: what each runs, edited with the chat picker's Custom screen, how often it is used, rename, and a delete that names what still uses it. */
export function ProfileSection() {
  const { data: profiles = [], isPending } = useProfiles();
  const update = useUpdateProfile();
  const remove = useDeleteProfile();
  const setDefault = useSetDefaultProfile();
  const showConfirm = useStore((s) => s.showConfirm);
  const showAlert = useStore((s) => s.showAlert);
  const agents = useAgents().data;
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  const startRename = (profile: ProfileWithUsage) => {
    setRenaming(profile.id);
    setName(profile.name);
  };
  const commitRename = (profile: ProfileWithUsage) => {
    const next = name.trim();
    if (next === "" || next === profile.name) {
      setRenaming(null);
      return;
    }
    update.mutate(
      { id: profile.id, name: next },
      { onSuccess: () => setRenaming(null) },
    );
  };
  const confirmDelete = async (profile: ProfileWithUsage) => {
    if (uses(profile) > 0) {
      const usage = await queryClient.fetchQuery(
        trpc.profiles.usage.queryOptions({ id: profile.id }),
      );
      const agentName = (id: string) => findAgent(agents, id)?.name ?? id;
      const who = usedBy({
        agents: usage.agents.map((a) => agentName(a.id)),
        channels: usage.channels.map((c) => c.label),
        schedules: usage.schedules.map((s) => `“${s.name}”`),
      });
      void showAlert(
        `It is used by ${who}. Move ${uses(profile) === 1 ? "it" : "them"} to another profile first.`,
        `“${profile.name}” cannot be deleted`,
        { confirmLabel: "Close" },
      );
      return;
    }
    void showConfirm("It cannot be recovered.", `Delete “${profile.name}”?`, {
      kind: "destructive",
      confirmLabel: "Delete",
    }).then((ok) => ok && remove.mutate({ id: profile.id }));
  };

  return (
    <section className="mb-8">
      <SectionHeader label="Profiles">
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Add size={14} aria-hidden />
          New profile
        </Button>
      </SectionHeader>
      {creating && (
        <NewProfileDialog
          from={profiles.find((p) => p.newAgentDefault) ?? profiles[0] ?? null}
          onClose={() => setCreating(false)}
        />
      )}
      <p className="mb-3 text-sm text-muted-foreground">
        Save harness, provider and model settings as profiles to quickly set and
        change them in agents. Update a profile here to quickly change settings
        on all agents using that profile.
      </p>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading profiles…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                {renaming === profile.id ? (
                  <Input
                    autoFocus
                    value={name}
                    aria-label={`Name for ${profile.name}`}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => commitRename(profile)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(profile);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <p className="truncate font-medium text-foreground">
                    {profile.name}
                    {profile.newAgentDefault && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Default for new agents
                      </span>
                    )}
                  </p>
                )}
                <ProfileValues profile={profile} />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {uses(profile) === 0 ? "unused" : `used ${uses(profile)}×`}
              </span>
              <RowActionsMenu
                label={`Actions for ${profile.name}`}
                contentProps={{
                  onCloseAutoFocus: (e) => e.preventDefault(),
                }}
              >
                <DropdownMenuItem onSelect={() => startRename(profile)}>
                  Rename
                </DropdownMenuItem>
                {!profile.newAgentDefault && (
                  <DropdownMenuItem
                    disabled={setDefault.isPending}
                    onSelect={() => setDefault.mutate({ id: profile.id })}
                  >
                    Set as default for new agents
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  tone="danger"
                  disabled={profile.newAgentDefault || remove.isPending}
                  onSelect={() => void confirmDelete(profile)}
                >
                  {profile.newAgentDefault ? "Can't remove default" : "Delete"}
                </DropdownMenuItem>
              </RowActionsMenu>
            </li>
          ))}
          {profiles.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No profiles yet. Create one here or save one from a chat’s model
              picker.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const uses = (profile: ProfileWithUsage): number =>
  profile.usage.agents + profile.usage.channels + profile.usage.schedules;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a profile's values on the chat picker's Custom
 * screen. Models and harness settings come from the owner-level catalog, so
 * no agent is needed; until it loads it only shows the values. A pick updates
 * the profile; a harness picked without a model waits in the open picker
 * until one is, and closing the picker drops it, so the row never shows an
 * unsaved harness as the profile's.
 */
function ProfileValues({ profile }: { profile: ProfileWithUsage }) {
  const { data: status } = useQuery(trpc.connections.catalog.queryOptions());
  const providers = useProviderConnections(null);
  const update = useUpdateProfile();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [draft, setDraft] = useState<SessionPair | null>(null);
  const pair: SessionPair = draft ?? {
    harness: profile.harness,
    provider:
      providers.owned.find((p) => p.templateId === profile.providerTemplate)
        ?.id ?? null,
    model: profile.model,
    settings: profile.settings,
  };
  const save = (next: SessionPair) => {
    setDraft(next);
    if (next.model === null) return;
    update.mutate(
      {
        id: profile.id,
        harness: next.harness,
        providerTemplate:
          providers.owned.find((p) => p.id === next.provider)?.templateId ??
          profile.providerTemplate,
        model: next.model,
        settings: Object.fromEntries(
          Object.entries(next.settings ?? {}).filter(([id]) =>
            isProfileSetting(
              id,
              status?.harnesses?.find((h) => h.name === next.harness),
            ),
          ),
        ),
      },
      { onSettled: () => setDraft(null) },
    );
  };
  return (
    <div className="-ml-3 flex min-w-0 flex-col">
      {status?.harnesses?.length ? (
        <SessionPairPicker
          agentId={null}
          carried={status.harnesses}
          defaultHarness={status.defaultHarness ?? profile.harness}
          routed={status.modelRouter}
          onConnectProviders={() => navigateToSettings("providers")}
          onOpenChange={(open) => {
            if (!open && draft?.model === null) setDraft(null);
          }}
          edit={{
            pair,
            providerName: profileProviderName(profile),
            onChoose: save,
          }}
        />
      ) : (
        <SessionPairTrigger
          harness={profile.harness}
          disabled
          label={pairSummary(profile.model, {
            settings: profile.settings,
            provider: profileProviderName(profile),
          })}
        />
      )}
      {update.error && (
        <p role="alert" className="pl-3 text-xs text-destructive">
          {update.error.message}
        </p>
      )}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a profile made in Settings: a name and the same
 * Custom screen every pick uses, listing every provider the owner holds,
 * starting from the default profile's values.
 */
function NewProfileDialog({
  from,
  onClose,
}: {
  from: ProfileWithUsage | null;
  onClose: () => void;
}) {
  const { data: status } = useQuery(trpc.connections.catalog.queryOptions());
  const providers = useProviderConnections(null);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const create = useCreateProfile();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState<SessionPair | null>(
    from && {
      harness: from.harness,
      provider:
        providers.owned.find((p) => p.templateId === from.providerTemplate)
          ?.id ?? null,
      model: from.model,
      settings: from.settings,
    },
  );
  const providerTemplate =
    providers.owned.find((p) => p.id === pair?.provider)?.templateId ??
    (pair?.model === from?.model ? from?.providerTemplate : undefined);
  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return setError("Give the profile a name.");
    if (!pair?.model || !providerTemplate) return setError("Pick a model.");
    create.mutate(
      {
        name: trimmed,
        harness: pair.harness,
        providerTemplate,
        model: pair.model,
        settings: Object.fromEntries(
          Object.entries(pair.settings ?? {}).filter(([id]) =>
            isProfileSetting(
              id,
              status?.harnesses?.find((h) => h.name === pair.harness),
            ),
          ),
        ),
      },
      { onSuccess: onClose, onError: (err) => setError(err.message) },
    );
  };
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        onClose={onClose}
        closeDisabled={create.isPending}
        title="New profile"
      />
      <DialogBody>
        <FormField label="Name" error={error ?? undefined}>
          <Input
            autoFocus
            aria-label="Profile name"
            placeholder="e.g. Fast review"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-1 text-sm">
          {status?.harnesses?.length ? (
            <CustomPairScreen
              agentId={null}
              carried={status.harnesses}
              harnesses={status.harnesses.map((h) => h.name)}
              pair={pair}
              defaultHarness={status.defaultHarness}
              inline
              onChoose={setPair}
              onManageProviders={() => {
                onClose();
                navigateToSettings("providers");
              }}
            />
          ) : (
            <p className="px-2 py-1 text-muted-foreground">Loading models…</p>
          )}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={create.isPending}
        label="Save profile"
        pendingLabel="Saving…"
        pending={create.isPending}
        onSubmit={save}
      />
    </Modal>
  );
}
