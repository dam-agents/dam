import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { egressProposalInputSchema } from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";
import type { EgressProposals } from "./services/egress-proposals.js";

const PROPOSE_DESCRIPTION = `Propose a network (egress) rule to your owner before you need it. Your outbound requests pass only where a rule allows them; a request to a host no rule covers is held until your owner answers, and fails if nobody does. Propose a rule when you know ahead what you will reach — a job that runs while nobody watches, or a setup step — as narrow as the work needs: the host, and where you can the method and the path ("*" matches anything, the query string included, e.g. "/repos/acme/app/issues/*"). \`reason\` is one sentence your owner reads: what the rule is for. Your owner sees the rule where waiting approvals show and allows it, allows the whole host, or declines; only that writes a rule. Returns the proposal's id and state; proposing the same rule again returns the open one, and "already-allowed" means a rule already lets the request through.`;

const STATUS_DESCRIPTION =
  "Read the state of an egress rule you proposed: pending, allowed (the rule is written), declined, or expired after seven days without an answer.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform MCP tools through which an Agent
 * proposes an egress rule to its owner and reads the verdict. The Agent never
 * writes a rule itself: the proposal waits as an approval for the owner.
 */
export function registerEgressProposalTools(
  server: McpServer,
  deps: { proposals: EgressProposals },
): void {
  server.tool(
    "propose_egress_rule",
    PROPOSE_DESCRIPTION,
    egressProposalInputSchema.shape,
    (args) =>
      run(async () =>
        json(
          await deps.proposals.propose(egressProposalInputSchema.parse(args)),
        ),
      ),
  );

  server.tool(
    "egress_proposal_status",
    STATUS_DESCRIPTION,
    { id: z.string().min(1).max(256) },
    (args) => run(async () => json(await deps.proposals.status(args.id))),
  );
}
