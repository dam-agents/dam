import { routesSessionPairs } from "agent-runtime-api";
import type { DefaultKind, SessionPair } from "api-server-api";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import { defaultModelHeadline } from "../../home/lib/default-model-copy.js";
import {
  clearSessionDefault,
  rememberSessionPair,
  useHarnessCatalog,
  useRememberedPair,
  useSessionDefaults,
} from "../../sessions/api/session-pair.js";
import { AwakeModelsGate } from "../../sessions/components/awake-models-gate.js";
import { DEFAULT_KIND_TITLE } from "../../sessions/lib/default-kind.js";
import { harnessDisplayName } from "../../sessions/lib/session-pair-options.js";
import { sessionSettingOptions } from "../../sessions/lib/session-settings.js";
import { DefaultPairEditor } from "./default-pair-editor.js";
import { OffDefaultSchedules } from "./off-default-schedules.js";

const KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

const KIND_HINT: Record<DefaultKind, string> = {
  chat: "New chats start on this.",
  channel: "Slack and Telegram threads run on this.",
  scheduled: "Schedules that set nothing of their own run on this.",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's three defaults on its Providers
 * page. Channel and scheduled start as "Same as chat" and show the chat
 * values they inherit; switching that off gives them a default of their own,
 * and switching it on again clears it.
 */
export function SessionDefaultsSection({ agentId }: { agentId: string }) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const operable = useIsAgentOperable(agentId);
  if (status && !status.harnesses && !operable)
    return (
      <section className="mt-6">
        <SectionLabel spaced>Default for new sessions</SectionLabel>
        <AwakeModelsGate agentId={agentId} />
      </section>
    );
  if (!routesSessionPairs(status?.harnesses ?? [])) return null;
  return (
    <section className="mt-6 flex flex-col gap-6">
      {KINDS.map((kind) => (
        <KindDefault key={`${agentId}:${kind}`} agentId={agentId} kind={kind} />
      ))}
    </section>
  );
}

function KindDefault({
  agentId,
  kind,
}: {
  agentId: string;
  kind: DefaultKind;
}) {
  const { data: saved } = useSessionDefaults(agentId);
  const { data: chat } = useRememberedPair(agentId);
  const { data: current } = useRememberedPair(agentId, kind);
  const notice = useDefaultModelNotices()
    .byAgentEvenDismissed.get(agentId)
    ?.find((n) => n.kinds.includes(kind) && n.state !== "changed");
  const [detached, setDetached] = useState(false);
  const own = kind === "chat" ? null : (saved?.[kind] ?? null);
  const sameAsChat = kind !== "chat" && own === null && !detached;

  const setSameAsChat = (on: boolean) => {
    if (kind === "chat") return;
    if (on) {
      setDetached(false);
      clearSessionDefault(agentId, kind);
    } else if (chat?.model) rememberSessionPair(agentId, chat, kind);
    else setDetached(true);
  };

  return (
    <div data-testid={`session-default-${kind}`}>
      <SectionLabel spaced>{DEFAULT_KIND_TITLE[kind]} sessions</SectionLabel>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">
        {KIND_HINT[kind]}
      </p>
      {notice && (
        <p
          role="status"
          className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-warning" />
          {defaultModelHeadline(notice)}
        </p>
      )}
      {kind !== "chat" && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <Switch
            checked={sameAsChat}
            onCheckedChange={setSameAsChat}
            label="Same as chat"
          />
          Same as chat
        </label>
      )}
      {sameAsChat ? (
        <PairSummary agentId={agentId} pair={chat ?? null} />
      ) : (
        <DefaultPairEditor
          agentId={agentId}
          kind={kind}
          current={current ?? null}
        />
      )}
      {kind === "scheduled" && <OffDefaultSchedules agentId={agentId} />}
    </div>
  );
}

function PairSummary({
  agentId,
  pair,
}: {
  agentId: string;
  pair: SessionPair | null;
}) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const { data: catalog } = useHarnessCatalog();
  if (!pair) return null;
  const capability = status?.harnesses?.find((h) => h.name === pair.harness);
  const settings = sessionSettingOptions(capability)
    .filter((o) => !o.subagents && pair.settings?.[o.id])
    .map(
      (o) =>
        o.choices.find((c) => c.value === pair.settings?.[o.id])?.name ??
        pair.settings?.[o.id],
    );
  const parts = [
    harnessDisplayName(pair.harness, catalog?.harnesses) ?? pair.harness,
    pair.model ?? "model not set",
    ...settings,
  ];
  return (
    <p className="text-sm text-muted-foreground">
      Same as chat: {parts.join(" · ")}
    </p>
  );
}
