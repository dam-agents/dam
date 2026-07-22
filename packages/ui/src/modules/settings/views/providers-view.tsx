import { PageHeader } from "@/components/ui/page-header";

import { ProviderSection } from "../../providers/components/provider-section.js";

export function ProvidersView() {
  return (
    <div className="w-full max-w-2xl">
      <PageHeader
        title="Providers"
        description="Agents need an API key from a provider to reach a model."
      />

      <section className="mb-8">
        <ProviderSection manage />
      </section>
    </div>
  );
}
