import type { DirEntry } from "agent-runtime-api";
import type { CSSProperties, ReactNode } from "react";

import { TREE_GUIDE, treeGuideX, treeIndent } from "@/components/ui/tree-guide";

import { useStore } from "../../../store.js";
import { useDirSnapshot } from "../api/queries.js";
import { FileRow } from "./file-row.js";
import { useFilesPanel } from "./files-panel-controller.js";
import { InlineNameRow } from "./inline-name-row.js";

interface DirContentsProps {
  path: string;
  depth: number;
}

export function DirContents({ path, depth }: DirContentsProps) {
  const panel = useFilesPanel();
  const { data: snapshot } = useDirSnapshot(panel.agentId, path);
  const showHiddenFiles = useStore((s) => s.showHiddenFiles);

  if (!snapshot) return null;
  if (!snapshot.ok)
    return (
      <PlaceholderRow depth={depth} tone="error">
        {snapshot.error === "forbidden"
          ? "Couldn't open this folder: permission denied"
          : "This folder no longer exists"}
      </PlaceholderRow>
    );

  const shown = snapshot.entries.filter(
    (entry) => showHiddenFiles || !entry.name.startsWith("."),
  );
  if (shown.length === 0 && depth > 0 && panel.pendingNew?.dir !== path)
    return <PlaceholderRow depth={depth}>Empty folder</PlaceholderRow>;

  return (
    <>
      {shown.map((entry) => (
        <DirEntryRow
          key={entry.name}
          entry={entry}
          parentPath={path}
          depth={depth}
        />
      ))}
    </>
  );
}

function PlaceholderRow({
  depth,
  tone,
  children,
}: {
  depth: number;
  tone?: "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`flex h-8 items-center text-xs italic ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
      style={{ paddingLeft: treeIndent(depth) + 22, paddingRight: 12 }}
    >
      {children}
    </div>
  );
}

interface DirEntryRowProps {
  entry: DirEntry;
  parentPath: string;
  depth: number;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function DirEntryRow({ entry, parentPath, depth }: DirEntryRowProps) {
  const panel = useFilesPanel();
  const fullPath = joinPath(parentPath, entry.name);
  const isDir = entry.type === "dir";
  const isExpanded = isDir && panel.expandedDirs.has(fullPath);
  const isRenaming = panel.renamingPath === fullPath;

  return (
    <div className={depth > 0 ? TREE_GUIDE : undefined}>
      {isRenaming ? (
        <InlineNameRow
          kind={isDir ? "dir" : "file"}
          depth={depth}
          initial={entry.name}
          onCommit={(next) => panel.onCommitRename(fullPath, next)}
          onCancel={panel.onCancelRename}
        />
      ) : (
        <FileRow
          name={entry.name}
          path={fullPath}
          type={entry.type}
          depth={depth}
          isDot={entry.name.startsWith(".")}
          isCollapsed={isDir && !isExpanded}
          dropActive={isDir && panel.dragTargetPath === fullPath}
        />
      )}
      <div style={{ "--tree-guide-x": treeGuideX(depth) } as CSSProperties}>
        {isExpanded && <DirContents path={fullPath} depth={depth + 1} />}
        {panel.pendingNew && panel.pendingNew.dir === fullPath && (
          <div className={TREE_GUIDE}>
            <InlineNameRow
              kind={panel.pendingNew.kind}
              depth={depth + 1}
              placeholder={
                panel.pendingNew.kind === "dir" ? "new-folder" : "new-file.md"
              }
              onCommit={panel.onCommitNew}
              onCancel={panel.onCancelNew}
            />
          </div>
        )}
      </div>
    </div>
  );
}
