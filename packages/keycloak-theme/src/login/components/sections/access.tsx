import type { ReactNode } from "react";

import type { CommunityLink } from "../../content.js";
import { CompassCharacter } from "../compass-character.js";
import { ExternalLink, SectionLabel, SectionTitle } from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The last section of the login page: a second
 * sign-in form, so a visitor who scrolled down does not have to scroll back,
 * with the docs and community links and the compass character beside it. A
 * link whose value is empty is not shown. */
export function AccessSection({
  form,
  docsUrl,
  community,
}: {
  form: ReactNode;
  docsUrl: string;
  community: CommunityLink | undefined;
}) {
  return (
    <section className="bg-section flex min-h-dvh snap-start items-center py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-start">
          <div className="flex-1 text-center lg:text-left">
            <SectionLabel>Get started</SectionLabel>
            <SectionTitle>Meet your new AI teammate.</SectionTitle>

            <div className="mx-auto mt-8 max-w-[var(--width-login-col)] text-left lg:mx-0">
              {form}
            </div>

            {(docsUrl || community) && (
              <p className="text-muted-foreground mt-6 text-[14px] leading-relaxed">
                {docsUrl && (
                  <ExternalLink href={docsUrl}>Read the docs</ExternalLink>
                )}
                {docsUrl && community && " · "}
                {community && (
                  <>
                    Questions? Ask in{" "}
                    <ExternalLink
                      href={community.url}
                      className="text-foreground font-medium hover:underline"
                    >
                      {community.label}
                    </ExternalLink>{" "}
                    on Slack.
                  </>
                )}
              </p>
            )}
          </div>

          <CompassCharacter />
        </div>
      </div>
    </section>
  );
}
