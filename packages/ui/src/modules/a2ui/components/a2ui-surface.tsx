import { useMemo } from "react";

import { useA2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { A2uiSurfaceProvider } from "../contexts/a2ui-surface-context.js";
import { useA2uiSurfaceState } from "../hooks/use-a2ui-surface-state.js";
import { renderedNodeCount, type SurfaceState } from "../lib/conversation.js";
import { MAX_RENDERED_NODES } from "../lib/limits.js";
import { A2uiNode } from "./a2ui-node.js";

interface Props {
  surface: SurfaceState;
}

export function A2uiSurface({ surface }: Props) {
  const conversation = useA2uiConversationState();
  const state = useA2uiSurfaceState(
    surface,
    conversation?.liveMessageId === surface.lastTouchMessageId,
    conversation?.sessionKey ?? "",
    conversation?.withRendererMetadata ?? ((text) => text),
  );
  const tooLarge = useMemo(
    () =>
      renderedNodeCount(surface, state.dataModel, MAX_RENDERED_NODES) >
      MAX_RENDERED_NODES,
    [surface, state.dataModel],
  );
  if (tooLarge)
    return (
      <p className="not-prose text-xs text-danger">
        This form is too large to show: it has more than {MAX_RENDERED_NODES}{" "}
        elements.
      </p>
    );
  return (
    <A2uiSurfaceProvider value={state}>
      <div
        data-testid="a2ui-surface"
        data-surface-id={surface.id}
        className="not-prose flex w-full max-w-[640px] flex-col gap-4 text-sm"
      >
        <A2uiNode id="root" depth={0} />
      </div>
    </A2uiSurfaceProvider>
  );
}
