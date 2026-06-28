import { X } from "lucide-react";

import { useStore } from "../../../store.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { LogPanel } from "../components/log-panel.js";

export function ArtifactPanel({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
  const content = useStore((s) => s.artifactContent);
  const closeArtifact = useStore((s) => s.closeArtifact);

  const title =
    content?.kind === "file"
      ? (content.path.split("/").pop() ?? "File")
      : content?.kind === "log"
        ? "Logs"
        : "Artifact";

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-3 h-10 border-b border-border shrink-0">
        <span className="text-[12px] font-medium text-foreground flex-1 truncate">
          {title}
        </span>
        <button
          onClick={closeArtifact}
          className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-hidden">
        {content?.kind === "file" && <FilesPanel onOpenFile={onOpenFile} />}
        {content?.kind === "log" && <LogPanel />}
        {!content && (
          <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
            No artifact open
          </div>
        )}
      </div>
    </div>
  );
}
