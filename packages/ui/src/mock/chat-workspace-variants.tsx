import {
  Add,
  ChevronDown,
  Cube,
  Document,
  DocumentAdd,
  Folder,
  FolderAdd,
  Folders,
  Layers,
  Search,
  Upload,
} from "@carbon/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useArtifacts } from "../modules/artifacts/api/queries.js";
import { ArtifactKindBadge } from "../modules/artifacts/components/artifact-badges.js";
import { useDirSnapshot } from "../modules/files/api/queries.js";
import { DirContents } from "../modules/files/components/dir-contents.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "../modules/files/components/files-panel-controller.js";
import { InlineNameRow } from "../modules/files/components/inline-name-row.js";
import { useStore } from "../store.js";

export const WORKSPACE_VARIANTS = [
  { label: "Current", note: "Existing panel, for comparison" },
  { label: "Header pills", note: "Files and Artifacts pills open popovers" },
  { label: "Agent menu", note: "Click the agent name to see its workspace" },
  { label: "Quick find", note: "One search field for files and artifacts (⌘K)" },
  { label: "Composer row", note: "Files and artifacts next to model and skills" },
  { label: "Icon buttons", note: "Two quiet icons with tooltips by the name" },
  { label: "Edge dock", note: "Small floating dock on the chat's left edge" },
];

export type WorkspaceHeaderMode = "pills" | "agentMenu" | "search" | "icons" | "title";

export interface AgentChrome {
  agentId: string | null;
  name: string;
  statusDot: ReactNode;
  menu: ReactNode;
  status: ReactNode;
  backButton: ReactNode;
  onOpenFile: (path: string, opts?: { edit?: boolean }) => void;
}

const ROUNDED_ROWS =
  "[&_.group]:mx-1.5 [&_.group]:rounded-lg [&_.group]:transition-colors";
const POPOVER_BODY = "w-[320px] max-h-[60vh] overflow-y-auto rounded-2xl p-2";

function WorkspaceFileTree({
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={c.isUploading}
            className="mx-1.5 mt-1 flex h-8 w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Add size={16} /> Add file
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => c.openFilePickerFor("")}>
            <Upload size={16} /> Upload file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={c.openFolderPicker}>
            <Folders size={16} /> Upload folder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => c.startNewIn("file", "")}>
            <DocumentAdd size={16} /> New file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => c.startNewIn("dir", "")}>
            <FolderAdd size={16} /> New folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function useAgentArtifacts(agentId: string | null) {
  const { data = [], isPending } = useArtifacts(agentId ? { agentId } : null);
  return { artifacts: data, isPending };
}

function WorkspaceArtifactList({
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
  const q = filter?.trim().toLowerCase() ?? "";
  const shown = q
    ? artifacts.filter((a) => a.title.toLowerCase().includes(q))
    : artifacts;
  if (shown.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {isPending ? "Loading…" : q ? "No matching artifacts" : "No artifacts yet"}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 px-1.5">
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
            "flex h-8 items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            a.id === openArtifactId && "bg-muted text-foreground",
          )}
        >
          <ArtifactKindBadge kind={a.kind} />
          <span className="min-w-0 flex-1 truncate">{a.title}</span>
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 flex-1 rounded-full px-3 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WorkspaceTabs({
  chrome,
  onPicked,
}: {
  chrome: AgentChrome;
  onPicked?: () => void;
}) {
  const [tab, setTab] = useState<"files" | "artifacts">("files");
  const { artifacts } = useAgentArtifacts(chrome.agentId);
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "files", label: "Files" },
          {
            value: "artifacts",
            label: artifacts.length
              ? `Artifacts ${artifacts.length}`
              : "Artifacts",
          },
        ]}
      />
      {tab === "files" ? (
        <WorkspaceFileTree onOpenFile={chrome.onOpenFile} />
      ) : (
        <WorkspaceArtifactList agentId={chrome.agentId} onPicked={onPicked} />
      )}
    </div>
  );
}

function AgentTitle({ chrome }: { chrome: AgentChrome }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {chrome.backButton}
      {chrome.statusDot}
      <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
        {chrome.name}
      </h1>
      <div className="shrink-0">{chrome.menu}</div>
    </div>
  );
}

function Pill({
  icon,
  label,
  count,
  ...props
}: {
  icon: ReactNode;
  label: string;
  count?: number;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 data-[state=open]:bg-foreground data-[state=open]:text-background"
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span className="opacity-60">{count}</span>
      )}
    </button>
  );
}

