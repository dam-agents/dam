import { Edit, TrashCan } from "@carbon/icons-react";
import type { ProfileWithUsage } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/list-section";

import { useStore } from "../../../store.js";
import { useDeleteProfile, useUpdateProfile } from "../api/mutations.js";
import { profileDetail, useProfiles } from "../api/queries.js";

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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  const startRename = (profile: ProfileWithUsage) => {
    setRenaming(profile.id);
    setName(profile.name);
  };
  const commitRename = (profile: ProfileWithUsage) => {
    const next = name.trim();
    setRenaming(null);
    if (next === "" || next === profile.name) return;
    update.mutate({ id: profile.id, name: next });
  };
  const confirmDelete = (profile: ProfileWithUsage) => {
    const usage = [
      profile.usage.agents > 0 &&
        `${profile.usage.agents} agent default${profile.usage.agents === 1 ? "" : "s"}`,
      profile.usage.channels > 0 && `${profile.usage.channels} channel`,
      profile.usage.schedules > 0 &&
        `${profile.usage.schedules} schedule${profile.usage.schedules === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (usage.length > 0) {
      void showConfirm(
        `It is used by ${usage.join(", ")}. Move them to another profile first.`,
        `Delete “${profile.name}”?`,
        { kind: "destructive", confirmLabel: "Delete" },
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
                {usedBy(profile)}
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
                onClick={() => confirmDelete(profile)}
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

function usedBy(profile: ProfileWithUsage): string {
  const total =
    profile.usage.agents + profile.usage.channels + profile.usage.schedules;
  if (total === 0) return "unused";
  return `used ${total}×`;
}
