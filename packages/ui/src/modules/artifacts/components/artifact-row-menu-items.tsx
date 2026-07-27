import type { LibraryArtifact } from "api-server-api";
import { Download, Share2, Trash2 } from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { useArtifactDeletion } from "../hooks/use-artifact-deletion.js";
import { downloadArtifact } from "../lib/transfer.js";

/** The per-artifact row menu, defined once for every surface that lists
 *  artifacts. Sharing is the only action the surface has to own: the menu
 *  unmounts on select, so it can't host the dialog itself. */
export function ArtifactRowMenuItems({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare: (artifact: LibraryArtifact) => void;
}) {
  const deleteArtifact = useArtifactDeletion();

  return (
    <>
      <DropdownMenuItem onSelect={() => onShare(artifact)}>
        <Share2 size={14} />
        Sharing…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void downloadArtifact(artifact.id)}>
        <Download size={14} />
        Download
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        tone="danger"
        onSelect={() => void deleteArtifact(artifact)}
      >
        <Trash2 size={14} />
        Delete
      </DropdownMenuItem>
    </>
  );
}
