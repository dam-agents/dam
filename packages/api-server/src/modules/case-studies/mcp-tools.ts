import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { caseStudySubmitInputSchema } from "api-server-api";
import { securityLog } from "../../core/security-log.js";
import { errorResult, json, run } from "../../core/mcp-tool-result.js";
import type { CaseStudyInspectionService } from "./services/inspection-service.js";
import type { CaseStudySubmissionsService } from "./services/submissions-service.js";

export function registerCaseStudyTools(
  server: McpServer,
  deps: {
    agentId: string;
    submissions: CaseStudySubmissionsService;
    inspection: CaseStudyInspectionService;
    ownerCarriesInspectorRole: boolean;
    agentImage: (agentId: string) => Promise<string | null>;
  },
): void {
  server.tool(
    "submit_case_study",
    "Submit this agent's case-study edition to the platform. The edition lands as `pending`: only this agent's owner can see it, and nothing reaches anyone else unless the owner releases it. One edition per agent per week (weeks start Monday, UTC) — submitting again within the same week replaces that week's edition. Use only when the agent-case-study skill instructs you to; the content must already be sanitized per that skill.",
    caseStudySubmitInputSchema.shape,
    async (input) => {
      const harnessImage = await deps.agentImage(deps.agentId);
      try {
        const receipt = await deps.submissions.submit(
          deps.agentId,
          input,
          harnessImage,
        );
        securityLog("info", "case_study.submitted", {
          category: "resource",
          actor: deps.agentId,
          actorKind: "agent",
          agentId: deps.agentId,
          result: "success",
          detail: {
            editionId: receipt.id,
            editionWeekStart: receipt.editionWeekStart,
            contentChars: input.content.length,
          },
        });
        return json(receipt);
      } catch (err) {
        securityLog("warn", "case_study.submitted", {
          category: "resource",
          actor: deps.agentId,
          actorKind: "agent",
          agentId: deps.agentId,
          result: "failure",
          detail: { contentChars: input.content.length },
        });
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  if (!deps.ownerCarriesInspectorRole) return;

  server.tool(
    "list_case_studies",
    "Operator tool: list released case-study editions across all agents on this deployment (metadata only, no content). Available to this agent because its owner carries the platform inspector role. Pending, hidden, and deleted editions are never returned.",
    {
      since: z
        .string()
        .datetime()
        .optional()
        .describe("Only editions updated at or after this ISO date-time."),
      week_of: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
          "Only editions of the week containing this date (YYYY-MM-DD, any day of that week).",
        ),
      agent_id: z.string().min(1).optional(),
    },
    ({ since, week_of, agent_id }) =>
      run(async () => {
        const editions = await deps.inspection.list({
          since: since ? new Date(since) : undefined,
          weekOf: week_of ? new Date(week_of) : undefined,
          agentId: agent_id,
        });
        securityLog("info", "case_study.inspect", {
          category: "privileged",
          actor: deps.agentId,
          actorKind: "agent",
          agentId: deps.agentId,
          result: "success",
          detail: { tool: "list_case_studies", count: editions.length },
        });
        return json({ editions });
      }),
  );

  server.tool(
    "get_case_study",
    "Operator tool: fetch one released case-study edition, content included. Available to this agent because its owner carries the platform inspector role.",
    { id: z.string().min(1) },
    ({ id }) =>
      run(async () => {
        const edition = await deps.inspection.get(id);
        securityLog("info", "case_study.inspect", {
          category: "privileged",
          actor: deps.agentId,
          actorKind: "agent",
          agentId: deps.agentId,
          result: edition ? "success" : "failure",
          detail: { tool: "get_case_study", editionId: id },
        });
        if (!edition) return errorResult(`no released edition ${id}`);
        return json({ edition });
      }),
  );
}
