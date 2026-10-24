import { Add } from "@carbon/icons-react";
import {
  type EgressPreset,
  type EgressRuleView,
  formatEgressRuleSource,
} from "api-server-api";
import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardButton } from "@/components/ui/card-button";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { ListGroup } from "@/components/ui/list-group";
import { ListSection } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { Select } from "@/components/ui/select";

import { getUser } from "../../../auth.js";
import { useStore } from "../../../store.js";
import { useAgentPageConnections } from "../../connections/api/queries.js";
import type { SectionHeaderSlot } from "../../sandboxes/components/sandbox-home-header.js";
import { useGuardedClose } from "../../sandboxes/hooks/use-guarded-close.js";
import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../api/mutations.js";
import { useCurrentPreset, useEgressRulesForAgent } from "../api/queries.js";
import {
  confirmStagedGatewayRestart,
  describeGatewayRestart,
  stagedGatewayRestart,
  toPromotionRule,
} from "../gateway-restart.js";
import { formatHostPort, splitHostPort } from "../host-port.js";
import {
  egressHostError,
  groupRules,
  RULE_GROUP_TITLE,
  type RuleGroupKey,
} from "../rule-groups.js";

const EMPTY: EgressRuleView[] = [];
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface RuleDraft {
  host: string;
  method: string;
  pathPattern: string;
  verdict: "allow" | "deny";
}

const EMPTY_DRAFT: RuleDraft = {
  host: "",
  method: "*",
  pathPattern: "*",
  verdict: "allow",
};

