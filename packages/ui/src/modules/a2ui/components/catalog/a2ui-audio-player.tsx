import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { safeMediaUrl } from "../../lib/safe-url.js";
import type { AudioPlayerComponent } from "../../lib/schema.js";

interface Props {
  component: AudioPlayerComponent;
}

export function A2uiAudioPlayer({ component }: Props) {
  const bindings = useA2uiBindings();
  const src = safeMediaUrl(bindings.text(component.url), "media");
  if (!src) return null;
  const description = bindings.text(component.description);
  return (
    <figure className="flex flex-col gap-1.5">
      {description && (
        <figcaption className="text-sm text-muted-foreground">
          {description}
        </figcaption>
      )}
      <audio src={src} controls preload="metadata" className="w-full" />
    </figure>
  );
}