function IconButton({
  label,
  children,
  ...props
}: {
  label: string;
  children: ReactNode;
} & React.ComponentProps<"button">) {
  return (
    <Tooltip content={label} className="text-sm">
      <button
        type="button"
        aria-label={label}
        {...props}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function FilesPopover({
  chrome,
  trigger,
  side = "bottom",
  align = "start",
}: {
  chrome: AgentChrome;
  trigger: ReactNode;
  side?: "top" | "bottom" | "right";
  align?: "start" | "center";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className={POPOVER_BODY}>
        <WorkspaceFileTree onOpenFile={chrome.onOpenFile} />
      </PopoverContent>
    </Popover>
  );
}

function ArtifactsPopover({
  chrome,
  trigger,
  side = "bottom",
  align = "start",
}: {
  chrome: AgentChrome;
  trigger: ReactNode;
  side?: "top" | "bottom" | "right";
  align?: "start" | "center";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} className={POPOVER_BODY}>
        <WorkspaceArtifactList
          agentId={chrome.agentId}
          onPicked={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function AgentMenuTrigger({ chrome }: { chrome: AgentChrome }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {chrome.backButton}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-full py-1 pr-2.5 pl-3 transition-colors hover:bg-muted data-[state=open]:bg-muted"
          >
            {chrome.statusDot}
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {chrome.name}
            </span>
            <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn(POPOVER_BODY, "p-3")}>
          <div className="mb-3 flex items-center gap-2 px-1">
            {chrome.statusDot}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {chrome.name}
            </span>
            {chrome.menu}
          </div>
          <WorkspaceTabs chrome={chrome} onPicked={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
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
      {open && <QuickFindDialog chrome={chrome} onClose={() => setOpen(false)} />}
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
    <div className="fixed inset-0 z-overlay flex items-start justify-center bg-black/20 pt-[14vh]" onClick={onClose}>
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

/** Borderless title row at the top of the chat column. */
export function WorkspaceChatHeader({
  chrome,
  mode,
}: {
  chrome: AgentChrome;
  mode: WorkspaceHeaderMode;
}) {
  const { artifacts } = useAgentArtifacts(chrome.agentId);
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 pr-16 pl-6">
      {mode === "agentMenu" ? (
        <AgentMenuTrigger chrome={chrome} />
      ) : (
        <AgentTitle chrome={chrome} />
      )}
      {mode === "pills" && (
        <div className="flex items-center gap-2">
          <FilesPopover
            chrome={chrome}
            trigger={<Pill icon={<Folder size={16} />} label="Files" />}
          />
          <ArtifactsPopover
            chrome={chrome}
            trigger={
              <Pill
                icon={<Cube size={16} />}
                label="Artifacts"
                count={artifacts.length}
              />
            }
          />
        </div>
      )}
      {mode === "icons" && (
        <div className="flex items-center gap-0.5">
          <FilesPopover
            chrome={chrome}
            trigger={
              <IconButton label="Files">
                <Folder size={16} />
              </IconButton>
            }
          />
          <ArtifactsPopover
            chrome={chrome}
            trigger={
              <IconButton
                label={`Artifacts (${artifacts.length})`}
              >
                <Cube size={16} />
              </IconButton>
            }
          />
        </div>
      )}
      {mode === "search" && (
        <div className="flex flex-1 justify-center">
          <QuickFind chrome={chrome} />
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">{chrome.status}</div>
    </div>
  );
}

/** Links that sit in the row under the composer, beside model and skills. */
export function WorkspaceComposerLinks({ chrome }: { chrome: AgentChrome }) {
  const { artifacts } = useAgentArtifacts(chrome.agentId);
  const link =
    "flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground";
  return (
    <>
      <span className="text-border">·</span>
      <FilesPopover
        chrome={chrome}
        side="top"
        trigger={
          <button type="button" className={link}>
            <Folder size={16} /> Files
          </button>
        }
      />
      <span className="text-border">·</span>
      <ArtifactsPopover
        chrome={chrome}
        side="top"
        trigger={
          <button type="button" className={link}>
            <Cube size={16} />
            {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
          </button>
        }
      />
    </>
  );
}

/** Floating vertical dock pinned to the chat column's left edge. */
export function WorkspaceEdgeDock({ chrome }: { chrome: AgentChrome }) {
  const { artifacts } = useAgentArtifacts(chrome.agentId);
  return (
    <div className="absolute top-1/2 left-3 z-raised hidden -translate-y-1/2 flex-col gap-1 rounded-full bg-background p-1 shadow-[0_2px_12px_rgba(0,0,0,0.08)] ring-1 ring-black/5 md:flex">
      <FilesPopover
        chrome={chrome}
        side="right"
        trigger={
          <IconButton label="Files">
            <Folder size={16} />
          </IconButton>
        }
      />
      <ArtifactsPopover
        chrome={chrome}
        side="right"
        trigger={
          <IconButton
            label={`Artifacts (${artifacts.length})`}
          >
            <Cube size={16} />
          </IconButton>
        }
      />
    </div>
  );
}

export function LayoutVariantPicker(props: {
  current: number;
  onChange: (v: number) => void;
}) {
  if (window.self !== window.top) return null;
  return <LayoutVariantPickerPanel {...props} />;
}

function LayoutVariantPickerPanel({
  current,
  onChange,
}: {
  current: number;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed right-4 bottom-4 z-[9999] flex h-9 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-md"
      >
        <Layers size={16} />
        {current}. {WORKSPACE_VARIANTS[current]?.label}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-4 bottom-15 z-[9999] flex w-[300px] flex-col gap-0.5 rounded-2xl bg-background p-2 shadow-lg ring-1 ring-black/5">
            <p className="px-3 py-1.5 text-sm font-semibold text-foreground">
              Chat workspace options
            </p>
            {WORKSPACE_VARIANTS.map((v, i) => (
              <button
                key={v.label}
                type="button"
                onClick={() => {
                  onChange(i);
                  setOpen(false);
                }}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                  i === current
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="text-sm font-medium">
                  {i}. {v.label}
                </span>
                <span className="text-sm opacity-80">{v.note}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
