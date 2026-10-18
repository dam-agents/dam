import {
  AddComment,
  Download,
  Launch,
  RequestQuote,
  Share,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import { Button } from "@/components/ui/button";

import { downloadArtifact } from "../lib/transfer.js";

export function ArtifactBarActions({
  artifact,
  onEdit,
  onShare,
  onStartSession,
}: {
  artifact: LibraryArtifact;
  onEdit?: () => void;
  onShare: () => void;
  onStartSession?: () => void;
}) {
  return (
    <>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit"
          tooltip="Edit"
          onClick={onEdit}
        >
          <RequestQuote size={16} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Share"
        tooltip="Share"
        onClick={onShare}
      >
        <Share size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Download"
        tooltip="Download"
        onClick={() => void downloadArtifact(artifact.id)}
      >
        <Download size={16} />
      </Button>
      {artifact.shareUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in new tab"
          tooltip="Open in new tab"
          asChild
        >
          <a href={artifact.shareUrl} target="_blank" rel="noopener noreferrer">
            <Launch size={16} />
          </a>
        </Button>
      )}
      {onStartSession && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Discuss with agent"
          tooltip="Discuss with agent"
          onClick={onStartSession}
        >
          <AddComment size={16} />
        </Button>
      )}
    </>
  );
}
