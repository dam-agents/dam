import {
  Link as McpIcon,
  Password as SecretIcon,
  Search,
} from "@carbon/icons-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { OAuthAppDescriptor } from "../api/fetchers.js";
import { OAuthAppIcon } from "./oauth-app-icon.js";

interface ManualOption {
  key: "mcp" | "secret";
  name: string;
  description: string;
  icon: React.ReactNode;
}

const MANUAL_OPTIONS: ManualOption[] = [
  {
    key: "mcp",
    name: "MCP server",
    description: "Model Context Protocol server tools.",
    icon: <McpIcon className="h-5 w-5" />,
  },
  {
    key: "secret",
    name: "Custom secret",
    description: "Bearer token on a host pattern.",
    icon: <SecretIcon className="h-5 w-5" />,
  },
];

/**
 * Library-style picker for adding a connection. Search input + a
 * 2-column grid of OAuth apps + the two manual paths (MCP server,
 * custom secret) below as wider rows. Combines the search bar and
 * results in one stack — for surfaces (like the modal below) that need
 * a pinned search header, use {@link ConnectionLibrarySearch} +
 * {@link ConnectionLibraryResults} directly.
 */
export function ConnectionLibrary({
  availableApps,
  onPickApp,
  onPickMcp,
  onPickSecret,
  className,
}: {
  availableApps: OAuthAppDescriptor[];
  onPickApp: (app: OAuthAppDescriptor) => void;
  onPickMcp: () => void;
  onPickSecret: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ConnectionLibrarySearch query={query} onQueryChange={setQuery} />
      <ConnectionLibraryResults
        query={query}
        availableApps={availableApps}
        onPickApp={onPickApp}
        onPickMcp={onPickMcp}
        onPickSecret={onPickSecret}
      />
    </div>
  );
}

/** Search input — controlled, owns no state of its own. */
export function ConnectionLibrarySearch({
  query,
  onQueryChange,
  autoFocus,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search apps, MCP, secrets…"
        className="pl-9"
        autoFocus={autoFocus}
      />
    </div>
  );
}

/** Filtered grid of OAuth apps + manual options, for the given query. */
export function ConnectionLibraryResults({
  query,
  availableApps,
  onPickApp,
  onPickMcp,
  onPickSecret,
  className,
}: {
  query: string;
  availableApps: OAuthAppDescriptor[];
  onPickApp: (app: OAuthAppDescriptor) => void;
  onPickMcp: () => void;
  onPickSecret: () => void;
  className?: string;
}) {
  const q = query.trim().toLowerCase();
  const filteredApps = useMemo(() => {
    if (!q) return availableApps;
    return availableApps.filter((a) => {
      return (
        a.displayName.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
      );
    });
  }, [availableApps, q]);
  const filteredManual = useMemo(() => {
    if (!q) return MANUAL_OPTIONS;
    return MANUAL_OPTIONS.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    );
  }, [q]);
  const empty = filteredApps.length === 0 && filteredManual.length === 0;
  const handleManualPick = (key: ManualOption["key"]) => {
    if (key === "mcp") onPickMcp();
    else onPickSecret();
  };
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {filteredApps.length > 0 && (
        <Section label="OAuth Apps" count={filteredApps.length}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {filteredApps.map((app) => (
              <PickerTile
                key={app.id}
                icon={
                  <OAuthAppIcon appId={app.id} alt={app.displayName} size={20} />
                }
                title={app.displayName}
                description={app.description}
                onClick={() => onPickApp(app)}
              />
            ))}
          </div>
        </Section>
      )}

      {filteredManual.length > 0 && (
        <Section label="Manual" count={filteredManual.length}>
          <div className="grid grid-cols-1 gap-1">
            {filteredManual.map((m) => (
              <PickerTile
                key={m.key}
                icon={m.icon}
                title={m.name}
                description={m.description}
                onClick={() => handleManualPick(m.key)}
              />
            ))}
          </div>
        </Section>
      )}

      {empty && (
        <div className="text-center py-8 text-[13px] text-muted-foreground">
          Nothing matches "<span className="font-medium text-foreground">{query}</span>".
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground/70">{count}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Modal wrapper. The search bar is pinned (shrink-0) above the results
 * area so it stays visible while the user scrolls through OAuth apps.
 */
export function ConnectionChooserDialog({
  open,
  onClose,
  availableApps,
  onPickApp,
  onPickMcp,
  onPickSecret,
}: {
  open: boolean;
  onClose: () => void;
  availableApps: OAuthAppDescriptor[];
  onPickApp: (app: OAuthAppDescriptor) => void;
  onPickMcp: () => void;
  onPickSecret: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col gap-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add a connection</DialogTitle>
          <DialogDescription>
            Pick what to connect — credentials are encrypted in the
            cluster and never visible to the agent runtime.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0">
          <ConnectionLibrarySearch
            query={query}
            onQueryChange={setQuery}
            autoFocus
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1">
          <ConnectionLibraryResults
            query={query}
            availableApps={availableApps}
            onPickApp={onPickApp}
            onPickMcp={onPickMcp}
            onPickSecret={onPickSecret}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PickerTile({
  icon,
  title,
  description,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted min-w-0",
        className,
      )}
    >
      <span className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-foreground">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-foreground truncate">
          {title}
        </span>
        {description && (
          <span className="block text-[11px] text-muted-foreground leading-snug truncate">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
