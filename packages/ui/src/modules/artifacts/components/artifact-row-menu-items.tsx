import type { LibraryArtifact } from "api-server-api";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../store.js";
import { useDeleteArtifact } from "../api/mutations.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import { isEditableArtifact } from "../lib/editable.js";
import { downloadArtifact } from "../lib/transfer.js";

export function ArtifactRowMenuItems({
  artifact,
  onEdit,
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: {
  artifact: LibraryArtifact;
  onEdit: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const { mutate: deleteArtifact } = useDeleteArtifact();
  const startSession = useStartArtifactSession(artifact);

  const confirmAndDelete = async () => {
    const confirmed = await showConfirm(
      "All versions are deleted and its share link stops working. This cannot be undone.",
      `Delete “${artifact.title}”?`,
      { kind: "destructive", confirmLabel: "Delete" },
    );
    if (!confirmed) return;

    if (openArtifactId === artifact.id) setOpenArtifactId(null);
    deleteArtifact({ id: artifact.id });
  };

  return (
    <>
      {isEditableArtifact(artifact) && (
        <DropdownMenuItem onSelect={() => onEdit(artifact)}>
          Edit
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => onRename(artifact)}>
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMove(artifact)}>
        Move to folder…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onShare(artifact)}>
        Share
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void downloadArtifact(artifact.id)}>
        Download
      </DropdownMenuItem>
      {startSession.available && (
        <DropdownMenuItem onSelect={() => void startSession.start()}>
          Start a new session
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onSetRetention(artifact)}>
        Delete after…
      </DropdownMenuItem>
      <DropdownMenuItem tone="danger" onSelect={() => void confirmAndDelete()}>
        Delete artifact
      </DropdownMenuItem>
    </>
  );
}
