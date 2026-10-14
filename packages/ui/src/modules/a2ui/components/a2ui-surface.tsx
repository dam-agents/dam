import { useA2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { A2uiSurfaceProvider } from "../contexts/a2ui-surface-context.js";
import { useA2uiSurfaceState } from "../hooks/use-a2ui-surface-state.js";
import type { SurfaceState } from "../lib/conversation.js";
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
