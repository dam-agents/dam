import type { ApprovalActionOutcome } from "api-server-api";
import type { Result } from "../../../result.js";
import { formatEgressRuleInline } from "api-server-api";
import {
  EXIT_APPROVAL_NOT_ACTIONABLE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

type WrittenRule = NonNullable<ApprovalActionOutcome["rule"]>;

function describeRule(rule: WrittenRule): string {
  const hostWide = rule.method === "*" && rule.pathPattern === "*";
  return `${hostWide ? "host-wide " : ""}egress rule (${formatEgressRuleInline(rule)})`;
}

// UNIT_BOUNDARY_DESCRIPTION: a durable verdict that falls back to a verdict for this call only when the server finds the durable one not actionable. A held MCP tool call (mcp_tool_call) takes only once verdicts, and the CLI cannot tell an approval's type before it answers, so a bare `approve` or `deny` of one answers it once. For every other type a pending approval takes the durable verdict, so the fallback finds nothing left to answer.
export async function durableOrOnce<E>(
  durable: () => Promise<Result<ApprovalActionOutcome, E>>,
  once: () => Promise<Result<ApprovalActionOutcome, E>>,
): Promise<Result<ApprovalActionOutcome, E>> {
  const result = await durable();
  return result.ok && result.value.outcome === "not_actionable"
    ? once()
    : result;
}

export interface OutcomeWording {
  pastTense: string;
  onceLine: string;
  spendLimitLine?: string;
  webSearchRuleLine: string;
  expiredEffect: string;
}

export function printOutcomeAndExit(
  outcome: ApprovalActionOutcome,
  opts: { json?: boolean; once?: boolean },
  wording: OutcomeWording,
): never {
  const exitCode =
    outcome.outcome === "not_actionable"
      ? EXIT_APPROVAL_NOT_ACTIONABLE
      : EXIT_SUCCESS;
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exit(exitCode);
  }
  switch (outcome.outcome) {
    case "applied":
      if (outcome.type === "spend_limit" && wording.spendLimitLine) {
        process.stdout.write(`${wording.spendLimitLine}\n`);
      } else if (outcome.rule) {
        process.stdout.write(
          `${wording.pastTense} — wrote permanent ${describeRule(outcome.rule)}. It now appears in \`dam network list <agent>\`.\n`,
        );
      } else if (outcome.type === "web_search" && !opts.once) {
        process.stdout.write(
          `${wording.pastTense} — wrote the agent's web search rule: ${wording.webSearchRuleLine}\n`,
        );
      } else if (outcome.type === "egress_proposal") {
        process.stdout.write(
          `${wording.pastTense} — the proposed egress rule was not written.\n`,
        );
      } else if (opts.once || outcome.type === "mcp_tool_call") {
        process.stdout.write(`${wording.onceLine}\n`);
      } else {
        process.stdout.write(
          `${wording.pastTense} — verdict sent to the harness (tool-call permission; no egress rule involved).\n`,
        );
      }
      break;
    case "rule_written_expired":
      if (outcome.type === "web_search") {
        process.stdout.write(
          `Held search already expired — wrote the agent's web search rule anyway: ${wording.webSearchRuleLine}\n`,
        );
        break;
      }
      process.stdout.write(
        `Held call already expired — wrote the durable ${
          outcome.rule ? describeRule(outcome.rule) : "egress rule"
        } anyway; ${wording.expiredEffect}\n`,
      );
      break;
    case "not_actionable":
      process.stderr.write(
        "error: approval not found or already settled. See `dam approval list --status all`.\n",
      );
      break;
  }
  process.exit(exitCode);
}
