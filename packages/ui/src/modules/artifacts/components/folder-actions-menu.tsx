import { Edit, Link, TrashCan } from "@carbon/icons-react";
import type { ArtifactFolder } from "api-server-api";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { useCopy } from "@/hooks/use-copy";

import { api } from "../../../api.js";
import { toastCopyOutcome } from "../lib/share-link.js";

export function FolderActionsMenu({
  folder,
  shared,
  onEdit,
  onDelete,
}: {
  folder: ArtifactFolder;
  shared: boolean;
  onEdit: (folder: ArtifactFolder) => void;
  onDelete: (folder: ArtifactFolder) => void;
}) {
  const { copy } = useCopy();
  return (
    <RowActionsMenu label="Folder actions" dense>
      <DropdownMenuItem
        disabled={!shared}
        onSelect={() =>
          void copy(() =>
            api.artifactLibrary.folderShareUrl.query({ id: folder.id }),
          ).then(toastCopyOutcome)
        }
      >
        <Link size={14} />
        Copy folder link
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onEdit(folder)}>
        <Edit size={14} />
        Edit folder
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem tone="danger" onSelect={() => onDelete(folder)}>
        <TrashCan size={14} />
        Delete folder
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
