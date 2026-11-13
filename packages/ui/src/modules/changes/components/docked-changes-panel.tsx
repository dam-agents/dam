import { ChevronDown, Close } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { DiffLayout } from "../lib/diff-layout.js";
import { choose, initialSelection } from "../lib/selection.js";
import { MOCK_CHANGE_SETS, MOCK_DIFFS } from "../mock-data.js";
import type { CompareTo } from "../types.js";
import { ChangeSetSelect } from "./change-set-select.js";
import { ChangeSetSummary } from "./change-set-summary.js";
import { ChangedFileList } from "./changed-file-list.js";
import { FileDiffCard } from "./file-diff-card.js";

export function DockedChangesPanel({
  initialPath,
  onClose,
}: {
  initialPath?: string | null;
  onClose: () => void;
}) {
  const changeSets = MOCK_CHANGE_SETS;

  const [selection, setSelection] = useState(() => {
    const init = initialSelection(changeSets);
    return initialPath ? { ...init, path: initialPath } : init;
  });
  const [compareTo, setCompareTo] = useState<CompareTo>("base");
  const [layout, setLayout] = useState<DiffLayout>("unified");

  const selectedCs = changeSets.find((cs) => cs.path === selection.path);
  const diff = selection.path ? MOCK_DIFFS[selection.path] : null;

  if (changeSets.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="flex-1 truncate text-sm font-medium text-foreground">
            Changes
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Close"
            tooltip="Close"
            onClick={onClose}
          >
            <Close size={16} />
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-sm text-muted-foreground">
            No git repositories found.
          </p>
        </div>
      </div>
    );
  }

  const files = diff?.files ?? [];
  const isEmpty = files.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <ChangeSetSelect
          changeSets={changeSets}
          selectedPath={selection.path}
          onSelect={(path) => setSelection(choose(selection, path, changeSets))}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2.5 text-xs hover:bg-muted"
            >
              <span className="font-medium text-foreground">
                {compareTo === "base" ? "vs base" : "Uncommitted"}
              </span>
              <ChevronDown
                size={12}
                className="shrink-0 text-muted-foreground"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCompareTo("base")}>
              vs base
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCompareTo("uncommitted")}>
              Uncommitted
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex h-8 shrink-0 items-center rounded-md border border-input p-0.5">
          {(["unified", "split"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLayout(opt)}
              className={`h-full rounded px-2.5 text-xs font-medium transition-colors ${
                layout === opt
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt === "unified" ? "Unified" : "Split"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={onClose}
        >
          <Close size={16} />
        </Button>
      </div>

      {selectedCs && <ChangeSetSummary changeSet={selectedCs} />}

      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-sm text-muted-foreground">
            {compareTo === "uncommitted"
              ? "No uncommitted changes."
              : "No changes against the base."}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChangedFileList files={files} />
          <div className="space-y-3 p-4">
            {files.map((file) => (
              <FileDiffCard key={file.path} file={file} layout={layout} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
