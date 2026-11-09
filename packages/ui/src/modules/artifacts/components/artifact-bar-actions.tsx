import {
  AddComment,
  Calendar,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Launch,
  Maximize,
  Minimize,
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
            <Launch size={16} />
          </a>
        </Button>
      )}
    </>
  );
}

export function ArtifactPanelMenu({
  onEdit,
  onStartSession,
  fullPage,
  onToggleFullPage,
  onRename,
  onMove,
  source,
  onToggleSource,
  onSetRetention,
  onDelete,
}: {
  onEdit?: () => void;
  onStartSession?: () => void;
  fullPage: boolean;
  onToggleFullPage?: () => void;
  onRename: () => void;
  onMove: () => void;
  source: boolean;
  onToggleSource?: () => void;
  onSetRetention: () => void;
  onDelete: () => void;
}) {
  const leads = onEdit || onStartSession || onToggleFullPage;
  return (
    <RowActionsMenu label="More actions">
      {onEdit && (
        <DropdownMenuItem onSelect={onEdit}>
          <RequestQuote size={14} />
          Edit
        </DropdownMenuItem>
      )}
      {onStartSession && (
        <DropdownMenuItem onSelect={onStartSession}>
          <AddComment size={14} />
          Discuss with agent
        </DropdownMenuItem>
      )}
      {onToggleFullPage && (
        <DropdownMenuItem onSelect={onToggleFullPage}>
          {fullPage ? <Minimize size={14} /> : <Maximize size={14} />}
          {fullPage ? "Exit full page" : "Full page"}
        </DropdownMenuItem>
      )}
      {leads && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={onRename}>
        <Edit size={14} />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}>
        <FolderMoveTo size={14} />
        Move
      </DropdownMenuItem>
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
