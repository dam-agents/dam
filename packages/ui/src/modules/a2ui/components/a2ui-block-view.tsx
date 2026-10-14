import { Spinner } from "@/components/ui/spinner";

import { useA2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { A2uiFunctionCallNotice } from "./a2ui-function-call-notice.js";
import { A2uiInvalid } from "./a2ui-invalid.js";
import { A2uiSurface } from "./a2ui-surface.js";

function Note({ children }: { children: string }) {
  return <p className="text-xs italic text-muted-foreground">{children}</p>;
}

function OwnedSurface({ surfaceId }: { surfaceId: string }) {
  const surface =
    useA2uiConversationState()?.conversation.surfaces.get(surfaceId);
  if (!surface) return null;
  if (surface.deleted) return <Note>This form was closed.</Note>;
  return (
    <A2uiSurface key={`${surface.id}:${surface.version}`} surface={surface} />
  );
}

function TouchedNote({
  surfaceId,
  closed,
}: {
  surfaceId: string;
  closed: boolean;
}) {
  return (
    <Note>
      {closed
        ? `Closed the form “${surfaceId}” above.`
        : `Updated the form “${surfaceId}” above.`}
    </Note>
  );
}

interface Props {
  blockKey: string;
  source: string;
}

export function A2uiBlockView({ blockKey, source }: Props) {
  const outcome = useA2uiConversationState()?.conversation.blocks.get(blockKey);
  if (!outcome) return null;
  const { owned, touched, closed, errors, functionCalls, streaming } = outcome;
  return (
    <div className="flex flex-col gap-3">
      {owned.map((id) => (
        <OwnedSurface key={id} surfaceId={id} />
      ))}
      {touched
        .filter((id) => !owned.includes(id))
        .map((id) => (
          <TouchedNote key={id} surfaceId={id} closed={closed.includes(id)} />
        ))}
      {functionCalls.map((call) => (
        <A2uiFunctionCallNotice
          key={call.response.functionCallId}
          outcome={call}
        />
      ))}
      {errors.length > 0 && <A2uiInvalid errors={errors} source={source} />}
      {streaming && owned.length === 0 && touched.length === 0 && (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Preparing a form…
        </span>
      )}
    </div>
  );
}
