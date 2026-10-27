import { acpSessionsKeys } from "../modules/sessions/api/keys.js";

type KeyPath = readonly string[];

const NO_PUSH_PATHS: readonly KeyPath[] = [
  ["connections", "list"],
  ["connections", "getAgentConnections"],
  ["connections", "getProviderBalance"],
  ["connections", "listTemplates"],
  ["channels", "telegramBot"],
  ["agents", "listTelegramChats"],
  ["agents", "get"],
  ["slack", "install", "availability"],
  ["features", "flags"],
  ["features", "install"],
  ["apiKeys", "list"],
  ["chatForms", "preferences"],
  ["sidebarOrder", "get"],
  ["skills", "sources", "list"],
  ["skills", "listWithScan"],
  ["skills", "sets", "list"],
  ["skills", "readLocal"],
  ["skills", "getSkillContent"],
  ["skills", "state"],
  ["satellites", "list"],
  ["metrics", "spendBreakdown"],
  ["providerStatus", "list"],
  ["telemetry", "turns"],
  ["telemetry", "turn"],
  ["telemetry", "invocationTurns"],
  ["invocations", "tree"],
  ["invocations", "transcript"],
  ["spend", "sessions"],
  ["spend", "turns"],
  ["spend", "metering"],
  ["harness-config-current"],
  ["provider-models"],
  ["connections", "catalog"],
  ["connections", "agentCatalog"],
  ["changes"],
  ["processes"],
  ["templates", "list"],
  ["templates", "harnesses"],
  ["starterKits", "list"],
  ["starterKits", "get"],
  ["usage", "inspect", "availability"],
  ["links", "all"],
  ["version"],
  ["terms"],
];

function pathOf(queryKey: readonly unknown[]): readonly string[] {
  const [head] = queryKey;
  return (Array.isArray(head) ? head : queryKey).filter(
    (part): part is string => typeof part === "string",
  );
}

function startsWith(path: readonly string[], prefix: KeyPath): boolean {
  return prefix.every((part, index) => path[index] === part);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one place that decides which data an open screen re-reads when the user returns to the tab or the API connection comes back. A family belongs here when it changes outside this screen and no stream or poll carries it: no live-event topic, no pod watch on an older runtime, no continuing poll. Everything else heals through its own notice, its poll, or the owner stream's sync hint on re-subscription. Provider Status is the one polled family here: its poll pauses while the tab is hidden, and a returning user must not see an ended outage, or miss a new one, for another minute.
 */
export function refreshOnReturn(
  queryKey: readonly unknown[],
  event: "focus" | "reconnect",
): "always" | false {
  if (queryKey[0] === acpSessionsKeys.all[0])
    return event === "reconnect" || queryKey[2] !== "pages" ? "always" : false;
  const path = pathOf(queryKey);
  return NO_PUSH_PATHS.some((prefix) => startsWith(path, prefix))
    ? "always"
    : false;
}
