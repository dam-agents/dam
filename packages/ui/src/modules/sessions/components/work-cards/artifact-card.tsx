import {
  ChatBot,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Locked,
  OverflowMenuVertical,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../../store.js";
import type { WorkArtifact } from "../../../../types.js";
import { WorkCardShell } from "./work-card-shell.js";

function VisibilityLabel({ accessLabel }: { accessLabel?: string }) {
  const label = accessLabel?.toLowerCase();
  if (!label || label === "private" || label === "only you") {
    return (
      <>
        <Locked size={12} />
        Private
      </>
    );
  }
  return (
    <>
      <Share size={12} />
      {accessLabel}
    </>
  );
}

function ArtifactTrailingMenu() {
  const showConfirm = useStore.getState().showConfirm;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Artifact actions">
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => {}}>
            <ChatBot size={13} /> Ask agent to edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Edit size={13} /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <FolderMoveTo size={13} /> Move
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => {}}>
            <Share size={13} /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Code size={13} /> View source
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {}}>
            <Download size={13} /> Download
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={async () => {
              await showConfirm(
                "This will permanently delete the artifact.",
                "Delete artifact",
                { kind: "destructive" },
              );
            }}
          >
            <TrashCan size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function expiryLabel(expiresAt: string | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / 86_400_000);
  if (days === 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

export function ArtifactCard({ part }: { part: WorkArtifact }) {
  const expiry = expiryLabel(part.expiresAt);

  return (
    <WorkCardShell
      title={part.title}
      detail={
        <span className="inline-flex items-center gap-1">
          {part.artifactKind}
          <span className="mx-0.5">·</span>
          <VisibilityLabel accessLabel={part.accessLabel} />
          {expiry && (
            <>
              <span className="mx-0.5">·</span>
              {expiry}
            </>
          )}
        </span>
      }
      trailing={<ArtifactTrailingMenu />}
      onClick={() => {}}
    />
  );
}
