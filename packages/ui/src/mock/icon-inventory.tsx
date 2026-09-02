import {
  Box,
  Code,
  ConnectionSignal,
  FlashFilled,
  Notebook,
  Time,
} from "@carbon/icons-react";

import {
  AnthropicIcon,
  BobIcon,
  GithubIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";
import { CardIcon } from "@/modules/providers/components/card-icon";

interface IconEntry {
  label: string;
  render: React.ReactNode;
  source: string;
}

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
      {children}
    </div>
  );
}

function SvgTile({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={38}
      height={38}
      className="shrink-0 rounded-lg"
    />
  );
}

function CarbonTile({
  icon: Icon,
}: {
  icon: React.ComponentType<{ size: number; className?: string }>;
}) {
  return (
    <Tile>
      <Icon size={16} className="text-muted-foreground" />
    </Tile>
  );
}

const SECTIONS: { title: string; note: string; entries: IconEntry[] }[] = [
  {
    title: "Harnesses / Images",
    note: "Shown on setup cards and in pack detail. 38x38 rounded-lg tiles.",
    entries: [
      {
        label: "Claude Code",
        render: <SvgTile src="/icons/claude-code.svg" alt="Claude Code" />,
        source: "/icons/claude-code.svg",
      },
      {
        label: "Pi Agent",
        render: <SvgTile src="/icons/pi-agent.svg" alt="Pi Agent" />,
        source: "/icons/pi-agent.svg",
      },
      {
        label: "Codex (via OpenAI provider)",
        render: <CardIcon provider="openai" size="md" />,
        source: "CardIcon provider='openai'",
      },
      {
        label: "Bob",
        render: <CardIcon provider="bob" size="md" />,
        source: "CardIcon provider='bob'",
      },
      {
        label: "OpenEvolve",
        render: (
          <Tile>
            <Box size={16} className="text-muted-foreground" />
          </Tile>
        ),
        source: "MISSING — using fallback Box icon",
      },
    ],
  },
  {
    title: "Providers",
    note: "Provider brand icons used in provider selection. CardIcon component.",
    entries: [
      {
        label: "Anthropic",
        render: <CardIcon provider="anthropic" size="md" />,
        source: "AnthropicIcon (inline SVG)",
      },
      {
        label: "OpenAI",
        render: <CardIcon provider="openai" size="md" />,
        source: "OpenAIIcon (inline SVG)",
      },
      {
        label: "Bob",
        render: <CardIcon provider="bob" size="md" />,
        source: "BobIcon (inline SVG)",
      },
      {
        label: "LiteLLM",
        render: <CardIcon provider="ibm-litellm" size="md" />,
        source: "LiteLLMIcon (emoji)",
      },
    ],
  },
  {
    title: "Connections",
    note: "Used in connection lists and pack detail. Via ConnectionIcon or direct SVG.",
    entries: [
      {
        label: "GitHub",
        render: (
          <Tile>
            <GithubIcon width={16} height={16} className="block" />
          </Tile>
        ),
        source: "GithubIcon (inline SVG)",
      },
      {
        label: "Slack",
        render: (
          <Tile>
            <img
              src="/icons/slack.svg"
              alt="Slack"
              width={16}
              height={16}
              className="block"
            />
          </Tile>
        ),
        source: "/icons/slack.svg",
      },
      {
        label: "Kubernetes",
        render: (
          <Tile>
            <img
              src="/icons/kubernetes.svg"
              alt="Kubernetes"
              width={16}
              height={16}
              className="block"
            />
          </Tile>
        ),
        source: "/icons/kubernetes.svg",
      },
      {
        label: "Modal (GPU compute)",
        render: <CarbonTile icon={ConnectionSignal} />,
        source: "MISSING — using fallback ConnectionSignal",
      },
    ],
  },
  {
    title: "Channels",
    note: "For Slack/Telegram channel slots in packs. Same SVGs as connections.",
    entries: [
      {
        label: "Slack channel",
        render: (
          <Tile>
            <img
              src="/icons/slack.svg"
              alt="Slack"
              width={16}
              height={16}
              className="block"
            />
          </Tile>
        ),
        source: "/icons/slack.svg (same as connection)",
      },
    ],
  },
  {
    title: "Skills",
    note: "NEEDS ICON — currently no dedicated skill icon. Shown in pack detail 'Included' section.",
    entries: [
      {
        label: "Skill (current: FlashFilled)",
        render: <CarbonTile icon={FlashFilled} />,
        source: "Carbon FlashFilled — placeholder",
      },
      {
        label: "Skill (alt: Code)",
        render: <CarbonTile icon={Code} />,
        source: "Carbon Code — placeholder",
      },
    ],
  },
  {
    title: "Schedules",
    note: "NEEDS ICON — currently using Carbon Time. Shown in pack detail and setup form.",
    entries: [
      {
        label: "Schedule (current: Time)",
        render: <CarbonTile icon={Time} />,
        source: "Carbon Time — placeholder",
      },
    ],
  },
  {
    title: "Knowledge bases",
    note: "NEEDS REVIEW — currently using Carbon Notebook. Shown in pack detail 'You'll set up'.",
    entries: [
      {
        label: "Knowledge base (current: Notebook)",
        render: <CarbonTile icon={Notebook} />,
        source: "Carbon Notebook — placeholder",
      },
    ],
  },
  {
    title: "Starter repos",
    note: "Bundled repo templates in packs. No dedicated icon yet.",
    entries: [
      {
        label: "Starter repo (current: Code)",
        render: <CarbonTile icon={Code} />,
        source: "Carbon Code — placeholder",
      },
    ],
  },
  {
    title: "Brand icons (inline SVG components)",
    note: "Available as React components in brand-icons.tsx. Shown at 16x16 in a 38x38 tile for reference.",
    entries: [
      {
        label: "AnthropicIcon",
        render: (
          <Tile>
            <AnthropicIcon width={16} height={16} />
          </Tile>
        ),
        source: "brand-icons.tsx AnthropicIcon",
      },
      {
        label: "OpenAIIcon",
        render: (
          <Tile>
            <OpenAIIcon width={16} height={16} />
          </Tile>
        ),
        source: "brand-icons.tsx OpenAIIcon",
      },
      {
        label: "GithubIcon",
        render: (
          <Tile>
            <GithubIcon width={16} height={16} />
          </Tile>
        ),
        source: "brand-icons.tsx GithubIcon",
      },
      {
        label: "BobIcon",
        render: (
          <Tile>
            <BobIcon width={38} height={38} />
          </Tile>
        ),
        source: "brand-icons.tsx BobIcon",
      },
      {
        label: "LiteLLMIcon",
        render: (
          <Tile>
            <LiteLLMIcon />
          </Tile>
        ),
        source: "brand-icons.tsx LiteLLMIcon",
      },
    ],
  },
];

export function IconInventory({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[9998] overflow-y-auto bg-background">
      <div className="mx-auto max-w-[960px] px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Icon Inventory
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All icons available for the pack system. Items marked MISSING or
              NEEDS ICON need your direction.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-10">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="text-lg font-semibold text-foreground">
                {section.title}
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">
                {section.note}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.entries.map((entry) => (
                  <div
                    key={entry.label}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    {entry.render}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {entry.label}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground/60">
                        {entry.source}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
