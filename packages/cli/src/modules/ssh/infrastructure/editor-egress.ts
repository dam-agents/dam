import type { EgressRuleView } from "api-server-api";
import type { EgressService } from "../../egress/index.js";

export const VSCODE_REMOTE_HOSTS = [
  "update.code.visualstudio.com",
  "vscode.download.prss.microsoft.com",
] as const;

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
