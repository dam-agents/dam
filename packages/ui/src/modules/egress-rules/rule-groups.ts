import { EGRESS_HOST, type EgressRuleView } from "api-server-api";

import { splitHostPort } from "./host-port.js";

export type RuleGroupKey = "own" | "kit" | "connection" | "preset";

export const RULE_GROUP_TITLE: Record<RuleGroupKey, string> = {
  own: "Your rules",
  kit: "From the starter kit",
  connection: "From connections",
  preset: "From the preset",
};

const GROUP_ORDER: readonly RuleGroupKey[] = [
  "own",
  "kit",
  "connection",
  "preset",
];

export function ruleGroupOf(source: EgressRuleView["source"]): RuleGroupKey {
  if (source === "kit") return "kit";
  if (source.startsWith("preset:")) return "preset";
  if (source.startsWith("connection:")) return "connection";
  return "own";
}

export function groupRules(
  rules: readonly EgressRuleView[],
  query: string,
): { key: RuleGroupKey; rules: EgressRuleView[] }[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? rules.filter((r) =>
        [r.host, r.pathPattern, r.method, r.verdict].some((field) =>
          field.toLowerCase().includes(needle),
        ),
      )
    : rules;
  return GROUP_ORDER.map((key) => ({
    key,
    rules: matching.filter((r) => ruleGroupOf(r.source) === key),
  })).filter((g) => g.rules.length > 0);
}

export function egressHostError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const { host } = splitHostPort(trimmed);
  return host.length <= 253 && EGRESS_HOST.test(host)
    ? undefined
    : "Enter a host name such as api.example.com, a wildcard such as *.example.com, or * for every host. Leave out https:// and the path.";
}
