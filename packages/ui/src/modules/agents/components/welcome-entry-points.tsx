import { ArrowRight } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { DOCS_URL } from "../../../constants.js";
import { EntryPointButtons } from "./entry-point-buttons.js";

export function WelcomeEntryPoints() {
  return (
    <Callout tone="gradient" className="p-6 anim-in">
      <h2 className="text-lg font-semibold text-foreground">
        Accelerate research with {getBrand().name}
      </h2>
      <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-muted-foreground">
        Run agents in isolated cloud environments with credentials and tools
        securely injected. Start from a ready-made kit or build your own, and
        trigger agents from Slack or on a schedule.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <EntryPointButtons surface="home" />
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline md:ml-auto"
        >
          Or check out the Documentation
          <ArrowRight size={16} className="shrink-0" />
        </a>
      </div>
    </Callout>
  );
}
