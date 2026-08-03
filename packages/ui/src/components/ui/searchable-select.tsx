import { ChevronDown } from "@carbon/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}

/** A single-select that filters its options by a typed query — for lists too
 *  long to scan in a native <select> (e.g. IANA timezones). Closes on outside
 *  click or Escape; Arrow/Enter navigate the filtered list. */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  invalid,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    if (open)
      listRef.current
        ?.querySelector('[data-highlighted="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commit = (opt: Option) => {
    onChange(opt.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, Math.min(h + 1, filtered.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) commit(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm",
          invalid ? "border-destructive" : "border-input",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-popover mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <div className="p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                filtered[highlight] ? optionId(highlight) : undefined
              }
              className="h-8 w-full rounded border border-input bg-background px-2 text-sm outline-hidden"
            />
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-[240px] overflow-y-auto p-1 pt-0"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No matches
              </li>
            )}
            {filtered.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  id={optionId(i)}
                  type="button"
                  data-highlighted={i === highlight}
                  onClick={() => commit(o)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex h-9 w-full items-center rounded-md px-3 text-left text-sm",
                    i === highlight
                      ? "bg-muted text-foreground"
                      : "text-foreground",
                    o.value === value && "font-medium",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
