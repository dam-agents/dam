import { ChevronRight, Settings } from "@carbon/icons-react";
import type { ProfileWithUsage, SessionPair } from "api-server-api";

import { cn } from "@/lib/utils";

import { profileDetail } from "../api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile view a picker opens on. A row names the
 * profile and the model and provider it stands for; one that cannot run on this
 * agent is crossed out with the reason in its title, never hidden. The last row
 * leads to the full picker, and the cogwheel to the page that manages profiles.
 */
export function ProfileList({
  profiles,
  current,
  onPick,
  onCustom,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  current: SessionPair | null;
  onPick: (profile: ProfileWithUsage) => void;
  onCustom: () => void;
  onManage: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-6 items-center justify-between">
        <span className="px-2 text-xs text-muted-foreground">Profile</span>
        <button
          type="button"
          aria-label="Manage profiles"
          title="Manage profiles"
          onClick={onManage}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings size={14} />
        </button>
      </div>
      <ul className="flex flex-col">
        {profiles.map((profile) => {
          const unavailable = profile.availability?.available === false;
          const selected = current !== null && sameAsProfile(current, profile);
          return (
            <li key={profile.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                aria-disabled={unavailable ? true : undefined}
                disabled={unavailable}
                title={profile.availability?.reason ?? profileDetail(profile)}
                onClick={() => onPick(profile)}
                className={cn(
                  "flex w-full min-w-0 flex-col rounded px-2 py-1 text-left hover:bg-muted",
                  unavailable && "line-through opacity-60",
                  selected && "font-medium text-foreground",
                )}
              >
                <span className="truncate">{profile.name}</span>
                <span className="truncate text-xs text-muted-foreground no-underline">
                  {unavailable
                    ? (profile.availability?.reason ?? profileDetail(profile))
                    : profileDetail(profile)}
                </span>
              </button>
            </li>
          );
        })}
        {profiles.length === 0 && (
          <li className="px-2 py-1 text-muted-foreground">
            No profiles yet. Pick a model below and save it as one.
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={onCustom}
        className="mt-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Custom
        <ChevronRight size={14} aria-hidden />
      </button>
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a profile is selected while the picker's values are the ones it resolves to; a tune of any of them reads as a custom pick. */
function sameAsProfile(pair: SessionPair, profile: ProfileWithUsage): boolean {
  const settings = (value: Readonly<Record<string, string>> | undefined) =>
    JSON.stringify(Object.entries(value ?? {}).sort());
  return (
    pair.harness === profile.harness &&
    pair.model === profile.model &&
    settings(pair.settings) === settings(profile.settings)
  );
}
