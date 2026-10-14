import { cn } from "@/lib/utils";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { safeMediaUrl } from "../../lib/safe-url.js";
import type { ImageComponent } from "../../lib/schema.js";

type Fit = NonNullable<ImageComponent["fit"]>;
type Variant = NonNullable<ImageComponent["variant"]>;

const FIT_CLASS: Record<Fit, string> = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
  none: "object-none",
  scaleDown: "object-scale-down",
};

const VARIANT_CLASS: Record<Variant, string> = {
  icon: "size-6",
  avatar: "size-10 rounded-full",
  smallFeature: "max-h-24 w-auto",
  mediumFeature: "max-h-48 w-auto",
  largeFeature: "max-h-80 w-auto",
  header: "max-h-40 w-full",
};

const CROPPED: ReadonlySet<Variant> = new Set(["avatar", "header"]);

interface Props {
  component: ImageComponent;
}

export function A2uiImage({ component }: Props) {
  const bindings = useA2uiBindings();
  const src = safeMediaUrl(bindings.text(component.url), "image");
  if (!src) return null;
  const { variant = "mediumFeature" } = component;
  const fit = component.fit ?? (CROPPED.has(variant) ? "cover" : "contain");
  return (
    <img
      src={src}
      alt={bindings.text(component.description)}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn(
        "max-w-full rounded-md",
        VARIANT_CLASS[variant],
        FIT_CLASS[fit],
      )}
    />
  );
}
