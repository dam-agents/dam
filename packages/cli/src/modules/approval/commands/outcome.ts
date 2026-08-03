import type { ApprovalActionOutcome } from "api-server-api";
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

/**
 * Verb-specific strings for the shared outcome → output/exit mapping.
 * `rule` is non-null exactly when an egress rule was written, so the
 * messages can be precise without knowing the row's type.
 */
export interface OutcomeWording {
  /** "Approved" / "Denied" */
  pastTense: string;
  /** `applied` with `rule: null` under `--once`. */
  onceLine: string;
  /** What a `rule_written_expired` rule means for future requests. */
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
      if (outcome.rule) {
        process.stdout.write(
          `${wording.pastTense} — wrote permanent ${describeRule(outcome.rule)}. It now appears in \`dam network list <agent>\`.\n`,
        );
      } else if (opts.once) {
        process.stdout.write(`${wording.onceLine}\n`);
      } else {
        process.stdout.write(
          `${wording.pastTense} — verdict sent to the harness (tool-call permission; no egress rule involved).\n`,
        );
      }
      break;
    case "rule_written_expired":
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
