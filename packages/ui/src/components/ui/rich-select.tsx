import { Checkmark, ChevronDown } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
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
  icon?: ReactNode;
  triggerIcon?: ReactNode;
  badge?: ReactNode;
  triggerBadge?: ReactNode;
  trailing?: ReactNode;
  testId?: string;
}

interface Props<T extends string> {
  options: readonly RichSelectOption<T>[];
  value: T | null;
  /** Fires for any option, even the selected one — the caller decides
   *  whether a pick selects, confirms, or opens a side flow. */
  onSelect: (value: T) => void;
  placeholder: string;
  /** Names what the control picks, read out ahead of the current value. */
  ariaLabel?: string;
  disabled?: boolean;
  testId?: string;
}

export function RichSelect<T extends string>({
  options,
  value,
  onSelect,
  placeholder,
  ariaLabel,
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
          className={cn(
            CARD_SURFACE,
            "group flex min-h-[76px] w-full items-center gap-3.5 p-4 text-left transition-colors hover:border-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-foreground",
          )}
        >
          {ariaLabel && <span className="sr-only">{ariaLabel}</span>}
          {selected ? (
            <>
              {selected.triggerIcon ?? selected.icon}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <p className="truncate text-base font-medium text-foreground">
                    {selected.title}
                  </p>
                  {selected.triggerBadge}
                </div>
                {selected.description && (
                  <p className="truncate text-sm text-muted-foreground">
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
            // Radix's default menuitem role hides which option is selected
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
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">
                  {option.title}
                </p>
                {option.badge}
              </div>
              {option.description && (
                <p className="truncate text-sm text-muted-foreground">
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
