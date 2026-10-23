import type { LibraryArtifact } from "api-server-api";

import { HighlightedCode } from "@/components/highlighted-code";

import type { useArtifactContent } from "../api/queries.js";

export function ArtifactSourceView({
  artifact,
  content,
  isLoading,
}: {
  artifact: LibraryArtifact;
  content: ReturnType<typeof useArtifactContent>["data"];
  isLoading: boolean;
}) {
  if (isLoading) return <Note text="Loading preview…" />;
  if (!content || content.tooLarge) {
    return (
      <Note
        text={
          content?.tooLarge
            ? "Too large to preview — download instead."
            : "No preview available."
        }
      />
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
    return <Note text="Binary file — download to view." />;
  }
  return <HighlightedCode code={content.content} path={content.fileName} />;
}

function Note({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
  );
}
