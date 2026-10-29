import {
  Calendar,
  ChatBot,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { useArtifactDeletion } from "../hooks/use-artifact-deletion.js";
import { downloadArtifact } from "../lib/transfer.js";

export function ArtifactRowMenuItems({
  artifact,
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: {
  artifact: LibraryArtifact;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}) {
  const deleteArtifact = useArtifactDeletion();

  return (
    <>
      <DropdownMenuItem onSelect={() => {}}>
        <ChatBot size={13} /> Ask agent to edit
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onRename(artifact)}>
        <Edit size={13} /> Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMove(artifact)}>
        <FolderMoveTo size={13} /> Move
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onShare(artifact)}>
        <Share size={13} /> Share
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => {}}>
        <Code size={13} /> View source
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void downloadArtifact(artifact.id)}>
        <Download size={13} /> Download
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onSetRetention(artifact)}>
        <Calendar size={13} /> Set expiration
      </DropdownMenuItem>
      <DropdownMenuItem
        tone="danger"
        onSelect={() => void deleteArtifact(artifact)}
      >
        <TrashCan size={13} /> Delete
      </DropdownMenuItem>
    </>
  );
}
