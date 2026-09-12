/**
 * UNIT_BOUNDARY_DESCRIPTION: Where an agent's files were and where they go.
 *
 * The release this migrates from gave an agent one volume per declared mount —
 * typically its home and, beside it, its work tree. A node keeps one directory
 * instead, the home, with the work tree inside it exactly as the agent sees it.
 * So the move is not a copy but a merge, and which volume lands where is
 * decided by the path each was mounted at rather than by its name: a volume
 * mounted under the home belongs under the home.
 *
 * A volume mounted somewhere else entirely has nowhere to go. That is reported
 * rather than guessed at, because an agent whose data silently did not arrive
 * looks exactly like an agent that never had any.
 *
 * A move's destination is a path under the node's agent home, empty for the
 * home itself. They come back ordered shortest-first so the home is restored
 * before anything that lands inside it: extracting it over the top would bury
 * what was already put there.
 */
export interface MountedVolume {
  claimName: string;
  path: string;
}

export interface WorkspaceMove {
  claimName: string;
  destination: string;
}

export interface WorkspacePlan {
  moves: WorkspaceMove[];
  unplaceable: MountedVolume[];
}

export function planWorkspace(
  home: string,
  volumes: readonly MountedVolume[],
): WorkspacePlan {
  const root = home.replace(/\/+$/, "");
  const moves: WorkspaceMove[] = [];
  const unplaceable: MountedVolume[] = [];
  for (const volume of volumes) {
    const path = volume.path.replace(/\/+$/, "");
    if (path === root) {
      moves.push({ claimName: volume.claimName, destination: "" });
    } else if (path.startsWith(`${root}/`)) {
      moves.push({
        claimName: volume.claimName,
        destination: path.slice(root.length + 1),
      });
    } else {
      unplaceable.push(volume);
    }
  }
  moves.sort((a, b) => a.destination.length - b.destination.length);
  return { moves, unplaceable };
}
