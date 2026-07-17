import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import {
  ChevronDown,
  Folder,
  Link as LinkIcon,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ArtifactRow, type ArtifactRowActions } from "./artifact-row.js";

export interface FolderGroupActions {
  onEditFolder: (folder: ArtifactFolder) => void;
  onDeleteFolder: (folder: ArtifactFolder) => void;
  onCopyFolderLink: (folder: ArtifactFolder) => Promise<string | null>;
}

interface Props extends ArtifactRowActions, Partial<FolderGroupActions> {
  /** null renders the "Ungrouped" section (no folder actions). */
  folder: ArtifactFolder | null;
  artifacts: LibraryArtifact[];
}

export function FolderGroup({
  folder,
  artifacts,
  onEditFolder,
  onDeleteFolder,
  onCopyFolderLink,
  ...rowActions
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const sharedCount = artifacts.filter((a) => a.visibility === "public").length;

  return (
    <Card className="overflow-hidden anim-in">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setCollapsed((c) => !c);
        }}
        className="group flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/60"
      >
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
        {folder && (
          <Folder size={16} className="shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "text-[14px] font-semibold",
            folder ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {folder?.name ?? "Ungrouped"}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
        </span>
        {folder && sharedCount > 0 && (
          <Badge variant="success">{sharedCount} shared</Badge>
        )}
        {folder && (
          <div
            className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Folder actions">
                  <MoreVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={sharedCount === 0}
                  onSelect={() => {
                    void onCopyFolderLink?.(folder).then((url) => {
                      if (url) void navigator.clipboard.writeText(url);
                    });
                  }}
                >
                  <LinkIcon size={14} />
                  Copy folder link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEditFolder?.(folder)}>
                  <Pencil size={14} />
                  Edit folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => onDeleteFolder?.(folder)}
                >
                  <Trash2 size={14} />
                  Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {!collapsed && (
        <div>
          {artifacts.length === 0 ? (
            <p className="border-t border-border px-4 py-4 text-[12px] text-muted-foreground">
              No artifacts in this folder yet.
            </p>
          ) : (
            artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                {...rowActions}
              />
            ))
          )}
        </div>
      )}
    </Card>
  );
}
