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
        <Item onSelect={() => onEdit(artifact)}>Edit</Item>
      )}
      <Item onSelect={() => onRename(artifact)}>Rename</Item>
      <Item onSelect={() => onMove(artifact)}>Move</Item>
      <Item onSelect={() => onShare(artifact)}>Share</Item>
      <Item onSelect={() => void downloadArtifact(artifact.id)}>Download</Item>
      {startSession.available && (
        <Item onSelect={startSession.start}>Discuss with agent</Item>
      )}
      <Separator />
      <Item onSelect={() => onSetRetention(artifact)}>Set expiration</Item>
      <Item tone="danger" onSelect={() => void confirmAndDelete()}>
        Delete artifact
      </Item>
    </>
  );
}
