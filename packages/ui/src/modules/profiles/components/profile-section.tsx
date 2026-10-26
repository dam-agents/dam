import { Edit, TrashCan } from "@carbon/icons-react";
import type { ProfileUsage, ProfileWithUsage } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/list-section";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { findAgent, useAgents } from "../../agents/api/queries.js";
import { useDeleteProfile, useUpdateProfile } from "../api/mutations.js";
import { useProfiles } from "../api/queries.js";
import { profileDetail } from "../lib/profile-detail.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's profiles in Settings: a list with what
 * each one runs and what points at it, a rename in place, and a delete that
 * names what would stop. A profile is created and edited where it is picked —
 * the chat picker's "Save as a profile" and "Update" — so this page opens on
 * what exists rather than being a second editor.
 */
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
    /* UNIT_BOUNDARY_DESCRIPTION: the field closes only once the server took the
     * name, so a refused rename keeps what was typed in front of the person who
     * typed it. */
    update.mutate(
      { id: profile.id, name: next },
      { onSuccess: () => setRenaming(null) },
    );
  };
  const confirmDelete = async (profile: ProfileWithUsage) => {
    if (uses(profile) > 0) {
      /* UNIT_BOUNDARY_DESCRIPTION: nothing to confirm, so the dialog names what
       * stands in the way — the agent, schedule or channel by name, not a count
       * — and offers no Delete the server would refuse. A usage read that fails
       * still says what it knows from the list, so the click is never a no-op. */
      const detail = await queryClient
        .fetchQuery(trpc.profiles.usage.queryOptions({ id: profile.id }))
        .catch(() => null);
      const who = detail
        ? usedBy(
            detail,
            (agentId) => findAgent(agents, agentId)?.name ?? agentId,
          )
        : `${uses(profile)} place${uses(profile) === 1 ? "" : "s"}`;
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
        A profile is a harness, model and settings you name once. Save one from
        a chat’s model picker, then point your defaults, channels and schedules
        at it.
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
                <p
                  className="truncate text-muted-foreground"
                  title={profileDetail(profile)}
                >
                  {profileDetail(profile)}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {usageLabel(profile)}
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

/** UNIT_BOUNDARY_DESCRIPTION: what points at a profile, named so the owner knows which agent, schedule or channel to move; an agent the list has not loaded yet keeps its id. */
function usedBy(
  usage: ProfileUsage,
  agentName: (agentId: string) => string,
): string {
  return [
    ...usage.agents.map(
      (agent) =>
        `${agent.slots.length > 1 ? "the agent defaults" : "the agent default"} of ${agentName(agent.id)}`,
    ),
    ...usage.channels.map((channel) => `the channel ${channel.label}`),
    ...usage.schedules.map((schedule) => `the schedule “${schedule.name}”`),
  ].join(", ");
}

function usageLabel(profile: ProfileWithUsage): string {
  const total =
    profile.usage.agents + profile.usage.channels + profile.usage.schedules;
  if (total === 0) return "unused";
  return `used ${total}×`;
}
