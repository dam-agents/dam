import {
  Edit,
  Folder,
  Link,
  OverflowMenuVertical,
  TrashCan,
} from "@carbon/icons-react";
import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DisclosureChevron } from "@/components/ui/disclosure";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ArtifactRow, type ArtifactRowActions } from "./artifact-row.js";

export interface FolderGroupActions {
  onEditFolder: (folder: ArtifactFolder) => void;
  onDeleteFolder: (folder: ArtifactFolder) => void;
  onCopyFolderLink: (folder: ArtifactFolder) => Promise<string | null>;
}

export interface FolderSection {
  label: string;
  artifacts: LibraryArtifact[];
}

interface Props extends ArtifactRowActions, Partial<FolderGroupActions> {
  /** null renders the "Ungrouped" section (no folder actions). */
  folder: ArtifactFolder | null;
  artifacts: LibraryArtifact[];
  /** Shown instead of the folder's raw name (e.g. with a prefix stripped). */
  displayName?: string;
  defaultCollapsed?: boolean;
  /** Renders as a borderless row for stacking inside a parent section card. */
  nested?: boolean;
  /** Subheaded clusters rendered instead of the flat list (a partition of
   *  `artifacts`, which still drives the header counts). */
  sections?: FolderSection[];
}

export function FolderGroup({
  folder,
  artifacts,
  displayName,
  defaultCollapsed = false,
  nested = false,
  sections,
  onEditFolder,
  onDeleteFolder,
  onCopyFolderLink,
  ...rowActions
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const sharedCount = artifacts.filter((a) => a.visibility === "public").length;
  const Wrapper = nested ? "div" : Card;

  return (
    <Wrapper
      className={cn(
        "overflow-hidden",
        nested ? "border-t border-border/60" : "anim-in",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setCollapsed((c) => !c);
        }}
        className="group flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/60"
      >
        <DisclosureChevron
          open={!collapsed}
          className="text-muted-foreground"
        />
        {folder && (
          <Folder size={16} className="shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "text-sm font-semibold",
            folder ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {displayName ?? folder?.name ?? "Ungrouped"}
        </span>
        <span className="text-xs text-muted-foreground">
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
                  <OverflowMenuVertical size={16} />
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
                  <Link size={14} />
                  Copy folder link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEditFolder?.(folder)}>
                  <Edit size={14} />
                  Edit folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => onDeleteFolder?.(folder)}
                >
                  <TrashCan size={14} />
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
            <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground">
              No artifacts in this folder yet.
            </p>
          ) : sections ? (
            sections.map((section) => (
              <div key={section.label}>
                <SectionLabel className="block border-t border-border/60 bg-muted/40 px-4 py-1.5">
                  {section.label}
                </SectionLabel>
                {section.artifacts.map((artifact) => (
                  <ArtifactRow
                    key={artifact.id}
                    artifact={artifact}
                    {...rowActions}
                  />
                ))}
              </div>
            ))
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
    </Wrapper>
  );
}
