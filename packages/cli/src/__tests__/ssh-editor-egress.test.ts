import { describe, expect, it } from "vitest";
import type { EgressRuleCreateInput, EgressRuleView } from "api-server-api";
import { ok, err } from "../result.js";
import type { EgressService } from "../modules/egress/index.js";
import {
  ensureEditorEgress,
  hostsToSeed,
  VSCODE_REMOTE_HOSTS,
} from "../modules/ssh/infrastructure/editor-egress.js";

const rule = (p: Partial<EgressRuleView>): EgressRuleView => ({
  id: "r1",
  agentId: "agent-1",
  host: "example.com",
  method: "*",
  pathPattern: "*",
  verdict: "allow",
  decidedBy: "user",
  decidedAt: "2026-06-05T00:00:00.000Z",
  source: "manual",
  ...p,
});

describe("hostsToSeed", () => {
  it("seeds every wanted host when none are referenced", () => {
    expect(hostsToSeed([], VSCODE_REMOTE_HOSTS)).toEqual([
      ...VSCODE_REMOTE_HOSTS,
    ]);
  });

  it("skips a host that any rule already references (allow or deny)", () => {
    const existing = [
      rule({ host: VSCODE_REMOTE_HOSTS[0], verdict: "allow" }),
      rule({ host: VSCODE_REMOTE_HOSTS[1], verdict: "deny" }),
    ];
    expect(hostsToSeed(existing, VSCODE_REMOTE_HOSTS)).toEqual([]);
  });

  it("seeds only the not-yet-referenced hosts", () => {
    const existing = [rule({ host: VSCODE_REMOTE_HOSTS[0] })];
    expect(hostsToSeed(existing, VSCODE_REMOTE_HOSTS)).toEqual([
      VSCODE_REMOTE_HOSTS[1],
    ]);
  });

  it("seeds nothing when egress is wide open (global * allow)", () => {
    const existing = [
      rule({ host: "*", method: "*", pathPattern: "*", verdict: "allow" }),
    ];
    expect(hostsToSeed(existing, VSCODE_REMOTE_HOSTS)).toEqual([]);
  });

  it("ignores a wildcard deny — that does not open egress", () => {
    const existing = [
      rule({ host: "*", method: "*", pathPattern: "*", verdict: "deny" }),
    ];
    expect(hostsToSeed(existing, VSCODE_REMOTE_HOSTS)).toEqual([
      ...VSCODE_REMOTE_HOSTS,
    ]);
  });
});

/** A fake EgressService that records create() calls and returns canned list
 *  results. Only the two methods ensureEditorEgress touches are implemented. */
function fakeEgress(opts: {
  existing?: EgressRuleView[];
  listFails?: boolean;
  createFailsFor?: Set<string>;
}): { svc: EgressService; created: EgressRuleView[] } {
  const created: EgressRuleView[] = [];
  const svc = {
    async listForAgent() {
      return opts.listFails
        ? err({ kind: "transport" as const, reason: "boom" })
        : ok(opts.existing ?? []);
    },
    async create(input: EgressRuleCreateInput) {
      if (opts.createFailsFor?.has(input.host))
        return err({ kind: "transport" as const, reason: "nope" });
      const view = rule({ ...input, id: `r-${input.host}` });
      created.push(view);
      return ok(view);
    },
  } as unknown as EgressService;
  return { svc, created };
}

describe("ensureEditorEgress", () => {
  const collectNotes = () => {
    const notes: string[] = [];
    return { notes, note: (m: string) => notes.push(m) };
  };

  it("creates host-only allow rules for missing hosts and reports them", async () => {
    const { svc, created } = fakeEgress({});
    const { notes, note } = collectNotes();
    await ensureEditorEgress({
      egress: svc,
      agentId: "agent-1",
      hosts: VSCODE_REMOTE_HOSTS,
      note,
    });
    expect(created.map((r) => r.host)).toEqual([...VSCODE_REMOTE_HOSTS]);
    // Every seeded rule is L4 (host-only), so it applies without a pod roll.
    expect(
      created.every((r) => r.method === "*" && r.pathPattern === "*"),
    ).toBe(true);
    expect(created.every((r) => r.verdict === "allow")).toBe(true);
    expect(notes.some((n) => n.includes("pre-allowed"))).toBe(true);
  });

  it("creates nothing when the hosts are already allowed", async () => {
    const { svc, created } = fakeEgress({
      existing: VSCODE_REMOTE_HOSTS.map((host) => rule({ host })),
    });
    const { notes, note } = collectNotes();
    await ensureEditorEgress({
      egress: svc,
      agentId: "agent-1",
      hosts: VSCODE_REMOTE_HOSTS,
      note,
    });
    expect(created).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("warns and creates nothing when the rule list can't be fetched", async () => {
    const { svc, created } = fakeEgress({ listFails: true });
    const { notes, note } = collectNotes();
    await ensureEditorEgress({
      egress: svc,
      agentId: "agent-1",
      hosts: VSCODE_REMOTE_HOSTS,
      note,
    });
    expect(created).toEqual([]);
    expect(notes.some((n) => n.includes("could not check network rules"))).toBe(
      true,
    );
  });

  it("warns about the specific host whose create fails, still seeds the rest", async () => {
    const { svc, created } = fakeEgress({
      createFailsFor: new Set([VSCODE_REMOTE_HOSTS[0]]),
    });
    const { notes, note } = collectNotes();
    await ensureEditorEgress({
      egress: svc,
      agentId: "agent-1",
      hosts: VSCODE_REMOTE_HOSTS,
      note,
    });
    expect(created.map((r) => r.host)).toEqual([VSCODE_REMOTE_HOSTS[1]]);
    expect(
      notes.some(
        (n) =>
          n.includes("could not pre-allow") &&
          n.includes(VSCODE_REMOTE_HOSTS[0]),
      ),
    ).toBe(true);
  });
});
