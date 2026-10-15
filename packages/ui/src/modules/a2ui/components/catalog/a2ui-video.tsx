import type { VideoComponent } from "api-server-api/chat-forms";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { safeMediaUrl } from "../../lib/safe-url.js";

interface Props {
  component: VideoComponent;
}

export function A2uiVideo({ component }: Props) {
  const bindings = useA2uiBindings();
  const src = safeMediaUrl(bindings.text(component.url), "media");
  if (!src) return null;
  const poster =
    component.posterUrl === undefined
      ? undefined
      : (safeMediaUrl(bindings.text(component.posterUrl), "image") ??
        undefined);
  return (
    <video
      src={src}
      poster={poster}
      controls
      preload="metadata"
      className="max-h-80 w-full rounded-md bg-black"
    />
  );
}
