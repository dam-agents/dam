import { Checkmark, ChevronRight, Settings } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage } from "api-server-api";
import { type ReactNode, useId, useState } from "react";

import { cn } from "@/lib/utils";

import { PairSummary } from "../../sessions/components/session-pair-trigger.js";
import { useProfileAttach } from "../hooks/use-profile-attach.js";
import { profileSummary } from "../lib/profile-detail.js";

export interface ProfileSlot {
  selectedId: string | null;
  /** UNIT_BOUNDARY_DESCRIPTION: the values the slot holds when no profile matches them, shown on its Custom selection row; null while a profile or the agent picks. */
  custom: ReactNode | null;
  /** UNIT_BOUNDARY_DESCRIPTION: `connectionId` is the provider a pick just granted, which the agent's grant list does not show yet. */
  onPick: (profile: ProfileWithUsage, connectionId?: string) => void;
  onCustom: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a chat picker opens on: the profiles for the
 * primary model and for subagents, each ending in Custom selection. The
 * subagent slot's choices sit behind the checkbox on its heading: unchecked,
 * the agent picks; checked with nothing picked yet, the slot stays the
 * agent's until a row is. A profile on a provider the owner holds but the
 * agent lacks reads like any other, and picking it asks to connect that
 * provider; one that cannot run at all stays listed, disabled, with its
 * reason and the action that fixes it.
 */
export function ModelConfiguration({
  agentId,
  profiles,
  carried,
  primary,
  subagent,
  customHint,
  onAgentPicks,
}: {
  agentId: string | null;
  profiles: readonly ProfileWithUsage[];
  carried: readonly HarnessCapability[];
  primary: ProfileSlot;
  subagent: ProfileSlot;
  customHint: string;
  onAgentPicks: () => void;
}) {
  const { attach, manage } = useProfileAttach(agentId);
  const choices = (slot: ProfileSlot) => (
    <>
      {profiles.length > 0 && (
        <ProfileChoices
          profiles={profiles}
          carried={carried}
          selectedId={slot.selectedId}
          onPick={slot.onPick}
          onAttach={(profile) =>
            void attach(profile).then((id) => id && slot.onPick(profile, id))
          }
          onManage={manage}
        />
      )}
      <CustomRow
        label="Custom selection"
        detail={slot.custom ?? customHint}
        selected={slot.custom !== null}
        onClick={slot.onCustom}
      />
    </>
  );
  const picked = subagent.selectedId !== null || subagent.custom !== null;
  const [revealed, setRevealed] = useState(false);
  const subagentId = useId();
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
      <SectionHeading htmlFor={subagentId} className="mt-2">
        <input
          id={subagentId}
          type="checkbox"
          checked={picked || revealed}
          onChange={(e) => {
            setRevealed(e.target.checked);
            if (!e.target.checked && picked) onAgentPicks();
          }}
          className="mr-2 align-middle"
        />
        Subagent model
      </SectionHeading>
      {(picked || revealed) && choices(subagent)}
    </div>
  );
}

function SectionHeading({
  children,
  action,
  htmlFor,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** UNIT_BOUNDARY_DESCRIPTION: the heading labels the checkbox it holds. */
  htmlFor?: string;
  className?: string;
}) {
  const text =
    "truncate text-2xs font-medium uppercase leading-[17px] tracking-[1.65px] text-muted-foreground";
  return (
    <div
      className={cn(
        "flex h-6 items-center justify-between px-2 pt-1",
        className,
      )}
    >
      <h3 className={text}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer">
            {children}
          </label>
        ) : (
          children
        )}
      </h3>
      {action}
    </div>
  );
}

export function ProfileChoices({
  profiles,
  carried,
  selectedId,
  onPick,
  onAttach,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  carried: readonly HarnessCapability[];
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
        /* UNIT_BOUNDARY_DESCRIPTION: a provider the owner holds and the agent lacks is a pick like any other; only the connect dialog the pick opens says so. */
        const note = available ? null : reason;
        const selected = profile.id === selectedId;
        const summary = profileSummary(
          profile,
          carried.find((h) => h.name === profile.harness),
        );
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
              title={note ?? summary}
              onClick={() => (attachable ? onAttach(profile) : onPick(profile))}
              className="flex min-w-0 flex-1 flex-col px-2 py-1 text-left disabled:pointer-events-none disabled:opacity-60"
            >
              <span
                className={cn(
                  "truncate",
                  selected && "font-medium",
                  !available && "text-muted-foreground",
                )}
              >
                {profile.name}
              </span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                {note ? (
                  <span className="whitespace-normal">{note}</span>
                ) : (
                  <PairSummary harness={profile.harness} label={summary} />
                )}
              </span>
            </button>
            {!available ? (
              <button
                type="button"
                onClick={onManage}
                className="shrink-0 px-2 py-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                Configure providers
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
