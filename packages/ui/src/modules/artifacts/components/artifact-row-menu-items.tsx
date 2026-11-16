import {
  AddComment,
  Calendar,
  Download,
  Edit,
  FolderMoveTo,
  MachineLearningModel,
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

import { useConfirmDeleteArtifact } from "../hooks/use-confirm-delete-artifact.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import { isEditableArtifact } from "../lib/editable.js";
import { picksPromptModel } from "../lib/prompt-model.js";
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
  onSetPromptModel,
  menu = "dropdown",
}: {
  artifact: LibraryArtifact;
  onEdit: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
  onSetPromptModel: (artifact: LibraryArtifact) => void;
  menu?: keyof typeof MENU_PARTS;
}) {
  const { Item, Separator } = MENU_PARTS[menu];
  const confirmAndDelete = useConfirmDeleteArtifact();
  const startSession = useStartArtifactSession(artifact);

  return (
    <>
      {isEditableArtifact(artifact) && (
        <Item onSelect={() => onEdit(artifact)}>
          <RequestQuote size={14} />
          Edit source
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
          Start a new session
        </Item>
      )}
      {startSession.available && picksPromptModel(artifact) && (
        <Item onSelect={() => onSetPromptModel(artifact)}>
          <MachineLearningModel size={14} />
          Set model
        </Item>
      )}
      <Separator />
      <Item onSelect={() => onSetRetention(artifact)}>
        <Calendar size={14} />
        Set expiration
      </Item>
      <Item tone="danger" onSelect={() => void confirmAndDelete(artifact)}>
        <TrashCan size={14} />
        Delete artifact
      </Item>
    </>
  );
}
