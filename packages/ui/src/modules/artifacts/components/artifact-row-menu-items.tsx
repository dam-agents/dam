import type { LibraryArtifact } from "api-server-api";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { useArtifactDeletion } from "../hooks/use-artifact-deletion.js";
import { downloadArtifact } from "../lib/transfer.js";

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
        Share
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void downloadArtifact(artifact.id)}>
        Download
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        tone="danger"
        onSelect={() => void deleteArtifact(artifact)}
      >
        Delete artifact
      </DropdownMenuItem>
    </>
  );
}
