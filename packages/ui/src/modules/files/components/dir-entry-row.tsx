import type { DirEntry } from "agent-runtime-api";
import { Fragment } from "react";

import { DirContents } from "./dir-contents.js";
import { FileRow } from "./file-row.js";
import { useFilesPanel } from "./files-panel-controller.js";
import { InlineNameRow } from "./inline-name-row.js";

interface Props {
  entry: DirEntry;
  parentPath: string;
  depth: number;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function DirEntryRow({ entry, parentPath, depth }: Props) {
  const panel = useFilesPanel();
  const fullPath = joinPath(parentPath, entry.name);
  const isDir = entry.type === "dir";
  const isExpanded = isDir && panel.expandedDirs.has(fullPath);
  const isRenaming = panel.renamingPath === fullPath;

  return (
    <Fragment>
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
      {isExpanded && <DirContents path={fullPath} depth={depth + 1} />}
      {panel.pendingNew && panel.pendingNew.dir === fullPath && (
        <InlineNameRow
          kind={panel.pendingNew.kind}
          depth={depth + 1}
          placeholder={
            panel.pendingNew.kind === "dir" ? "new-folder" : "new-file.md"
          }
          onCommit={panel.onCommitNew}
          onCancel={panel.onCancelNew}
        />
      )}
    </Fragment>
  );
}
