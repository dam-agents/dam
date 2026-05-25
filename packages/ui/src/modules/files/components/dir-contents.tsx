import { useDirSnapshot } from "../api/queries.js";
import { DirEntryRow } from "./dir-entry-row.js";
import { useFilesPanel } from "./files-panel-controller.js";

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
          <DirEntryRow
            key={fullPath}
            entry={entry}
            fullPath={fullPath}
            depth={depth}
            isExpanded={isExpanded}
            isRenaming={isRenaming}
            renderChildren={() => (
              <DirContents path={fullPath} depth={depth + 1} />
            )}
          />
        );
      })}
    </>
  );
}
