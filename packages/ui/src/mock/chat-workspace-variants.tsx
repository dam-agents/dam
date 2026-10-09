import {
  Add,
  Close,
  Diagram,
  Document,
  DocumentAdd,
  Folder,
  FolderAdd,
  Folders,
  Search,
  Upload,
} from "@carbon/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../modules/agents/components/char-avatar.js";
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
  const q = filter?.trim().toLowerCase() ?? "";
  const shown = q
    ? artifacts.filter((a) => a.title.toLowerCase().includes(q))
    : artifacts;
  if (shown.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {isPending
          ? "Loading…"
          : q
            ? "No matching artifacts"
            : "No artifacts yet"}
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

function AgentMenuTrigger({ chrome }: { chrome: AgentChrome }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {chrome.backButton}
      <button
        type="button"
        onClick={chrome.onConfigure}
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
  const isOpen = panels.length > 0;
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden bg-background transition-[width,border-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        isOpen
          ? "w-[280px] border-r border-border"
          : "w-0 border-r border-transparent",
      )}
    >
      <div className="flex h-full w-[280px] flex-col">
        {panels.map((kind, i) => (
          <div
            key={kind}
            className={cn(
              "flex flex-col overflow-hidden anim-in",
              panels.length > 1 ? "flex-1 min-h-0" : "flex-1",
              i > 0 && "border-t border-border",
            )}
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-sm font-semibold text-foreground">
                {kind === "files" ? "Files" : "Artifacts"}
              </span>
              <button
                type="button"
                onClick={() => onClosePanel(kind)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Close size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {kind === "files" ? (
                <WorkspaceFileTree onOpenFile={chrome.onOpenFile} />
              ) : (
                <WorkspaceArtifactList agentId={chrome.agentId} />
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
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {chrome.status}
        {onNewChat && (
          <Button variant="outline" size="sm" onClick={onNewChat}>
            <Add size={16} />
            New chat
          </Button>
        )}
      </div>
    </div>
  );
}
