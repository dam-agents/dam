import { Checkmark, ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface RichSelectOption<T extends string = string> {
  value: T;
  title: string;
  description?: string;
  /** Icon on the menu row (compact). */
  icon?: ReactNode;
  /** Icon in the closed control while selected; falls back to `icon`. */
  triggerIcon?: ReactNode;
  /** Rendered after the title in the closed control while selected
   *  (e.g. a status badge). */
  triggerBadge?: ReactNode;
  /** Right-aligned affordance on the menu row (e.g. "Connect"). Hidden on
   *  the selected row, which shows a check instead. */
  trailing?: ReactNode;
  testId?: string;
}

interface Props<T extends string> {
  options: readonly RichSelectOption<T>[];
  value: T | null;
  /** Fires for any option, selected or not — the caller decides whether the
   *  pick selects, needs a confirmation, or opens a side flow first. */
  onSelect: (value: T) => void;
  placeholder: string;
  disabled?: boolean;
  testId?: string;
}

/** Single-select over options too rich for a native `<select>` — each option
 *  carries an icon, title, description, and an optional trailing affordance.
 *  The closed control is a card showing the selected option in full. */
export function RichSelect<T extends string>({
  options,
  value,
  onSelect,
  placeholder,
  disabled = false,
  testId,
}: Props<T>) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid={testId}
          className="group flex w-full items-center gap-3.5 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-foreground"
        >
          {selected ? (
            <>
              {selected.triggerIcon ?? selected.icon}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <p className="truncate text-[16px] font-medium text-foreground">
                    {selected.title}
                  </p>
                  {selected.triggerBadge}
                </div>
                {selected.description && (
                  <p className="truncate text-[14px] text-muted-foreground">
                    {selected.description}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="flex-1 text-[15px] text-muted-foreground">
              {placeholder}
            </p>
          )}
          <ChevronDown
            size={18}
            className="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[var(--radix-dropdown-menu-trigger-width)] p-1.5"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            // Radix emits role="menuitem"; radio semantics announce the
            // selection state a plain menu item lacks.
            role="menuitemradio"
            aria-checked={option.value === value}
            textValue={option.title}
            data-testid={option.testId}
            onSelect={() => onSelect(option.value)}
            className={cn(
              "h-auto items-center gap-3 rounded-lg px-3 py-2.5",
              option.value === value && "bg-muted/50",
            )}
          >
            {option.icon}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-foreground">
                {option.title}
              </p>
              {option.description && (
                <p className="truncate text-[13px] text-muted-foreground">
                  {option.description}
                </p>
              )}
            </div>
            {option.value === value ? (
              <Checkmark size={16} className="shrink-0 text-foreground" />
            ) : (
              option.trailing
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
