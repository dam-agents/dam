import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { ArtifactVersionInfo, LibraryArtifact } from "api-server-api";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { VersionList } from "./version-list.js";

export function VersionSwitcher({
  artifact,
  versions,
  current,
  total,
  onChange,
}: {
  artifact: LibraryArtifact;
  versions?: ArtifactVersionInfo[];
  current: number;
  total: number;
  onChange: (version: number) => void;
}) {
  if (total < 2) return null;
  const label = `v${current} / ${total}`;
  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Older version"
        tooltip="Older version"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      {versions && versions.length > 1 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="min-w-[52px] tabular-nums"
              tooltip="Version history"
            >
              {label}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-0">
            <VersionList
              artifact={artifact}
              versions={versions}
              current={current}
              onChange={onChange}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="min-w-[52px] text-center tabular-nums">{label}</span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Newer version"
        tooltip="Newer version"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
