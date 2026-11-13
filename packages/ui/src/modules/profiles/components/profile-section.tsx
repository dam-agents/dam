import { Add } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { shortNameForTemplate } from "api-server-api";
import { useRef, useState } from "react";

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
import { SessionModelPicker } from "../../sessions/components/session-model-picker.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { SessionPairTrigger } from "../../sessions/components/session-pair-trigger.js";
import {
  type ProviderConnectionRef,
  providerOfModel,
} from "../../sessions/lib/session-pair-options.js";
import { pairSummary } from "../../sessions/lib/session-settings.js";
import {
  profileEditPair,
  profileSettings,
  subagentOf,
} from "../../sessions/lib/subagent-choice.js";
import {
  useCreateProfile,
  useDeleteProfile,
  useUpdateProfile,
} from "../api/mutations.js";
import { useProfiles } from "../api/queries.js";
import {
  profileProviderName,
  profileUses,
  sortProfiles,
  usedBy,
} from "../lib/profile-detail.js";
import { RenameProfileDialog } from "./rename-profile-dialog.js";

/** UNIT_BOUNDARY_DESCRIPTION: the owner's profiles in Settings: what each runs, edited with the chat picker's Custom screen, how often it is used, rename, and a delete that names what still uses it. */
export function ProfileSection({
  openProfileId = null,
}: {
  /** UNIT_BOUNDARY_DESCRIPTION: a deep link to one profile opens that row's editor. */
  openProfileId?: string | null;
} = {}) {
  const { data: profiles = [], isPending } = useProfiles();
  const remove = useDeleteProfile();
  const showConfirm = useStore((s) => s.showConfirm);
  const showAlert = useStore((s) => s.showAlert);
  const agents = useAgents().data;
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProfileWithUsage | null>(null);
  const renameAfterMenu = useRef<ProfileWithUsage | null>(null);
  const confirmDelete = async (profile: ProfileWithUsage) => {
    if (profileUses(profile) > 0) {
      const usage = await queryClient.fetchQuery(
        trpc.profiles.usage.queryOptions({ id: profile.id }),
      );
      const agentName = (id: string) => findAgent(agents, id)?.name ?? id;
      const who = usedBy({
        agents: usage.agents.map((a) => agentName(a.id)),
        channels: usage.channels.map((c) => c.label),
        schedules: usage.schedules.map((s) => `“${s.name}”`),
        artifacts: (usage.artifacts ?? []).map((a) => `“${a.title}”`),
      });
      void showAlert(
        `It is used by ${who}. Move ${profileUses(profile) === 1 ? "it" : "them"} to another profile first.`,
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
      {creating && <NewProfileDialog onClose={() => setCreating(false)} />}
      {renaming && (
        <RenameProfileDialog
          profile={renaming}
          onClose={() => setRenaming(null)}
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
          {sortProfiles(profiles).map((profile) => (
            <li
              key={profile.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {profile.name}
                </p>
                <ProfileValues
                  profile={profile}
                  defaultOpen={profile.id === openProfileId}
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {profileUses(profile) === 0
                  ? "unused"
                  : `used ${profileUses(profile)}×`}
              </span>
              <RowActionsMenu
                label={`Actions for ${profile.name}`}
                contentProps={{
                  onCloseAutoFocus: (e) => {
                    // UNIT_BOUNDARY_DESCRIPTION: Rename opens its dialog only once the menu has handed focus back to its button, so the dialog returns focus there on close; the menu item it was picked from is gone by then.
                    if (!renameAfterMenu.current) return e.preventDefault();
                    setRenaming(renameAfterMenu.current);
                    renameAfterMenu.current = null;
                  },
                }}
              >
                <DropdownMenuItem
                  onSelect={() => (renameAfterMenu.current = profile)}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  tone="danger"
                  disabled={remove.isPending}
                  onSelect={() => void confirmDelete(profile)}
                >
                  Delete
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a profile's values on the chat picker's own body.
 * Models and harness settings come from the owner-level catalog, so no agent
 * is needed; until it loads it only shows the values. A pick updates the
 * profile, subagent included; a harness picked without a model waits in the
 * open picker until one is, and closing the picker drops it, so the row never
 * shows an unsaved harness as the profile's.
 */
function ProfileValues({
  profile,
  defaultOpen = false,
}: {
  profile: ProfileWithUsage;
  defaultOpen?: boolean;
}) {
  const { data: status } = useQuery(trpc.connections.catalog.queryOptions());
  const providers = useProviderConnections(null);
  const update = useUpdateProfile();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [draft, setDraft] = useState<SessionPair | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const pair: SessionPair =
    draft ??
    profileEditPair(
      profile,
      providers.owned.find((p) => p.templateId === profile.providerTemplate)
        ?.id ?? null,
    );
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
        settings: profileSettings(
          next,
          status?.harnesses?.find((h) => h.name === next.harness),
        ),
        subagent: profileSubagentField(next, providers.owned),
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
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next && draft?.model === null) setDraft(null);
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
            provider:
              shortNameForTemplate(profile.providerTemplate) ??
              profileProviderName(profile),
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
 * Custom screen every pick uses, listing every provider the owner holds. It
 * opens on the owner's default for new agents, which is what a profile made
 * without a reason of its own should run.
 */
function NewProfileDialog({ onClose }: { onClose: () => void }) {
  const { data: status } = useQuery(trpc.connections.catalog.queryOptions());
  const { data: chosen } = useQuery(
    trpc.profiles.newAgentDefault.queryOptions(),
  );
  const providers = useProviderConnections(null);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const create = useCreateProfile();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SessionPair | null>(null);
  const defaultPair = chosen ? (chosen.pair ?? chosen.base) : null;
  const pair = draft ?? defaultPair;
  const providerTemplate = providers.owned.find(
    (p) => p.id === pair?.provider,
  )?.templateId;
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
        settings: profileSettings(
          pair,
          status?.harnesses?.find((h) => h.name === pair.harness),
        ),
        subagent: profileSubagentField(pair, providers.owned),
      },
      { onSuccess: onClose, onError: (err) => setError(err.message) },
    );
  };
  return (
    <Modal onClose={() => !create.isPending && onClose()}>
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
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </FormField>
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-1 text-sm">
          {status?.harnesses?.length ? (
            <SessionModelPicker
              agentId={null}
              carried={status.harnesses}
              harnesses={status.harnesses.map((h) => h.name)}
              pair={pair}
              defaultHarness={status.defaultHarness}
              defaultPair={defaultPair}
              onChoose={setDraft}
              onManageProviders={() => {
                if (create.isPending) return;
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

/** UNIT_BOUNDARY_DESCRIPTION: the subagent a profile edit or creation carries (D193B), its provider named by the Connection the model runs on; null is "Same as agent". */
function profileSubagentField(
  pair: SessionPair,
  providers: readonly ProviderConnectionRef[],
): { providerTemplate: string; model: string } | null {
  const subagent = subagentOf(pair);
  const template = providerOfModel(subagent?.model, providers)?.templateId;
  return subagent && template
    ? { providerTemplate: template, model: subagent.model }
    : null;
}
