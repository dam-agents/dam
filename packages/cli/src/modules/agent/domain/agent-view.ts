import type {
  AgentDefaultProvider,
  AgentStart,
  AgentState,
  ChannelConfig,
  EnvVar,
} from "api-server-api";

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  avatar?: string | null;
  env?: EnvVar[];
  state: AgentState;
  disabled?: boolean;
  error?: string;
  overBudgetMessage?: string;
  podTerminationReason?: string;
  podTerminationCode?: string;
  channels: ChannelConfig[];
  starterKit?: string | null;
  defaultProvider?: AgentDefaultProvider;
  startsOn?: AgentStart;
  access?: { editors: readonly string[] };
}

export function displayState(agent: AgentView): string {
  return agent.disabled ? "disabled" : agent.state;
}

const HARNESS_ORDER = "the first of yours its harness runs on";
/* UNIT_BOUNDARY_DESCRIPTION: one reason per source; `profile` and `default` reach this table only without their pick, which no server sends. */
const PROVIDER_REASON: Record<AgentDefaultProvider["source"], string> = {
  profile: HARNESS_ORDER,
  default: HARNESS_ORDER,
  kit: "the first of the starter kit's providers you hold",
  template: "the first of its template's providers you hold",
  harness: HARNESS_ORDER,
};

/* UNIT_BOUNDARY_DESCRIPTION: a server older than `source` answers without it; its profile, when present, still says the default chose, and anything else reads as the harness order, as it did before. */
export function defaultProviderLine(
  { connectionId, source, profile }: AgentDefaultProvider,
  name: string | undefined,
): string {
  const provider = name ? `${name} (${connectionId})` : connectionId;
  if (profile)
    return `  Provider: ${provider}, from your default for new agents${profile.name === null ? "" : `, profile "${profile.name}"`}: ${profile.model} on ${profile.harness}. Change that default in Settings › Providers, or pass --provider.`;
  const why = PROVIDER_REASON[source] ?? HARNESS_ORDER;
  return `  Provider: ${provider}, ${why}; your default for new agents does not apply to it.`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the create answers its Agent starts on, in
 * words: one line per provider it was not already told about (the default
 * provider has its own line), the harness and model, and a warning with the
 * fix when no provider the caller named runs that harness, so the driving
 * agent can tell the user without a second command.
 */
export function startsOnLines(
  { harness, model, providers }: AgentStart,
  opts: {
    agentName: string;
    nameOf: (connectionId: string) => string | undefined;
  },
): { out: string[]; err: string[] } {
  const label = (id: string) => {
    const name = opts.nameOf(id);
    return name ? `${name} (${id})` : id;
  };
  const out = providers
    .filter((p) => p.source === "named")
    .map(
      (p) =>
        `  Provider: ${label(p.connectionId)}, the one you named; it runs ${p.harnesses.join(", ") || "no harness of this install"}.`,
    );
  if (harness !== null)
    out.push(
      `  Starts on: ${harness}, ${model ?? "the automatic model (the platform's preferred one among its providers) until a default is set"}.`,
    );
  const named = providers.filter((p) => p.source === "named");
  const err: string[] = [];
  if (
    harness !== null &&
    named.length > 0 &&
    !named.some((p) => p.harnesses.includes(harness))
  ) {
    const runs = named.flatMap((p) => p.harnesses);
    err.push(
      `warning: no provider you named runs ${harness}, the harness the agent starts on, so its sessions would run on another provider or fail`,
      runs.length > 0
        ? `hint: \`dam agent update ${opts.agentName} --harness ${runs[0]} --model <provider>/<model id>\`; \`dam agent models ${opts.agentName} --harness ${runs[0]}\` lists the models`
        : `hint: name a provider that runs ${harness}, or pass --harness with one the provider runs; \`dam connection list --providers\` lists what each runs`,
    );
  }
  return { out, err };
}
