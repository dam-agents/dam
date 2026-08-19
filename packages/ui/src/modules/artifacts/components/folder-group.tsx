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
import { DisclosureToggle } from "@/components/ui/disclosure";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { SectionLabel } from "@/components/ui/section-label";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

import {
  type FolderDropCallbacks,
  useFolderDropTarget,
} from "../hooks/use-artifact-row-drag.js";
import { ArtifactRow, type ArtifactRowActions } from "./artifact-row.js";

const INERT_DROP: FolderDropCallbacks = {
  onStart: () => {},
  onEnd: () => {},
  onEnter: () => {},
  onLeave: () => {},
  onDrop: () => {},
};

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
  folder: ArtifactFolder | null;
  artifacts: LibraryArtifact[];
  displayName?: string;
  defaultCollapsed?: boolean;
  nested?: boolean;
  sections?: FolderSection[];
  drop?: FolderDropCallbacks;
  dropActive?: boolean;
}

export function FolderGroup({
  folder,
  artifacts,
  displayName,
  defaultCollapsed = false,
  nested = false,
  sections,
  drop,
  dropActive = false,
  onEditFolder,
  onDeleteFolder,
  onCopyFolderLink,
  ...rowActions
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const dropTarget = useFolderDropTarget(
    folder?.id ?? null,
    drop ?? INERT_DROP,
  );
  const { copy } = useCopy();
  const sharedCount = artifacts.filter((a) => a.visibility === "public").length;
  const Wrapper = nested ? "div" : Card;

  return (
    <Wrapper
      {...(drop ? dropTarget : {})}
      className={cn(
        "overflow-hidden",
        nested ? "border-t border-border/60" : "anim-in",
        dropActive && "ring-2 ring-inset ring-primary",
      )}
    >
      <div className="group flex select-none items-center pr-3.5 transition-colors hover:bg-muted/60">
        <DisclosureToggle
          open={!collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          chevronClassName="text-muted-foreground"
          className="min-w-0 flex-1 cursor-pointer gap-2.5 py-2.5 pl-3.5"
        >
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
        </DisclosureToggle>
        {folder && (
          <div className={cn("ml-auto", HOVER_ACTION)}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Folder actions"
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={sharedCount === 0}
                  onSelect={() =>
                    void copy(
                      () => onCopyFolderLink?.(folder) ?? Promise.resolve(null),
                    )
                  }
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
                    drag={drop}
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
                drag={drop}
                {...rowActions}
              />
            ))
          )}
        </div>
      )}
    </Wrapper>
  );
}
