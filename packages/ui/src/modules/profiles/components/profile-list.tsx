import { ChevronRight, Save, Settings } from "@carbon/icons-react";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { profileDetail } from "../lib/profile-detail.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model configuration a picker opens on. Two
 * sections of the same weight — the primary model and the subagent model — then
 * the row that leads to the full picker. A profile that cannot run here stays
 * where it is, disabled, and says why, with the one action that would fix it.
 */
export function ProfileList({
  profiles,
  current,
  counts,
  onPick,
  onCustom,
  onAttach,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  current: SessionPair | null;
  counts: { harnesses: number };
  onPick: (profile: ProfileWithUsage) => void;
  onCustom: () => void;
  onAttach: (profile: ProfileWithUsage) => void;
  onManage: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-6 items-center justify-between">
        <span className="px-2 text-xs text-muted-foreground">
          Model configuration
        </span>
        <button
          type="button"
          aria-label="Configure providers"
          title="Configure providers"
          onClick={onManage}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings size={14} />
        </button>
      </div>
      <SectionHeading>Primary model</SectionHeading>
      <ProfileChoices
        profiles={profiles}
        current={current}
        onPick={onPick}
        onAttach={onAttach}
        onManage={onManage}
      />
      <button
        type="button"
        onClick={onCustom}
        className="mt-1 flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
      >
        <span className="min-w-0">
          <span className="block truncate text-foreground">
            Custom selection
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {/* UNIT_BOUNDARY_DESCRIPTION: one count, of the harnesses the agent
             * can run — a model count beside it is one harness's, which reads
             * as a count of every harness's (QA). */}
            {current === null || profiles.some((p) => sameAsProfile(current, p))
              ? `${counts.harnesses} harness${counts.harnesses === 1 ? "" : "es"}`
              : selectionLabel(current)}
          </span>
        </span>
        <ChevronRight size={14} aria-hidden className="mt-0.5 shrink-0" />
      </button>
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: one heading size for both sections, so the subagent choice reads as the same kind of setting as the primary one. */
export function SectionHeading({ children }: { children: string }) {
  return (
    <div className="flex h-6 items-center px-2 pt-1">
      <h3 className="truncate text-2xs font-medium uppercase leading-[17px] tracking-[1.65px] text-muted-foreground">
        {children}
      </h3>
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the rows a section offers. A profile that cannot run on this agent is disabled, keeps its normal styling, and shows why with the action that would fix it — attach a provider the owner already holds, or open the page that connects one. */
export function ProfileChoices({
  profiles,
  current,
  selectedId = null,
  onPick,
  onAttach,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  current: SessionPair | null;
  /* UNIT_BOUNDARY_DESCRIPTION: the subagent slot has no pair of its own, so it names the selected profile outright. */
  selectedId?: string | null;
  onPick: (profile: ProfileWithUsage) => void;
  onAttach: (profile: ProfileWithUsage) => void;
  onManage: () => void;
}) {
  return (
    <ul className="flex flex-col">
      {profiles.map((profile) => {
        const unavailable = profile.availability?.available === false;
        /* UNIT_BOUNDARY_DESCRIPTION: a profile whose provider the owner holds and
         * the agent does not is one pick away from running, so the row offers the
         * repair and the pick makes it — the same one click, whether or not the
         * profile reads as available (QA D3). */
        const attachable = profile.availability?.attachable === true;
        const selected =
          profile.id === selectedId ||
          (current !== null && sameAsProfile(current, profile));
        return (
          <li key={profile.id} className="flex flex-col">
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              aria-disabled={unavailable ? true : undefined}
              disabled={unavailable}
              title={profile.availability?.reason ?? profileDetail(profile)}
              onClick={() => (attachable ? onAttach(profile) : onPick(profile))}
              className={cn(
                "flex w-full min-w-0 flex-col rounded px-2 py-1 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60",
                selected && "font-medium text-foreground",
              )}
            >
              <span className="truncate">{profile.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {unavailable
                  ? (profile.availability?.reason ?? profileDetail(profile))
                  : attachable
                    ? "Connect its provider to run it here"
                    : profileDetail(profile)}
              </span>
            </button>
            {(unavailable || attachable) && (
              <button
                type="button"
                onClick={() => (attachable ? onAttach(profile) : onManage())}
                className="self-start px-2 pb-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                {attachable ? "Connect this provider" : "Configure providers"}
              </button>
            )}
          </li>
        );
      })}
      {profiles.length === 0 && (
        <li className="px-2 py-1 text-muted-foreground">
          No profiles yet. Pick a model in Custom selection and save it as one.
        </li>
      )}
    </ul>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one choice for both kinds of subagent, behind a
 * toggle that lets the agent pick. Off, the same rows the primary model offers
 * appear again; the values each kind of subagent takes from the pick are the
 * resolution rule's, not the picker's.
 */
export function SubagentSection({
  profiles,
  selectedId,
  onAgentPicks,
  onPick,
  onAttach,
  onManage,
}: {
  profiles: readonly ProfileWithUsage[];
  selectedId: string | null;
  onAgentPicks: (on: boolean) => void;
  onPick: (profile: ProfileWithUsage) => void;
  onAttach: (profile: ProfileWithUsage) => void;
  onManage: () => void;
}) {
  /* UNIT_BOUNDARY_DESCRIPTION: the toggle reveals the list without choosing
   * anything, so turning it off and walking away still leaves the agent to
   * pick; checking it again clears the choice. */
  const [revealed, setRevealed] = useState(selectedId !== null);
  return (
    <div className="flex flex-col">
      <SectionHeading>Subagent model</SectionHeading>
      <label className="flex items-center gap-2 px-2 py-1 text-sm text-foreground">
        <input
          type="checkbox"
          aria-label="Let the agent pick"
          checked={selectedId === null && !revealed}
          onChange={(e) => {
            setRevealed(!e.target.checked);
            if (e.target.checked) onAgentPicks(true);
          }}
        />
        Let the agent pick
      </label>
      {(revealed || selectedId !== null) && (
        <ProfileChoices
          profiles={profiles}
          current={null}
          selectedId={selectedId}
          onPick={onPick}
          onAttach={onAttach}
          onManage={onManage}
        />
      )}
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the button the full picker carries at its foot — the only place a profile is created or updated, since that is where the values are. */
export function SaveAsProfileRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Save size={14} aria-hidden />
      {label}
    </button>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a profile is selected while the picker's values are the ones it resolves to; a tune of any of them reads as a custom pick. */
export function sameAsProfile(
  pair: SessionPair,
  profile: ProfileWithUsage,
): boolean {
  const settings = (value: Readonly<Record<string, string>> | undefined) =>
    JSON.stringify(Object.entries(value ?? {}).sort());
  return (
    pair.harness === profile.harness &&
    pair.model === profile.model &&
    settings(pair.settings) === settings(profile.settings)
  );
}

const selectionLabel = (pair: SessionPair): string =>
  [pair.harness, pair.model ?? "no model"].filter(Boolean).join(" · ");
