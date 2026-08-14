import { EXPERIMENT_FEED_MESSAGE_TYPE, type TraceFeed } from "api-server-api";
import { useMemo } from "react";

import { useArtifactPreview } from "../../artifacts/api/queries.js";
import { DeferredFrame } from "../../artifacts/components/deferred-frame.js";

export function DashboardCanvas({
  dashboardArtifactId,
  feed,
}: {
  dashboardArtifactId: string | null;
  feed: TraceFeed | undefined;
}) {
  const { data: preview, isError } = useArtifactPreview(dashboardArtifactId);
  const postData = useMemo(
    () => (feed ? { type: EXPERIMENT_FEED_MESSAGE_TYPE, feed } : undefined),
    [feed],
  );

  if (!dashboardArtifactId) {
    return (
      <NativeFallback feed={feed} note="This experiment has no dashboard." />
    );
  }
  if (isError) {
    return (
      <NativeFallback
        feed={feed}
        note="The dashboard artifact is gone — re-register the plan to recreate it."
      />
    );
  }
  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading dashboard…
      </div>
    );
  }
  return (
    <DeferredFrame
      html={preview}
      title="Experiment dashboard"
      className="h-full w-full"
      deferMs={0}
      postData={postData}
    />
  );
}

function NativeFallback({
  feed,
  note,
}: {
  feed: TraceFeed | undefined;
  note: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <p>{note}</p>
      {feed && (
        <p>
          {feed.stages.map((s) => `${s.id}: ${s.spansTotal}`).join(" · ") ||
            "no stages declared"}
        </p>
      )}
    </div>
  );
}
