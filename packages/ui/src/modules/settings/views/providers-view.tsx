import { ProviderSection } from "../../providers/components/provider-section.js";

export function ProvidersView() {
  return (
    <div className="w-full max-w-2xl">
      <header className="mb-8">
        <h1 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.65px] text-foreground">
          Providers
        </h1>
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
