import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { ProviderSection } from "../../providers/components/provider-section.js";
import { useSecrets } from "../../secrets/api/queries.js";

export function ProvidersView() {
  const { refetch, isFetching } = useSecrets();

  return (
    <div className="w-full max-w-2xl">
      <header className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.65px] text-foreground">
          Providers
        </h1>
        <Button
          variant="outline"
          size="icon"
          className="ml-auto h-8 w-8"
          onClick={() => refetch()}
          title="Refresh"
        >
          <span className={isFetching ? "anim-spin" : ""}>
            <Renew />
          </span>
        </Button>
      </header>

      <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
        Agents need an API key from a provider to reach a model.
      </p>

      <section className="mb-8">
        <ProviderSection manage />
      </section>
    </div>
  );
}
