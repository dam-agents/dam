import { CertificateCheck, Launch } from "@carbon/icons-react";
import type { StarterKitPublisher } from "api-server-api";
import { match } from "ts-pattern";

import { getBrand } from "../../../brand.js";

interface Props {
  publisher: StarterKitPublisher;
  surface: "tile" | "header";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The byline that tells a kit the platform team
 * publishes from a kit a user published, on the catalog tile and in the kit
 * modal's header. The team's kit names the install's brand beside a mark; a
 * user's kit names that user. Only the header links the user's page, because
 * the whole tile is already one button.
 */
export function KitPublisher({ publisher, surface }: Props) {
  return (
    <p
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      data-testid="kit-publisher"
    >
      {match(publisher)
        .with({ kind: "team" }, () => (
          <>
            <CertificateCheck size={12} aria-hidden className="shrink-0" />
            By {getBrand().name}
          </>
        ))
        .with({ kind: "user" }, (user) => (
          <UserByline name={user.name} href={userLink(user.url, surface)} />
        ))
        .exhaustive()}
    </p>
  );
}

function userLink(
  url: string | undefined,
  surface: Props["surface"],
): string | undefined {
  return match(surface)
    .with("tile", () => undefined)
    .with("header", () => url)
    .exhaustive();
}

function UserByline({ name, href }: { name: string; href?: string }) {
  return (
    <span className="truncate">
      By{" "}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
        >
          {name}
          <Launch size={12} aria-hidden />
        </a>
      ) : (
        name
      )}
    </span>
  );
}