export function AgentEgressEditor({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const {
    data: rules = EMPTY,
    isLoading,
    isError,
  } = useEgressRulesForAgent(agentId);
  const { data: currentPreset = null } = useCurrentPreset(agentId);
  const revokeRule = useRevokeEgressRule();
  const showConfirm = useStore((s) => s.showConfirm);
  const [adding, setAdding] = useState(false);
  const [choosingPreset, setChoosingPreset] = useState(false);
  const [query, setQuery] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const groups = useMemo(() => groupRules(rules, query), [rules, query]);
  const { data: connections } = useAgentPageConnections(agentId);
  const connectionNames = useMemo(
    () => new Map((connections ?? []).map((c) => [c.id, c.name])),
    [connections],
  );
  const me = getUser()?.profile.sub;

  const revoke = async (rule: EgressRuleView) => {
    if (
      await confirmStagedGatewayRestart(
        showConfirm,
        agentId,
        { removeIds: [rule.id] },
        "Revoke and restart",
      )
    )
      revokeRule.mutate({ id: rule.id });
  };

  return (
    <>
      {header()}
      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          data-testid="egress-rule-new"
        >
          <Add size={16} />
          Create rule
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChoosingPreset(true)}
          data-testid="egress-preset-open"
        >
          Apply preset
        </Button>
      </div>
      <ListSection
        loading={isLoading}
        error={isError && "Couldn't load the rules."}
        isEmpty={rules.length === 0}
        empty="No rules yet. Every outbound request will need your approval."
      >
        {(rules.length > 10 || query !== "") && (
          <div className="px-4 py-2.5">
            <Input
              type="search"
              size="sm"
              aria-label="Search rules"
              placeholder="Search hosts and paths"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        {groups.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No rule matches “{query.trim()}”.
          </p>
        )}
        {groups.map((g) => {
          const collapsible = g.key === "preset" && !query.trim();
          const open = !collapsible || presetOpen;
          return (
            <ListGroup
              key={g.key}
              title={`${RULE_GROUP_TITLE[g.key]} (${g.rules.length})`}
              testId={`egress-group-${g.key}`}
              accessory={
                collapsible && (
                  <DisclosureToggle
                    open={open}
                    onToggle={() => setPresetOpen(!open)}
                    className="ml-auto text-sm text-muted-foreground hover:text-foreground"
                  >
                    {open ? "Hide" : "Show"}
                  </DisclosureToggle>
                )
              }
            >
              {open &&
                g.rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    group={g.key}
                    decidedByYou={r.decidedBy === me}
                    connectionName={
                      r.source.startsWith("connection:")
                        ? connectionNames.get(
                            r.source.slice("connection:".length),
                          )
                        : undefined
                    }
                    disabled={revokeRule.isPending}
                    onRevoke={() => void revoke(r)}
                  />
                ))}
            </ListGroup>
          );
        })}
      </ListSection>

      {choosingPreset && (
        <PresetModal
          agentId={agentId}
          current={currentPreset}
          onClose={() => setChoosingPreset(false)}
        />
      )}

      {adding && (
        <NewRuleModal
          agentId={agentId}
          rules={rules}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

const PRESETS: { value: EgressPreset; title: string; description: string }[] = [
  {
    value: "trusted",
    title: "Trusted defaults",
    description:
      "Allows common registries and APIs: npm, PyPI, GitHub, Anthropic, …",
  },
  {
    value: "none",
    title: "Strict default-deny",
    description:
      "Adds no rules: every request needs your approval or a rule of your own.",
  },
  {
    value: "all",
    title: "Allow everything",
    description: "The agent can reach any host. For development only.",
  },
];

function PresetModal({
  agentId,
  current,
  onClose,
}: {
  agentId: string;
  current: EgressPreset | null;
  onClose: () => void;
}) {
  const applyPreset = useApplyEgressPreset();
  const showConfirm = useStore((s) => s.showConfirm);
  const [picked, setPicked] = useState<EgressPreset>(current ?? "trusted");
  const apply = async () => {
    if (
      picked === "all" &&
      !(await showConfirm(
        "The agent can reach any host. You can still narrow it with deny rules.",
        "Allow everything?",
        { kind: "destructive", confirmLabel: "Allow everything" },
      ))
    )
      return;
    applyPreset.mutate({ agentId, preset: picked }, { onSuccess: onClose });
  };
  return (
    <Modal onClose={applyPreset.isPending ? undefined : onClose}>
      <DialogHeader
        onClose={onClose}
        closeDisabled={applyPreset.isPending}
        title="Use a preset"
        subtitle="A preset replaces the rules the previous preset added. Your own rules and rules from connections stay."
      />
      <DialogBody className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="Preset"
          className="flex flex-col gap-3"
        >
          {PRESETS.map((p) => (
            <CardButton
              key={p.value}
              role="radio"
              aria-checked={picked === p.value}
              selected={picked === p.value}
              onClick={() => setPicked(p.value)}
              className="flex flex-col items-start gap-1 p-4"
              data-testid={`egress-preset-${p.value}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {p.title}
                {current === p.value && <Badge variant="muted">Current</Badge>}
              </span>
              <span className="text-sm text-muted-foreground">
                {p.description}
              </span>
            </CardButton>
          ))}
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={applyPreset.isPending}
        label="Apply preset"
        pendingLabel="Applying…"
        pending={applyPreset.isPending}
        disabled={picked === current}
        onSubmit={() => void apply()}
        testId="egress-preset-apply"
      />
    </Modal>
  );
}

function NewRuleModal({
  agentId,
  rules,
  onClose,
}: {
  agentId: string;
  rules: EgressRuleView[];
  onClose: () => void;
}) {
  const createRule = useCreateEgressRule();
  const showConfirm = useStore((s) => s.showConfirm);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const hostError = egressHostError(draft.host);
  const complete =
    draft.host.trim().length > 0 &&
    !hostError &&
    draft.pathPattern.trim().length > 0;
  const close = useGuardedClose(
    draft.host.trim() !== "" ||
      draft.method !== EMPTY_DRAFT.method ||
      draft.pathPattern !== EMPTY_DRAFT.pathPattern ||
      draft.verdict !== EMPTY_DRAFT.verdict,
    onClose,
  );
  const restart = stagedGatewayRestart({
    current: rules,
    adds: complete ? [toPromotionRule(draft)] : [],
  });

  const add = async () => {
    if (!complete || createRule.isPending) return;
    const next = {
      host: draft.host.trim(),
      method: draft.method,
      pathPattern: draft.pathPattern.trim(),
      verdict: draft.verdict,
    };
    if (
      !(await confirmStagedGatewayRestart(
        showConfirm,
        agentId,
        { adds: [toPromotionRule(next)] },
        "Add and restart",
      ))
    )
      return;
    createRule.mutate(
      { agentId, ...next, ...splitHostPort(next.host) },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal onClose={createRule.isPending ? undefined : () => void close()}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <DialogHeader
          onClose={() => void close()}
          closeDisabled={createRule.isPending}
          title="New rule"
        />
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Host" error={hostError}>
            <Input
              autoFocus
              aria-invalid={hostError ? true : undefined}
              variant={hostError ? "invalid" : undefined}
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              placeholder="api.anthropic.com"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Method">
              <Select
                value={draft.method}
                onChange={(e) => setDraft({ ...draft, method: e.target.value })}
              >
                <option value="*">Any method</option>
                {ALL_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Verdict">
              <Select
                value={draft.verdict}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    verdict: e.target.value as "allow" | "deny",
                  })
                }
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </Select>
            </FormField>
          </div>
          <FormField label="Path">
            <Input
              value={draft.pathPattern}
              onChange={(e) =>
                setDraft({ ...draft, pathPattern: e.target.value })
              }
              placeholder="*  or  /v1/messages*"
              variant="monospace"
            />
          </FormField>
          {restart.willRestart && (
            <p className="text-sm text-warning">
              {describeGatewayRestart(restart)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Use <code>*</code> as a wildcard.
          </p>
        </DialogBody>
        <DialogActions
          onCancel={() => void close()}
          cancelDisabled={createRule.isPending}
          label="Create rule"
          pendingLabel="Creating…"
          pending={createRule.isPending}
          disabled={!complete}
          testId="egress-rule-add"
        />
      </form>
    </Modal>
  );
}

function RuleRow({
  rule,
  group,
  decidedByYou,
  connectionName,
  disabled,
  onRevoke,
}: {
  rule: EgressRuleView;
  group: RuleGroupKey;
  decidedByYou: boolean;
  connectionName: string | undefined;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const host = formatHostPort(rule);
  const sourceLabel =
    group === "connection"
      ? connectionName && `from ${connectionName}`
      : rule.source === "inbox"
        ? formatEgressRuleSource(rule.source)
        : null;
  return (
    <div className="@container flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <Badge
        size="sm"
        variant={rule.verdict === "allow" ? "success" : "danger"}
        className="shrink-0"
      >
        {rule.verdict === "allow" ? "Allow" : "Deny"}
      </Badge>
      <span className="w-[60px] shrink-0 font-mono text-xs text-muted-foreground">
        {rule.method === "*" ? "Any" : rule.method}
      </span>
      <span className="min-w-[8rem] flex-1 truncate font-medium" title={host}>
        {host}
        {rule.pathPattern !== "*" && (
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {" "}
            {rule.pathPattern}
          </span>
        )}
      </span>
      {sourceLabel && (
        <Badge
          size="sm"
          variant="muted"
          className="hidden shrink-0 whitespace-nowrap @md:inline-flex"
        >
          {sourceLabel}
        </Badge>
      )}
      {decidedByYou && group === "own" && (
        <span className="hidden shrink-0 text-xs text-muted-foreground @lg:block">
          by you
        </span>
      )}
      <RemoveButton
        label={`Revoke rule for ${host}`}
        tooltip="Revoke rule"
        onClick={onRevoke}
        disabled={disabled}
      />
    </div>
  );
}
