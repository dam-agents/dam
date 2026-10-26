import { ChevronDown } from "@carbon/icons-react";
import type { ProfileWithUsage } from "api-server-api";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useProfiles } from "../api/queries.js";
import { useProfileAttach } from "../hooks/use-profile-attach.js";
import { profileDetail } from "../lib/profile-detail.js";
import { CustomRow, ProfileChoices } from "./profile-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a channel or a schedule runs on, as a
 * control in its row or form. A pick whose provider the agent lacks grants it
 * first and is made only if that worked, so nothing is saved on a profile its
 * runs would refuse.
 */
export function ProfilePicker({
  agentId,
  label,
  value,
  placeholder,
  showLabel = true,
  custom,
  onPick,
  disabled = false,
  testId,
}: {
  agentId: string;
  label: string;
  value: string | null;
  placeholder: string;
  showLabel?: boolean;
  custom?: { description: string; onCustom: () => void };
  onPick: (profile: ProfileWithUsage) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const { data: profiles = [] } = useProfiles(agentId);
  const { attach, manage } = useProfileAttach(agentId);
  const [open, setOpen] = useState(false);
  const selected = profiles.find((p) => p.id === value) ?? null;
  const pick = (profile: ProfileWithUsage) => {
    setOpen(false);
    onPick(profile);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          data-testid={testId}
          title={selected ? profileDetail(selected) : undefined}
          className="flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
        >
          <span className="truncate">
            {showLabel && `${label}: `}
            <span
              className={cn(
                "text-foreground",
                !selected && !custom && "italic text-muted-foreground",
              )}
            >
              {selected?.name ?? placeholder}
            </span>
          </span>
          <ChevronDown size={12} aria-hidden className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <ProfileChoices
          profiles={profiles}
          selectedId={value}
          onPick={pick}
          onAttach={(profile) =>
            void attach(profile).then((ok) => ok && pick(profile))
          }
          onManage={manage}
        />
        {custom && (
          <CustomRow
            label="Custom selection"
            detail={custom.description}
            selected={selected === null}
            onClick={() => {
              setOpen(false);
              custom.onCustom();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
