import {
  Add,
  Calendar,
  ChevronRight,
  Close,
  CloudApp,
  Dashboard,
  Diagram,
  Document,
  DocumentAdd,
  Download,
  Edit,
  Folder,
  FolderAdd,
  Launch,
  Locked,
  Move,
  OverflowMenuVertical,
  Search,
  Share,
  TrashCan,
  Upload,
} from "@carbon/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../modules/agents/components/char-avatar.js";
import { useArtifacts } from "../modules/artifacts/api/queries.js";
import { useDirSnapshot } from "../modules/files/api/queries.js";
import { DirContents } from "../modules/files/components/dir-contents.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "../modules/files/components/files-panel-controller.js";
import { InlineNameRow } from "../modules/files/components/inline-name-row.js";
import { useStore } from "../store.js";
import { environmentsByAgent } from "./data/environments.js";

export interface AgentChrome {
  agentId: string | null;
  name: string;
  statusDot: ReactNode;
  menu: ReactNode;
  status: ReactNode;
  backButton: ReactNode;
  onOpenFile: (path: string, opts?: { edit?: boolean }) => void;
  onConfigure?: () => void;
}

const ROUNDED_ROWS =
  "[&_.group]:mx-1.5 [&_.group]:rounded-lg [&_.group]:transition-colors";

export function WorkspaceFileTree({
  onOpenFile,
}: {
  onOpenFile: AgentChrome["onOpenFile"];
}) {
  const c = useFilesPanelController({ onOpenFile });
  return (
    <div
      className={cn("relative", ROUNDED_ROWS)}
      onDragEnter={c.handlePanelDragEnter}
      onDragOver={c.handlePanelDragOver}
      onDragLeave={c.handlePanelDragLeave}
      onDrop={c.handlePanelDrop}
    >
      <input
        ref={c.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={c.handleFileInputChange}
      />
      <input
        ref={c.folderInputRef}
        type="file"
        multiple
        // @ts-expect-error -- non-standard but supported by Chromium-based + Safari + Firefox
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={c.handleFolderInputChange}
      />
      {c.ctxValue && (
        <FilesPanelContext.Provider value={c.ctxValue}>
          {c.pendingNew && c.pendingNew.dir === "" && (
            <InlineNameRow
              kind={c.pendingNew.kind}
              depth={0}
              placeholder={
                c.pendingNew.kind === "dir" ? "new-folder" : "new-file.md"
              }
              onCommit={c.handleCommitNew}
              onCancel={c.handleCancelNew}
            />
          )}
          {c.rootIsLoadedEmpty && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No files yet
            </p>
          )}
          <DirContents path="" depth={0} />
        </FilesPanelContext.Provider>
      )}
      {c.showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-light/80">
          <span className="text-sm font-semibold text-accent">
            Drop to upload
          </span>
        </div>
      )}
    </div>
  );
}

function useAgentArtifacts(agentId: string | null) {
  const { data = [], isPending } = useArtifacts(agentId ? { agentId } : null);
  return { artifacts: data, isPending };
}

function VisibilityDetail({ accessLabel }: { accessLabel?: string }) {
  const label = accessLabel?.toLowerCase();
  if (!label || label === "private" || label === "only you") {
    return (
      <>
        <Locked size={12} />
        Private
      </>
    );
  }
  return (
    <>
      <Share size={12} />
      {accessLabel}
    </>
  );
}

function ArtifactTrailingIcon({ title }: { title: string }) {
  const showConfirm = useStore.getState().showConfirm;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shrink-0"
            aria-label="Artifact actions"
          >
            <OverflowMenuVertical
              size={16}
              className={`transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"}`}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              emitToast({ kind: "success", message: `Renamed ${title}` })
            }
          >
            <Edit size={13} /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({ kind: "success", message: `Moved ${title}` })
            }
          >
            <Move size={13} /> Move
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({ kind: "success", message: `Shared ${title}` })
            }
          >
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({ kind: "success", message: `Downloading ${title}` })
            }
          >
            <Download size={13} /> Download
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Set expiration for ${title}`,
              })
            }
          >
            <Calendar size={13} /> Set expiration
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={async () => {
              const ok = await showConfirm(
                "This will permanently delete the artifact.",
                "Delete artifact",
                { kind: "destructive" },
              );
              if (ok)
                emitToast({ kind: "success", message: `Deleted ${title}` });
            }}
          >
            <TrashCan size={13} /> Delete artifact
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function EnvPanelTrailingIcon({ name }: { name: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative shrink-0"
            aria-label="Environment actions"
          >
            <Launch
              size={16}
              className={`transition-opacity ${menuOpen ? "opacity-0" : "group-hover/item:opacity-0"}`}
            />
            <OverflowMenuVertical
              size={16}
              className={`absolute inset-0 transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"}`}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              emitToast({ kind: "success", message: `Shared ${name}` })
            }
          >
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 1 day`,
              })
            }
          >
            Extend 1 day
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 7 days`,
              })
            }
          >
            Extend 7 days
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              emitToast({
                kind: "success",
                message: `Extended ${name} by 30 days`,
              })
            }
          >
            Extend 30 days
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={() =>
              emitToast({ kind: "success", message: `Deleted ${name}` })
            }
          >
            <TrashCan size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

