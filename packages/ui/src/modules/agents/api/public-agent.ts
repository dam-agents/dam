import {
  publicAgentResponseSchema,
  type PublicAgentView,
} from "api-server-api";

export async function fetchPublicAgent(
  agentId: string,
): Promise<PublicAgentView | null> {
  try {
    const res = await fetch(
      `/api/public/agents/${encodeURIComponent(agentId)}`,
      { credentials: "omit" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = publicAgentResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "[public-agent] schema mismatch, rendering the generic page:",
        parsed.error.issues,
      );
      return null;
    }
    return parsed.data.agent;
  } catch (err) {
    console.warn("[public-agent] lookup failed", err);
    return null;
  }
}
