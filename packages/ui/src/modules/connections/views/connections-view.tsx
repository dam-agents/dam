import { ConnectionTemplatesSection } from "../components/templates-section.js";

export function ConnectionsView() {
  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.65px] text-foreground">
          Connections
        </h1>
      </div>

      <p className="text-[14px] text-muted-foreground mb-8 leading-relaxed">
        Connections are the services and credentials your agents can reach.
      </p>

      <ConnectionTemplatesSection />
    </div>
  );
}
