import { Filter } from "@carbon/icons-react";
import { SESSION_CATEGORIES } from "api-server-api";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SESSION_CATEGORY_LABELS } from "../lib/session-category.js";

export function SessionFilterMenu({ className }: { className?: string }) {
  const sessionFilter = useStore((s) => s.sessionFilter);
  const toggleSessionFilter = useStore((s) => s.toggleSessionFilter);
  const filtered = sessionFilter.length < SESSION_CATEGORIES.length;
  const label = filtered
    ? `Filter sessions (${sessionFilter.length} shown)`
    : "Filter sessions";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative flex size-6 items-center justify-center rounded-md transition-colors hover:bg-background hover:text-foreground",
            filtered ? "text-primary" : "text-muted-foreground",
            className,
          )}
        >
          <Filter size={14} />
          {filtered && (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SESSION_CATEGORIES.map((category) => (
          <DropdownMenuCheckboxItem
            key={category}
            checked={sessionFilter.includes(category)}
            onCheckedChange={() => toggleSessionFilter(category)}
            onSelect={(e) => e.preventDefault()}
          >
            {SESSION_CATEGORY_LABELS[category]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
