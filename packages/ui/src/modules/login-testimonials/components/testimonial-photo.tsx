import { cn } from "@/lib/utils";

import { initialsOf, photoSrc } from "../lib/draft.js";

export function TestimonialPhoto({
  name,
  photoId,
  className,
}: {
  name: string;
  photoId: string | null;
  className?: string;
}) {
  const box = cn("size-10 shrink-0 rounded-full", className);
  return photoId ? (
    <img src={photoSrc(photoId)} alt="" className={cn(box, "object-cover")} />
  ) : (
    <div
      aria-hidden="true"
      className={cn(
        box,
        "flex items-center justify-center bg-muted text-sm font-semibold text-muted-foreground",
      )}
    >
      {initialsOf(name) || "?"}
    </div>
  );
}
