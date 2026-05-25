import type { DirEntry } from "agent-runtime-api";
import { Fragment } from "react";

import { FileRow } from "./file-row.js";
import { useFilesPanel } from "./files-panel-controller.js";
import { InlineNameRow } from "./inline-name-row.js";

interface Props {
  entry: DirEntry;
  fullPath: string;
  depth: number;
  isExpanded: boolean;
  isRenaming: boolean;
  renderChildren: () => JSX.Element | null;
}

export function DirEntryRow({
  entry,
  fullPath,
  depth,
  isExpanded,
  isRenaming,
  renderChildren,
}: Props) {
  const panel = useFilesPanel();
  const isDir = entry.type === "dir";

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
          menuActive={panel.menu?.path === fullPath}
        />
      )}
      {isExpanded && renderChildren()}
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
