import { Checkmark, ChevronRight, Settings } from "@carbon/icons-react";
import type { ProfileWithUsage } from "api-server-api";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

import { useProfileAttach } from "../hooks/use-profile-attach.js";
import { profileDetail } from "../lib/profile-detail.js";

export interface ProfileSlot {
  selectedId: string | null;
  /** UNIT_BOUNDARY_DESCRIPTION: the values the slot holds when no profile matches them, shown on its Custom selection row; null while a profile or the agent picks. */
  custom: ReactNode | null;
  onPick: (profile: ProfileWithUsage) => void;
  onCustom: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a chat picker opens on: the profiles for the
 * primary model and for subagents, each ending in Custom selection. A profile
 * that cannot run on the agent stays listed, disabled, with its reason and the
 * one action that fixes it; picking one whose provider the owner holds grants
 * it first.
 */
export function ModelConfiguration({
  agentId,
  profiles,
  primary,
  subagent,
  customHint,
  onAgentPicks,
}: {
  agentId: string;
  profiles: readonly ProfileWithUsage[];
  primary: ProfileSlot;
  subagent: ProfileSlot;
  customHint: string;
  onAgentPicks: () => void;
}) {
  const { attach, manage } = useProfileAttach(agentId);
  const choices = (slot: ProfileSlot) => (
    <>
      <ProfileChoices
        profiles={profiles}
        selectedId={slot.selectedId}
        onPick={slot.onPick}
        onAttach={(profile) =>
          void attach(profile).then((ok) => ok && slot.onPick(profile))
        }
        onManage={manage}
      />
      <CustomRow
        label="Custom selection"
        detail={slot.custom ?? customHint}
        selected={slot.custom !== null}
        onClick={slot.onCustom}
      />
    </>
  );
  const [revealed, setRevealed] = useState(
    subagent.selectedId !== null || subagent.custom !== null,
  );
  const agentPicks =
    subagent.selectedId === null && subagent.custom === null && !revealed;
  return (
    <div className="flex flex-col">
      <SectionHeading
        action={
          <button
            type="button"
            aria-label="Configure providers"
            title="Configure providers"
            onClick={manage}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings size={14} />
          </button>
        }
      >
        Primary model
      </SectionHeading>
      {choices(primary)}
      <SectionHeading>Subagent model</SectionHeading>
      <label className="flex items-center gap-2 px-2 py-1 text-sm text-foreground">
        <input
          type="checkbox"
          checked={agentPicks}
          onChange={(e) => {
            setRevealed(!e.target.checked);
            if (e.target.checked) onAgentPicks();
          }}
        />
        Let the agent pick
      </label>
      {!agentPicks && choices(subagent)}
    </div>
  );
}

function SectionHeading({
  children,
  action,
}: {
  children: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-6 items-center justify-between px-2 pt-1">
      <h3 className="truncate text-2xs font-medium uppercase leading-[17px] tracking-[1.65px] text-muted-foreground">
        {children}
      </h3>
      {action}
    </div>
  );
}

export function ProfileChoices({
  profiles,
  selectedId,
  onPick,
  onAttach,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  selectedId: string | null;
  onPick: (profile: ProfileWithUsage) => void;
  onAttach: (profile: ProfileWithUsage) => void;
  onManage: () => void;
}) {
  if (profiles.length === 0)
    return (
      <p className="px-2 py-1 text-muted-foreground">
        No profiles yet. Pick a model in Custom selection and save it as one.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {profiles.map((profile) => {
        const { available, attachable, reason } = profile.availability ?? {
          available: true,
          attachable: false,
          reason: null,
        };
        const selected = profile.id === selectedId;
        return (
          <li
            key={profile.id}
            className={cn(
              "flex items-end gap-2 rounded hover:bg-muted",
              selected && "bg-muted",
            )}
          >
            <button
              type="button"
              aria-current={selected || undefined}
              disabled={!available}
              title={reason ?? profileDetail(profile)}
              onClick={() => (attachable ? onAttach(profile) : onPick(profile))}
              className="flex min-w-0 flex-1 flex-col px-2 py-1 text-left disabled:pointer-events-none disabled:opacity-60"
            >
              <span className={cn("truncate", selected && "font-medium")}>
                {profile.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {reason ?? profileDetail(profile)}
              </span>
            </button>
            {!available || attachable ? (
              <button
                type="button"
                onClick={() => (attachable ? onAttach(profile) : onManage())}
                className="shrink-0 px-2 py-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                {attachable ? "Connect this provider" : "Configure providers"}
              </button>
            ) : (
              selected && (
                <Checkmark
                  size={16}
                  aria-hidden
                  className="mr-2 shrink-0 self-center"
                />
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CustomRow({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "mt-1 flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted",
        selected && "bg-muted",
      )}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-foreground",
            selected && "font-medium",
          )}
        >
          {label}
        </span>
        {detail && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {selected && <Checkmark size={16} aria-hidden />}
        <ChevronRight size={14} aria-hidden />
      </span>
    </button>
  );
}
