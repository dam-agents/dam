import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { egressProposalInputSchema } from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";
import type { EgressProposals } from "./services/egress-proposals.js";

const DESCRIPTION =
  'Propose a network (egress) rule to your owner before you need it, e.g. for a job that runs while nobody watches. `propose` with host, optional method, path ("*" matches anything, the query too) and port, and a one-sentence reason; keep it as narrow as the work needs. Only your owner\'s verdict writes the rule. `status` with id says pending, allowed, declined or expired (after seven days). "already-allowed" means a rule already lets it through.';

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform MCP tool through which an Agent
 * proposes an egress rule to its owner and reads the verdict. The Agent never
 * writes a rule itself: the proposal waits as an approval for the owner. The
 * inputs are checked on the server.
 */
export function registerEgressProposalTool(
  server: McpServer,
  deps: { proposals: EgressProposals },
): void {
  server.tool(
    "egress_proposal",
    DESCRIPTION,
    {
      action: z.enum(["propose", "status"]),
      host: z.string().optional(),
      method: z.string().optional(),
      path: z.string().optional(),
      port: z.number().int().optional(),
      reason: z.string().optional(),
      id: z.string().min(1).max(256).optional(),
    },
    ({ action, id, ...rule }) =>
      run(async () => {
        if (action === "status") {
          if (!id) throw new Error("status needs id");
          return json(await deps.proposals.status(id));
        }
        const parsed = egressProposalInputSchema.safeParse(rule);
        if (!parsed.success) {
          throw new Error(
            parsed.error.issues
              .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
              .join("; "),
          );
        }
        return json(await deps.proposals.propose(parsed.data));
      }),
  );
}
