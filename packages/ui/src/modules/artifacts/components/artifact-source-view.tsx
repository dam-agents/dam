import type { LibraryArtifact } from "api-server-api";

import { HighlightedCode } from "@/components/highlighted-code";
import { PanelMessage } from "@/components/ui/empty-state";

import { CodeEditor } from "../../files/components/code-editor.js";
import type { useArtifactContent } from "../api/queries.js";

export function ArtifactSourceView({
  artifact,
  content,
  isLoading,
  editMode,
  draft,
  onDraftChange,
  onSave,
}: {
  artifact: LibraryArtifact;
  content: ReturnType<typeof useArtifactContent>["data"];
  isLoading: boolean;
  editMode?: boolean;
  draft?: string;
  onDraftChange?: (next: string) => void;
  onSave?: () => void;
}) {
  if (isLoading) return <PanelMessage>Loading preview…</PanelMessage>;
  if (!content || content.tooLarge) {
    return (
      <PanelMessage>
        {content?.tooLarge
          ? "Too large to preview — download instead."
          : "No preview available."}
      </PanelMessage>
    );
  }
  if (editMode && onDraftChange && onSave) {
    return (
      <div className="h-full overflow-hidden">
        <CodeEditor
          value={draft ?? content.content}
          path={content.fileName}
          onChange={onDraftChange}
          onSave={onSave}
        />
      </div>
    );
  }
  if (content.binary && content.contentType.startsWith("image/")) {
    return (
      <img
        src={`data:${content.contentType};base64,${content.content}`}
        alt={artifact.title}
        className="max-h-[55dvh] rounded border border-border"
      />
    );
  }
  if (content.binary) {
    return <PanelMessage>Binary file — download to view.</PanelMessage>;
  }
  return <HighlightedCode code={content.content} path={content.fileName} />;
}
