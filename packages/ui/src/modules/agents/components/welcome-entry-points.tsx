import { ArrowRight } from "@carbon/icons-react";
import type { EntryPointChoice } from "api-server-api";

import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

export function WelcomeEntryPoints() {
  const setView = useStore((s) => s.setView);
  const recordEntryPoint = useRecordEntryPoint();

  const enter = () => {
    recordEntryPoint.mutate({ choice: "sandbox" satisfies EntryPointChoice });
    setView("agent-new");
  };

  return (
    <div className="anim-in">
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.5px] text-foreground">
        Accelerate research with {getBrand().name}
      </h1>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        Run agents in isolated cloud environments with credentials and tools
        securely injected — then trigger them from Slack or on a schedule.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Button size="lg" onClick={enter}>
          Create an agent
          <ArrowRight size={16} />
        </Button>
        <Button size="lg" variant="outline" onClick={() => setView("packs")}>
          Browse packs
        </Button>
      </div>

      <div className="mt-6 flex justify-end">
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Or check out the Documentation
          <ArrowRight size={16} className="shrink-0" />
        </a>
      </div>
    </div>
  );
}
