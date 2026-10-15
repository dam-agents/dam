import { Close, Globe } from "@carbon/icons-react";
import type { TabState } from "agent-runtime-api";
import type { KeyboardEvent, Ref } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { tabLabel } from "../lib/tabs.js";

interface Props {
  tab: TabState;
  active: boolean;
  focusable: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

export function BrowserTab({
  tab,
  active,
  focusable,
  triggerRef,
  onSelect,
  onClose,
  onKeyDown,
}: Props) {
  const label = tabLabel(tab);
  return (
    <div
      data-tab-id={tab.id}
      data-active={active || undefined}
      className={cn(
        "group flex h-8 min-w-24 max-w-52 flex-1 basis-44 items-center rounded-t-md border border-b-0 text-xs transition-colors",
        active
          ? "-mb-px h-[calc(2rem+1px)] border-border border-t-2 border-t-accent bg-background font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Tooltip
        content={
          <span className="flex flex-col">
            <span className="font-medium">{label}</span>
            {label !== tab.url && tab.url && (
              <span className="break-all text-muted-foreground">{tab.url}</span>
            )}
          </span>
        }
      >
        <button
          ref={triggerRef}
          type="button"
          role="tab"
          aria-selected={active}
          tabIndex={focusable ? 0 : -1}
          onClick={onSelect}
          onAuxClick={(e) => e.button === 1 && onClose()}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-t-md pl-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {tab.loading ? (
            <Spinner size={12} label="Loading" />
          ) : (
            <Globe size={12} aria-hidden className="shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </button>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close tab ${label}`}
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "mx-0.5 h-5 w-5 text-muted-foreground",
          !active &&
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Close size={12} />
      </Button>
    </div>
  );
}
