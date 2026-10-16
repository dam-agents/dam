import { externalLinkProps } from "@/lib/external-link";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import { useLinks } from "../../links/api/queries.js";

export function RequestMoreLink() {
  const { data: links } = useLinks();
  return (
    <a
      href={links?.computeRequest ?? COMPUTE_REQUEST_URL}
      {...externalLinkProps}
      className="ml-auto shrink-0 text-muted-foreground/60 hover:underline"
    >
      Request more
    </a>
  );
}
