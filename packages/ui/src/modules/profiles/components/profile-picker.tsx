import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import type { ProfileWithUsage } from "api-server-api";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { profileDetail } from "../lib/profile-detail.js";
import { ProfileChoices } from "./profile-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the profile a channel or a schedule runs on, as a
 * control in its row or its form: the owner's list, the same rows the chat
 * picker shows, and — where the surface can also carry values of its own — the
 * row that switches to them. A channel has no values of its own, so it offers
 * the list alone.
 */
export function ProfilePicker({
  label,
  profiles,
  value,
  placeholder,
  showLabel = true,
  custom,
  onPick,
  onCustom,
  onAttach,
  onManage,
  disabled = false,
  testId,
}: {
  label: string;
  profiles: readonly ProfileWithUsage[];
  value: string | null;
  placeholder: string;
  showLabel?: boolean;
  custom?: { label: string; description?: string } | undefined;
  onPick: (profile: ProfileWithUsage) => void;
  onCustom?: (() => void) | undefined;
  onAttach: (profile: ProfileWithUsage) => void;
  onManage: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const selected = profiles.find((p) => p.id === value) ?? null;
  const current = selected?.name ?? custom?.label ?? placeholder;
  return (
    <Popover>
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
            {showLabel && (
              <span className="text-muted-foreground">{label}: </span>
            )}
            <span
              className={cn(
                "text-foreground",
                selected === null && "italic text-muted-foreground",
              )}
            >
              {current}
            </span>
          </span>
          <ChevronDown size={12} aria-hidden className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <ProfileChoices
          profiles={profiles}
          current={null}
          selectedId={value}
          onPick={onPick}
          onAttach={onAttach}
          onManage={onManage}
        />
        {custom && onCustom && (
          <button
            type="button"
            onClick={onCustom}
            className="mt-1 flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
          >
            <span className="min-w-0">
              <span className="block truncate text-foreground">
                {custom.label}
              </span>
              {custom.description && (
                <span className="block truncate text-xs text-muted-foreground">
                  {custom.description}
                </span>
              )}
            </span>
            <ChevronRight size={14} aria-hidden className="mt-0.5 shrink-0" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
