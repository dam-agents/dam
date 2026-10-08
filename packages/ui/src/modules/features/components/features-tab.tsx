import type { FeatureId } from "api-server-api";
import type { ReactNode } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useFeatures,
  useInstallCapabilities,
  useSetFeature,
} from "../api/queries.js";
import { isFeatureOffered } from "../lib/visible-features.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: ReactNode;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "strict-connection-addressing",
    label: "Addressed credential injection",
    description:
      "Shows a switch on the create page and in agent settings that makes the agent's gateway inject a connection's credential only into requests that name that connection. For agents whose tools, like Docker containers, call the same services with their own credentials or none. Starter kits can set it whatever this switch says.",
  },
  {
    id: "interactive-artifacts",
    label: "Interactive artifacts",
    description:
      "Lets buttons in a private HTML artifact send prompts to its agent's open chat. The agent replies in chat.",
  },
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "Reveals the pre-release connection catalog (Google services, Spotify, YouTube, custom client-credentials).",
  },
  {
    id: "vm-sandboxes",
    label: "New sandbox runtime",
    description: (
      <>
        Use a new sandbox runtime based on{" "}
        <a
          href="https://github.com/smol-machines/smolvm"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          smolvm
        </a>
        . Starts much faster, and supports running containers (Docker,
        Kubernetes).
      </>
    ),
  },
  {
    id: "agent-telemetry",
    label: "Agent telemetry",
    description:
      "Shows what each turn of a conversation actually did — its spans, its records and what the call cost — under the reply itself, and adds a telemetry export to the session menu.",
  },
  {
    id: "agent-avatars",
    label: "Agent avatars",
    description:
      "Gives every agent one of eight characters picked from its name and owner, shown in the agents list, the chat and the Home feed. Its eyes show whether it is working, idle or hibernating. Renaming an agent can give it a new character.",
  },
];

function FeatureRowCard({
  row,
  enabled,
  onToggle,
}: {
  row: FeatureRow;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <label
      className={cn(
        CARD_SURFACE,
        "flex cursor-pointer items-start justify-between gap-4 p-4",
      )}
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          {row.label}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {row.description}
        </span>
      </span>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </label>
  );
}

export function FeaturesTab() {
  const { data: flags } = useFeatures();
  const { data: install } = useInstallCapabilities();
  const setFeature = useSetFeature();

  return (
    <div className="anim-in">
      <PageHeader
        title="Experimental features"
        description="Experimental features, toggled per user."
      />

      <div className="flex flex-col gap-3">
        {FEATURE_ROWS.filter((row) => isFeatureOffered(row.id, install)).map(
          (row) => (
            <FeatureRowCard
              key={row.id}
              row={row}
              enabled={flags?.[row.id] ?? false}
              onToggle={(enabled) =>
                setFeature.mutate({ feature: row.id, enabled })
              }
            />
          ),
        )}
      </div>
    </div>
  );
}
