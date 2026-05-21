import { Fragment } from "react";

import { useDirSnapshot } from "../api/queries.js";
import { FileRow } from "./file-row.js";
import { useFilesPanel } from "./files-panel-context.js";
import { InlineNameRow } from "./inline-name-row.js";

interface Props {
  path: string;
  depth: number;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Renders one directory's immediate children. Recurses for any child dir
 *  the user has expanded. Lifecycle = render lifecycle: collapsing a parent
 *  unmounts every `<DirContents>` underneath, which lets React Query garbage
 *  collect the slice subscriptions for free. */
export function DirContents({ path, depth }: Props) {
  const panel = useFilesPanel();
  const { data: snapshot } = useDirSnapshot(panel.agentId, path);

  if (!snapshot || !snapshot.ok) return null;

  return (
    <>
      {snapshot.entries.map((entry) => {
        const fullPath = joinPath(path, entry.name);
        const isExpanded =
          entry.type === "dir" && panel.expandedDirs.has(fullPath);
        const isRenaming = panel.renamingPath === fullPath;

        return (
          <Fragment key={fullPath}>
            {isRenaming ? (
              <InlineNameRow
                kind={entry.type === "dir" ? "dir" : "file"}
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
                isCollapsed={entry.type === "dir" && !isExpanded}
                dropActive={
                  entry.type === "dir" && panel.dragTargetPath === fullPath
                }
                menuActive={panel.menu?.path === fullPath}
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
      })}
    </>
  );
}
