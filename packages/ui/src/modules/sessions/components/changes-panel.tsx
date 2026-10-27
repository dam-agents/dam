import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { getMockDiff } from "./work-cards/mock-diff.js";

export function ChangesPanel() {
  const data = useStore((s) => s.openChangesData);
  const close = useStore((s) => s.setOpenChangesData);
  const setSelected = useStore((s) => s.setChangesSelectedFile);

  if (!data) return null;

  const selected = data.selectedFile;
  const selectedEntry = data.files.find((f) => f.path === selected);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          Changes &middot; {data.files.length} file
          {data.files.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-y-auto border-r border-border">
          {data.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelected(file.path)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${
                file.path === selected
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {file.path}
              </span>
              <span className="shrink-0 text-[#24a148]">
                +{file.insertions}
              </span>
              <span className="shrink-0 text-[#dc2626]">-{file.deletions}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-auto bg-muted/30 p-4">
          {selectedEntry ? (
            <pre className="font-mono text-xs leading-relaxed">
              {getMockDiff(selectedEntry)
                .split("\n")
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "bg-[#24a148]/10 text-[#24a148]"
                        : line.startsWith("-")
                          ? "bg-[#dc2626]/10 text-[#dc2626]"
                          : line.startsWith("@@")
                            ? "text-muted-foreground"
                            : "text-foreground"
                    }
                  >
                    {line}
                  </div>
                ))}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a file to view changes
            </p>
          )}
        </div>
      </div>

      {data.summary && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {data.summary}
        </div>
      )}
    </div>
  );
}
