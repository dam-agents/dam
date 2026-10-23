import {
  AddComment,
  Calendar,
  Download,
  Edit,
  FolderMoveTo,
  RequestQuote,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../store.js";
import { useDeleteArtifact } from "../api/mutations.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import { isEditableArtifact } from "../lib/editable.js";
import { downloadArtifact } from "../lib/transfer.js";

const MENU_PARTS = {
  dropdown: { Item: DropdownMenuItem, Separator: DropdownMenuSeparator },
  context: { Item: ContextMenuItem, Separator: ContextMenuSeparator },
};

export function ArtifactRowMenuItems({
  artifact,
  onEdit,
  onRename,
  onMove,
  onShare,
  onSetRetention,
  menu = "dropdown",
}: {
  artifact: LibraryArtifact;
  onEdit: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
  menu?: keyof typeof MENU_PARTS;
}) {
  const { Item, Separator } = MENU_PARTS[menu];
  const showConfirm = useStore((s) => s.showConfirm);
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const setDock = useStore((s) => s.setDock);
  const { mutate: deleteArtifact } = useDeleteArtifact();
  const startSession = useStartArtifactSession(artifact);

  const confirmAndDelete = async () => {
    const confirmed = await showConfirm(
      "All versions are deleted and its share link stops working. This cannot be undone.",
      `Delete “${artifact.title}”?`,
      { kind: "destructive", confirmLabel: "Delete" },
    );
    if (!confirmed) return;

    if (openArtifactId === artifact.id) setDock(null);
    deleteArtifact({ id: artifact.id });
  };

  return (
    <>
      {isEditableArtifact(artifact) && (
        <Item onSelect={() => onEdit(artifact)}>
          <RequestQuote size={14} />
          Edit
        </Item>
      )}
      <Item onSelect={() => onRename(artifact)}>
        <Edit size={14} />
        Rename
      </Item>
      <Item onSelect={() => onMove(artifact)}>
        <FolderMoveTo size={14} />
        Move
      </Item>
      <Item onSelect={() => onShare(artifact)}>
        <Share size={14} />
        Share
      </Item>
      <Item onSelect={() => void downloadArtifact(artifact.id)}>
        <Download size={14} />
        Download
      </Item>
      {startSession.available && (
        <Item onSelect={startSession.start}>
          <AddComment size={14} />
          Discuss with agent
        </Item>
      )}
      <Separator />
      <Item onSelect={() => onSetRetention(artifact)}>
        <Calendar size={14} />
        Set expiration
      </Item>
      <Item tone="danger" onSelect={() => void confirmAndDelete()}>
        <TrashCan size={14} />
        Delete artifact
      </Item>
    </>
  );
}
