import {
  AddComment,
  Calendar,
  ChevronDown,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Popup,
  RequestQuote,
  TrashCan,
  View,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import { routeToPath } from "../../platform/lib/routes.js";
import { downloadArtifact } from "../lib/transfer.js";
import { VISIBILITY_OPTIONS } from "./share-visibility-choice.js";

export function ArtifactShareButton({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare: () => void;
}) {
  const { label, description, Icon } = VISIBILITY_OPTIONS[artifact.visibility];
  return (
    <Button
      variant="outline"
      size="xs"
      className="shrink-0"
      aria-haspopup="dialog"
      aria-label={`Share: ${label}`}
      tooltip={`${label} — ${description.toLowerCase()}. Change who can open it`}
      onClick={onShare}
    >
      <Icon size={14} />
      {label}
      <ChevronDown size={12} className="-mr-0.5 text-muted-foreground" />
    </Button>
  );
}

export function ArtifactBarActions({
  artifact,
  newTab,
}: {
  artifact: LibraryArtifact;
  newTab: boolean;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Download"
        tooltip="Download"
        onClick={() => void downloadArtifact(artifact.id)}
      >
        <Download size={16} />
      </Button>
      {newTab && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Open in new tab"
          tooltip="Open in new tab"
          asChild
        >
          <a
            href={routeToPath({ view: "artifact", artifactId: artifact.id })}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Popup size={16} />
          </a>
        </Button>
      )}
    </>
  );
}

export function ArtifactPanelMenu({
  onRename,
  onMove,
  onEdit,
  onStartSession,
  source,
  onToggleSource,
  onSetRetention,
  onDelete,
}: {
  onRename: () => void;
  onMove: () => void;
  onEdit?: () => void;
  onStartSession?: () => void;
  source: boolean;
  onToggleSource?: () => void;
  onSetRetention: () => void;
  onDelete: () => void;
}) {
  return (
    <RowActionsMenu label="More actions">
      <DropdownMenuItem onSelect={onRename}>
        <Edit size={14} />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}>
        <FolderMoveTo size={14} />
        Move
      </DropdownMenuItem>
      {(onEdit || onStartSession) && <DropdownMenuSeparator />}
      {onEdit && (
        <DropdownMenuItem onSelect={onEdit}>
          <RequestQuote size={14} />
          Edit source
        </DropdownMenuItem>
      )}
      {onStartSession && (
        <DropdownMenuItem onSelect={onStartSession}>
          <AddComment size={14} />
          Start a new session
        </DropdownMenuItem>
      )}
      {onToggleSource && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onToggleSource}>
            {source ? <View size={14} /> : <Code size={14} />}
            {source ? "View preview" : "View source"}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSetRetention}>
        <Calendar size={14} />
        Set expiration
      </DropdownMenuItem>
      <DropdownMenuItem tone="danger" onSelect={onDelete}>
        <TrashCan size={14} />
        Delete artifact
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
