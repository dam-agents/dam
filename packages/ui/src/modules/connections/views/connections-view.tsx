import { ConnectionTemplatesSection } from "../components/templates-section.js";

export function ConnectionsView() {
  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">
          Connections
        </h1>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        External services and credentials available to your agents. Injected
        into outbound HTTP requests — agents never see raw tokens.
      </p>

      <ConnectionTemplatesSection />
    </div>
  );
}
