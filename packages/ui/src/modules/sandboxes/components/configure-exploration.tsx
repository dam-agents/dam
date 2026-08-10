import {
  Chip,
  Network_3,
  MachineLearningModel,
  Terminal,
} from "@carbon/icons-react";

import { CollapsibleSection } from "./collapsible-section.js";

export function ConfigureExploration() {
  return (
    <div className="mx-auto w-full max-w-[666px] px-4 py-10">
      <h1 className="mb-1 text-[22px] font-semibold text-foreground">
        Configure
      </h1>
      <p className="mb-8 text-[14px] text-muted-foreground">
        Review and adjust your sandbox settings. Expand a section to make
        changes.
      </p>

      <div className="rounded-xl border border-border bg-card">
        {/* Size — defaultOpen so the Figma capture shows expanded state */}
        <CollapsibleSection
          icon={<Chip size={16} className="text-muted-foreground" />}
          title="Size"
          summary="1 CPU · 2 GiB RAM"
          defaultOpen
        >
          <SizeSectionContent />
        </CollapsibleSection>

        {/* Model settings */}
        <CollapsibleSection
          icon={
            <MachineLearningModel
              size={16}
              className="text-muted-foreground"
            />
          }
          title="Model settings"
          summary="Claude Sonnet 4"
        >
          <ModelSectionContent />
        </CollapsibleSection>

        {/* Network access */}
        <CollapsibleSection
          icon={<Network_3 size={16} className="text-muted-foreground" />}
          title="Network access"
          summary="Trusted defaults"
        >
          <NetworkSectionContent />
        </CollapsibleSection>

        {/* Environment */}
        <CollapsibleSection
          icon={<Terminal size={16} className="text-muted-foreground" />}
          title="Environment"
          summary="3 variables"
        >
          <EnvironmentSectionContent />
        </CollapsibleSection>
      </div>
    </div>
  );
}

function SizeSectionContent() {
  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted-foreground">
        How much compute this sandbox can use while running.
      </p>
      <div className="space-y-4">
        <SliderRow label="CPU" value="1.0 cores" percent={25} />
        <SliderRow label="Memory" value="2 GiB" percent={16} />
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-[14px] text-foreground">{label}</span>
      <div className="relative h-2 flex-1 rounded-full bg-muted">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-foreground"
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 size-4 rounded-full border-2 border-foreground bg-background"
          style={{ left: `${percent}%`, marginLeft: "-8px" }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-[14px] text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function ModelSectionContent() {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[14px] font-medium text-foreground">Provider</p>
        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
          <div className="size-5 rounded-full bg-muted" />
          <span className="text-[14px] text-foreground">Anthropic</span>
          <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] font-medium text-emerald-600">
            Connected
          </span>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[14px] font-medium text-foreground">Model</p>
        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
          <span className="text-[14px] text-foreground">
            Claude Sonnet 4 (claude-sonnet-4-20250514)
          </span>
        </div>
      </div>
    </div>
  );
}

function NetworkSectionContent() {
  return (
    <div className="space-y-3">
      <p className="mb-3 text-[14px] text-muted-foreground">
        Control which hosts the sandbox can reach.
      </p>
      <NetworkPresetCard
        label="Strict default-deny"
        description="All outbound hosts require approval via inbox"
        selected={false}
      />
      <NetworkPresetCard
        label="Trusted defaults"
        description="npm, PyPI, GitHub, package mirrors, Anthropic. Everything else hits inbox"
        selected={true}
      />
      <NetworkPresetCard
        label="Allow everything"
        description="Development escape hatch — no network restrictions"
        selected={false}
      />
    </div>
  );
}

function NetworkPresetCard({
  label,
  description,
  selected,
}: {
  label: string;
  description: string;
  selected: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        selected
          ? "border-foreground bg-card"
          : "border-border bg-card opacity-60"
      }`}
    >
      <p className="text-[14px] font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-[14px] text-muted-foreground">{description}</p>
    </div>
  );
}

function EnvironmentSectionContent() {
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted-foreground">
        Environment variables available inside the sandbox.
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left font-medium text-foreground">
                Key
              </th>
              <th className="px-4 py-2 text-left font-medium text-foreground">
                Value
              </th>
              <th className="w-20 px-4 py-2 text-left font-medium text-muted-foreground">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            <EnvRow name="ANTHROPIC_API_KEY" value="••••••••" source="Provider" />
            <EnvRow name="GITHUB_TOKEN" value="••••••••" source="Connection" />
            <EnvRow name="NODE_ENV" value="production" source="Custom" />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnvRow({
  name,
  value,
  source,
}: {
  name: string;
  value: string;
  source: string;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 font-mono text-[14px] text-foreground">
        {name}
      </td>
      <td className="px-4 py-2 font-mono text-[14px] text-muted-foreground">
        {value}
      </td>
      <td className="px-4 py-2 text-[14px] text-muted-foreground">{source}</td>
    </tr>
  );
}
