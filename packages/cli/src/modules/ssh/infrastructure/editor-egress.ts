import type { EgressRuleView } from "api-server-api";
import type { EgressService } from "../../egress/index.js";

// Hosts VS Code Remote-SSH reaches while bootstrapping its server on the
// agent: the update service that resolves the build commit, and the PRSS CDN
// that serves the server tarball. The agent's egress is gated per-host (the
// HITL network model, ADR-035), so without a pre-approval the first connect
// pops an approval prompt in the web UI — confusing for someone driving the
// whole flow from the CLI. Pre-allowing them keeps `dam ssh connect -x code`
// silent end to end.
export const VSCODE_REMOTE_HOSTS = [
  "update.code.visualstudio.com",
  "vscode.download.prss.microsoft.com",
] as const;

/** Of `wanted`, the hosts that still need an allow rule. Returns none when
 *  egress is already wide open (a global `*` allow — e.g. the `all` preset),
 *  and skips any host an existing rule already references, so a prior explicit
 *  allow or deny is respected and repeated connects never pile up duplicates
 *  (the server's create does not dedupe). */
export function hostsToSeed(
  existing: readonly EgressRuleView[],
  wanted: readonly string[],
): string[] {
  const wideOpen = existing.some(
    (r) =>
      r.host === "*" &&
      r.method === "*" &&
      r.pathPattern === "*" &&
      r.verdict === "allow",
  );
  if (wideOpen) return [];
  const referenced = new Set(existing.map((r) => r.host));
  return wanted.filter((h) => !referenced.has(h));
}

/** Best-effort: ensure host-only allow rules exist for `hosts` on the agent
 *  before an editor connects. Host-only rules are L4 (SNI-gated), so they apply
 *  without rolling the pod. Never throws — a failure just means the user might
 *  still see the approval prompt, which we flag via `note`. */
export async function ensureEditorEgress(opts: {
  egress: EgressService;
  agentId: string;
  hosts: readonly string[];
  note: (msg: string) => void;
}): Promise<void> {
  const listed = await opts.egress.listForAgent(opts.agentId);
  if (!listed.ok) {
    opts.note(
      `could not check network rules (${listed.error.kind}); VS Code may prompt for host approval in the web UI`,
    );
    return;
  }
  const todo = hostsToSeed(listed.value, opts.hosts);
  const seeded: string[] = [];
  for (const host of todo) {
    const r = await opts.egress.create({
      agentId: opts.agentId,
      host,
      method: "*",
      pathPattern: "*",
      verdict: "allow",
    });
    if (r.ok) seeded.push(host);
    else
      opts.note(
        `could not pre-allow ${host} (${r.error.kind}); VS Code may prompt for it in the web UI`,
      );
  }
  if (seeded.length)
    opts.note(
      `pre-allowed VS Code download host${seeded.length === 1 ? "" : "s"}: ${seeded.join(", ")}`,
    );
}
