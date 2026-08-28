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
  return (
    <div className="space-y-3">
      {artifact.brief ? <Brief text={artifact.brief} /> : null}
      <Source artifact={artifact} content={content} />
    </div>
  );
}

function Source({
  artifact,
  content,
}: {
  artifact: LibraryArtifact;
  content: ReturnType<typeof useArtifactContent>["data"];
}) {
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

function Brief({ text }: { text: string }) {
  return (
    <section className="rounded border border-border bg-muted/40 p-3">
      <h3 className="text-xs font-medium text-foreground">Brief</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Standing instructions the agent left for itself. They go with every
        request this page makes.
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{text}</p>
    </section>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
  );
}
