import { externalLinkProps } from "@/lib/external-link";

import { useComputeRequestUrl } from "../../links/api/queries.js";

export function RequestMoreLink() {
  const href = useComputeRequestUrl();
  if (!href) return null;
  return (
    <a
      href={href}
      {...externalLinkProps}
      className="ml-auto shrink-0 text-muted-foreground/60 hover:underline"
    >
      Request more
    </a>
  );
}
