import { useDirSnapshot } from "../api/queries.js";
import { DirEntryRow } from "./dir-entry-row.js";
import { useFilesPanel } from "./files-panel-controller.js";

interface Props {
  path: string;
  depth: number;
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
      {snapshot.entries.map((entry) => (
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
