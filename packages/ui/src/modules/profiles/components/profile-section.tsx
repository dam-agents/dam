import { Edit, TrashCan } from "@carbon/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/list-section";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { findAgent, useAgents } from "../../agents/api/queries.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { SessionPairTrigger } from "../../sessions/components/session-pair-trigger.js";
import { pairSummary } from "../../sessions/lib/session-settings.js";
import { isProfileSetting } from "../../sessions/lib/subagent-choice.js";
import { useDeleteProfile, useUpdateProfile } from "../api/mutations.js";
import { useProfiles } from "../api/queries.js";
import { profileProviderName } from "../lib/profile-detail.js";

/** UNIT_BOUNDARY_DESCRIPTION: the owner's profiles in Settings: what each runs, edited with the chat picker's Custom screen, how often it is used, rename, and a delete that names what still uses it. */
export function ProfileSection() {
  const { data: profiles = [], isPending } = useProfiles();
  const update = useUpdateProfile();
  const remove = useDeleteProfile();
  const showConfirm = useStore((s) => s.showConfirm);
  const agents = useAgents().data;
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
      const who = [
        ...usage.agents.map((a) => `the agent ${agentName(a.id)}`),
        ...usage.channels.map((c) => `the channel ${c.label}`),
        ...usage.schedules.map((s) => `the schedule “${s.name}”`),
      ].join(", ");
      void showConfirm(
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
      <SectionHeader label="Profiles" />
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
                    {profile.seeded && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        default
                      </span>
                    )}
                  </p>
                )}
                <ProfileValues
                  profile={profile}
                  fallbackAgent={agents?.list[0]?.id ?? null}
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {uses(profile) === 0 ? "unused" : `used ${uses(profile)}×`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${profile.name}`}
                onClick={() => startRename(profile)}
              >
                <Edit size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${profile.name}`}
                disabled={remove.isPending}
                onClick={() => void confirmDelete(profile)}
              >
                <TrashCan size={14} />
              </Button>
            </li>
          ))}
          {profiles.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No profiles yet. Save one from a chat’s model picker.
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
 * screen. Models are listed by an agent's runtime, so the picker borrows an
 * agent that uses the profile, else the owner's first; with none it only
 * shows the values. A pick updates the profile; a harness picked without a
 * model waits here until one is.
 */
function ProfileValues({
  profile,
  fallbackAgent,
}: {
  profile: ProfileWithUsage;
  fallbackAgent: string | null;
}) {
  const { data: usage } = useQuery({
    ...trpc.profiles.usage.queryOptions({ id: profile.id }),
    enabled: profile.usage.agents > 0,
  });
  const agentId = usage?.agents[0]?.id ?? fallbackAgent;
  const { data: status } = useHarnessConfigStatus(agentId);
  const providers = useProviderConnections(agentId);
  const update = useUpdateProfile();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [draft, setDraft] = useState<SessionPair | null>(null);
  const pair: SessionPair = draft ?? {
    harness: profile.harness,
    provider:
      providers.granted.find((p) => p.templateId === profile.providerTemplate)
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
      {agentId && status?.harnesses ? (
        <SessionPairPicker
          agentId={agentId}
          carried={status.harnesses}
          defaultHarness={status.defaultHarness ?? profile.harness}
          routed={status.modelRouter}
          onConnectProviders={() => navigateToSettings("providers")}
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
