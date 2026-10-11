import {
  type EgressPreset,
  type EgressRuleView,
  formatEgressRuleSource,
} from "api-server-api";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { ListSection } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { Select } from "@/components/ui/select";

import { useStore } from "../../../store.js";
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

export function AgentEgressEditor({ agentId }: { agentId: string }) {
  const { data: rules = EMPTY, isLoading } = useEgressRulesForAgent(agentId);
  const { data: currentPreset = null } = useCurrentPreset(agentId);
  const revokeRule = useRevokeEgressRule();
  const showConfirm = useStore((s) => s.showConfirm);
  const [adding, setAdding] = useState(false);
  const [choosingPreset, setChoosingPreset] = useState(false);

  const revoke = async (rule: EgressRuleView) => {
    if (
      await confirmStagedGatewayRestart(
        showConfirm,
        agentId,
        { removeIds: [rule.id] },
        "Revoke & restart",
      )
    )
      revokeRule.mutate({ id: rule.id });
  };

  return (
    <>
      <ListSection
        onNew={() => setAdding(true)}
        newTestId="egress-rule-new"
        headerExtra={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setChoosingPreset(true)}
            data-testid="egress-preset-open"
          >
            Use preset…
          </Button>
        }
        isEmpty={!isLoading && rules.length === 0}
        empty="No rules yet. Every outbound request will need your approval."
      >
        {isLoading && (
          <p className="px-4 py-3 text-xs text-muted-foreground">loading…</p>
        )}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            disabled={revokeRule.isPending}
            onRevoke={() => void revoke(r)}
          />
        ))}
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
      "Allows common package registries and APIs: npm, PyPI, GitHub, Anthropic, …",
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
  const [picked, setPicked] = useState<EgressPreset>(current ?? "trusted");
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
        onSubmit={() =>
          applyPreset.mutate(
            { agentId, preset: picked },
            { onSuccess: onClose },
          )
        }
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
  const complete =
    draft.host.trim().length > 0 && draft.pathPattern.trim().length > 0;
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
        "Add & restart",
      ))
    )
      return;
    createRule.mutate(
      { agentId, ...next, ...splitHostPort(next.host) },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal onClose={createRule.isPending ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <DialogHeader
          onClose={onClose}
          closeDisabled={createRule.isPending}
          title="New rule"
        />
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Host">
            <Input
              autoFocus
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
                <option value="*">* (any)</option>
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
                <option value="allow">allow</option>
                <option value="deny">deny</option>
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
          onCancel={onClose}
          cancelDisabled={createRule.isPending}
          label="Add rule"
          pendingLabel="Adding…"
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
  disabled,
  onRevoke,
}: {
  rule: EgressRuleView;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const sourceLabel =
    rule.source === "manual" ? null : formatEgressRuleSource(rule.source);
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 text-xs">
      <Badge
        size="sm"
        variant={rule.verdict === "allow" ? "success" : "danger"}
        className="uppercase tracking-wider"
      >
        {rule.verdict}
      </Badge>
      <span className="font-mono text-[11px] text-muted-foreground w-[60px]">
        {rule.method}
      </span>
      <span className="font-medium truncate">{formatHostPort(rule)}</span>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {rule.pathPattern}
      </span>
      {sourceLabel && (
        <Badge size="sm" variant="muted" title={`source: ${rule.source}`}>
          {sourceLabel}
        </Badge>
      )}
      <span className="ml-auto text-[10px] text-muted-foreground hidden sm:block">
        by {rule.decidedBy.slice(0, 8)}
      </span>
      <RemoveButton
        label="Revoke rule"
        onClick={onRevoke}
        disabled={disabled}
      />
    </div>
  );
}