export function WorkspaceArtifactList({
  agentId,
  filter,
  onPicked,
}: {
  agentId: string | null;
  filter?: string;
  onPicked?: () => void;
}) {
  const { artifacts, isPending } = useAgentArtifacts(agentId);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const environments = agentId ? (environmentsByAgent[agentId] ?? []) : [];
  const q = filter?.trim().toLowerCase() ?? "";
  const shown = q
    ? artifacts.filter((a) => a.title.toLowerCase().includes(q))
    : artifacts;
  const shownEnvs = q
    ? environments.filter((e) => e.name.toLowerCase().includes(q))
    : environments;

  const hasNothing = shown.length === 0 && shownEnvs.length === 0;
  if (hasNothing) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {isPending ? "Loading…" : q ? "No matching items" : "No artifacts yet"}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-1.5 py-1">
      {shownEnvs.map((env) => {
        const running = env.status === "running";
        const ms = new Date(env.expiresAt).getTime() - Date.now();
        const days = Math.max(1, Math.ceil(ms / 86_400_000));
        const expiry =
          ms <= 0
            ? "Expired"
            : `Expires in ${days} day${days === 1 ? "" : "s"}`;
        return (
          <button
            key={env.id}
            type="button"
            title={env.name}
            onClick={() => window.open(env.url, "_blank", "noopener")}
            className="group/item flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {env.name}
                </span>
                <span
                  className={`ml-1.5 inline-block size-2 shrink-0 rounded-full ${running ? "bg-[#24a148] dark:bg-[#42be65]" : "bg-[#697077]"}`}
                />
                <span className="ml-auto shrink-0 text-foreground">
                  <EnvPanelTrailingIcon name={env.name} />
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                Environment
                <span className="mx-0.5">·</span>
                <VisibilityDetail accessLabel={env.accessLabel} />
                <span className="mx-0.5">·</span>
                {expiry}
              </span>
            </span>
          </button>
        );
      })}
      {shown.map((a) => (
        <button
          key={a.id}
          type="button"
          title={a.title}
          onClick={() => {
            setOpenArtifactId(a.id === openArtifactId ? null : a.id);
            onPicked?.();
          }}
          className={cn(
            "group/item flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted/40",
            a.id === openArtifactId && "border-foreground",
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {a.title}
              </span>
              <span className="ml-auto shrink-0 text-foreground">
                <ArtifactTrailingIcon title={a.title} />
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}
              <span className="mx-0.5">·</span>
              {a.visibility === "public" ? (
                <>
                  <Share size={12} />
                  Public
                </>
              ) : (
                <>
                  <Locked size={12} />
                  Private
                </>
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function AgentMenuTrigger({ chrome }: { chrome: AgentChrome }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {chrome.backButton}
      <button
        type="button"
        onClick={chrome.onConfigure}
        data-pointer-target="header-agent-name"
        className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pl-1 pr-3 transition-colors hover:bg-muted"
      >
        {chrome.agentId && (
          <AgentAvatar
            agentId={chrome.agentId}
            state="running"
            className="!size-6"
          />
        )}
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {chrome.name}
        </span>
        {chrome.statusDot}
      </button>
    </div>
  );
}

function QuickFind({ chrome }: { chrome: AgentChrome }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-[280px] items-center gap-2 rounded-full bg-muted/70 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search size={16} />
        <span className="flex-1 text-left">Find files and artifacts</span>
        <kbd className="font-sans text-sm opacity-70">⌘K</kbd>
      </button>
      {open && (
        <QuickFindDialog chrome={chrome} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function QuickFindDialog({
  chrome,
  onClose,
}: {
  chrome: AgentChrome;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data: root } = useDirSnapshot(chrome.agentId, "");
  const files = useMemo(() => {
    const entries = root?.ok ? root.entries : [];
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => e.type === "file")
      .filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [root, query]);

  return (
    <div
      className="fixed inset-0 z-overlay flex items-start justify-center bg-black/20 pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-2xl bg-background shadow-[0_16px_48px_rgba(0,0,0,0.18)] anim-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <Search size={16} className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${chrome.name}'s files and artifacts`}
            className="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <p className="px-4 pt-2 pb-1 text-sm font-medium text-muted-foreground">
            Files
          </p>
          {query ? (
            files.length === 0 ? (
              <p className="px-4 py-2 text-sm text-muted-foreground">
                No matching files
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 px-1.5">
                {files.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => {
                      chrome.onOpenFile(f.name);
                      onClose();
                    }}
                    className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Document size={16} />
                    {f.name}
                  </button>
                ))}
              </div>
            )
          ) : (
            <WorkspaceFileTree onOpenFile={chrome.onOpenFile} />
          )}
          <p className="px-4 pt-4 pb-1 text-sm font-medium text-muted-foreground">
            Artifacts
          </p>
          <WorkspaceArtifactList
            agentId={chrome.agentId}
            filter={query}
            onPicked={onClose}
          />
        </div>
      </div>
    </div>
  );
}

export type LeftPanelKind = "files" | "artifacts";

function PanelToggleButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

type FileEntry = { name: string; type: "file" | "dir"; children?: FileEntry[] };

const MOCK_FILE_TREE: FileEntry[] = [
  {
    name: "src",
    type: "dir",
    children: [
      {
        name: "middleware",
        type: "dir",
        children: [
          { name: "auth.ts", type: "file" },
          { name: "rate-limit.ts", type: "file" },
          { name: "logging.ts", type: "file" },
        ],
      },
      {
        name: "routes",
        type: "dir",
        children: [
          { name: "users.ts", type: "file" },
          { name: "reports.ts", type: "file" },
          { name: "health.ts", type: "file" },
        ],
      },
      {
        name: "models",
        type: "dir",
        children: [
          { name: "user.ts", type: "file" },
          { name: "report.ts", type: "file" },
        ],
      },
      { name: "index.ts", type: "file" },
      { name: "config.ts", type: "file" },
    ],
  },
  {
    name: "tests",
    type: "dir",
    children: [
      { name: "auth.test.ts", type: "file" },
      { name: "reports.test.ts", type: "file" },
    ],
  },
  { name: "package.json", type: "file" },
  { name: "tsconfig.json", type: "file" },
  { name: "README.md", type: "file" },
];

function flattenTree(
  entries: FileEntry[],
  prefix = "",
): { path: string; name: string; type: "file" | "dir"; depth: number }[] {
  const result: {
    path: string;
    name: string;
    type: "file" | "dir";
    depth: number;
  }[] = [];
  for (const e of entries) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    const depth = p.split("/").length - 1;
    result.push({ path: p, name: e.name, type: e.type, depth });
    if (e.children) result.push(...flattenTree(e.children, p));
  }
  return result;
}

function StaticFileTree({ filter }: { filter: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["src", "tests"]),
  );
  const flat = useMemo(() => flattenTree(MOCK_FILE_TREE), []);

  const visible = flat.filter((row) => {
    if (row.type === "dir") {
      const parent = row.path.includes("/")
        ? row.path.slice(0, row.path.lastIndexOf("/"))
        : "";
      return !parent || expanded.has(parent);
    }
    const parent = row.path.includes("/")
      ? row.path.slice(0, row.path.lastIndexOf("/"))
      : "";
    if (parent && !expanded.has(parent)) return false;
    if (filter) return row.name.toLowerCase().includes(filter.toLowerCase());
    return true;
  });

  return (
    <div className="flex flex-col gap-0.5 px-1.5">
      {visible.map((row) => (
        <button
          key={row.path}
          type="button"
          onClick={() => {
            if (row.type === "dir") {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(row.path)) next.delete(row.path);
                else next.add(row.path);
                return next;
              });
            }
          }}
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm transition-colors hover:bg-muted/60"
          style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
        >
          {row.type === "dir" ? (
            <>
              <ChevronRight
                size={12}
                className={cn(
                  "shrink-0 text-muted-foreground transition-transform",
                  expanded.has(row.path) && "rotate-90",
                )}
              />
              <Folder size={14} className="shrink-0 text-muted-foreground" />
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <Document size={14} className="shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="min-w-0 truncate text-foreground">{row.name}</span>
        </button>
      ))}
    </div>
  );
}

export function LeftDockedPanel({
  openPanels,
  chrome,
  onClosePanel,
}: {
  openPanels: ReadonlySet<LeftPanelKind>;
  chrome: AgentChrome;
  onClosePanel: (panel: LeftPanelKind) => void;
}) {
  const panels = (["files", "artifacts"] as const).filter((k) =>
    openPanels.has(k),
  );
  const [artifactSearch, setArtifactSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");

  useEffect(() => {
    if (chrome.agentId) {
      useStore.setState({ selectedAgent: chrome.agentId });
    }
  }, [chrome.agentId]);
  const isOpen = panels.length > 0;
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden bg-background transition-[width,border-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        isOpen
          ? "w-[320px] border-r border-border"
          : "w-0 border-r border-transparent",
      )}
    >
      <div className="flex h-full w-[320px] flex-col">
        {panels.map((kind, i) => (
          <div
            key={kind}
            className={cn(
              "flex flex-col overflow-hidden anim-in",
              panels.length > 1 ? "flex-1 min-h-0" : "flex-1",
              i > 0 && "border-t border-border",
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <span className="text-sm font-semibold text-foreground">
                {kind === "files" ? "Files" : "Artifacts"}
              </span>
              <button
                type="button"
                onClick={() => onClosePanel(kind)}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Close size={16} />
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
              <div className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-muted/70 px-2.5 text-sm text-muted-foreground">
                <Search size={14} className="shrink-0" />
                <input
                  type="text"
                  placeholder={
                    kind === "files" ? "Search files…" : "Search artifacts…"
                  }
                  value={kind === "artifacts" ? artifactSearch : fileSearch}
                  onChange={(e) =>
                    kind === "artifacts"
                      ? setArtifactSearch(e.target.value)
                      : setFileSearch(e.target.value)
                  }
                  className="h-full flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
                />
                {(kind === "artifacts" ? artifactSearch : fileSearch) && (
                  <button
                    type="button"
                    onClick={() =>
                      kind === "artifacts"
                        ? setArtifactSearch("")
                        : setFileSearch("")
                    }
                    className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <Close size={14} />
                  </button>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Add"
                  >
                    <Add size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {kind === "files" ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() =>
                          emitToast({ kind: "success", message: "New file" })
                        }
                      >
                        <DocumentAdd size={14} /> New file
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          emitToast({ kind: "success", message: "New folder" })
                        }
                      >
                        <FolderAdd size={14} /> New folder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          emitToast({ kind: "success", message: "Upload file" })
                        }
                      >
                        <Upload size={14} /> Upload file
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onSelect={() =>
                          emitToast({
                            kind: "success",
                            message: "Upload artifact",
                          })
                        }
                      >
                        <Upload size={14} /> Upload artifact
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          emitToast({ kind: "success", message: "New folder" })
                        }
                      >
                        <FolderAdd size={14} /> New folder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {kind === "files" ? (
                <StaticFileTree filter={fileSearch} />
              ) : (
                <WorkspaceArtifactList
                  agentId={chrome.agentId}
                  filter={artifactSearch}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceChatHeader({
  chrome,
  openPanels,
  onTogglePanel,
  onNewChat,
}: {
  chrome: AgentChrome;
  openPanels?: ReadonlySet<LeftPanelKind>;
  onTogglePanel?: (panel: LeftPanelKind) => void;
  onNewChat?: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 pr-6 pl-6">
      <AgentMenuTrigger chrome={chrome} />
      <PanelToggleButton
        icon={<Folder size={16} />}
        label="Files"
        active={openPanels?.has("files") ?? false}
        onClick={() => onTogglePanel?.("files")}
      />
      <PanelToggleButton
        icon={<Diagram size={16} />}
        label="Artifacts"
        active={openPanels?.has("artifacts") ?? false}
        onClick={() => onTogglePanel?.("artifacts")}
      />
      <div className="flex flex-1 items-center justify-center min-w-0">
        <div className="flex w-full max-w-[813px] items-center justify-end px-4">
          {chrome.status}
          {onNewChat && (
            <Button variant="outline" size="sm" onClick={onNewChat}>
              <Add size={16} />
              New chat
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
