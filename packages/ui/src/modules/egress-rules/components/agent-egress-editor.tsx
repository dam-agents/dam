import { Add, RotateCounterclockwise, TrashCan } from "@carbon/icons-react";
import {
  type EgressPreset,
  type EgressRuleView,
  formatEgressRuleSource,
} from "api-server-api";
import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../api/mutations.js";
import { useEgressRulesForAgent, useTrustedHosts } from "../api/queries.js";
import {
  confirmStagedGatewayRestart,
  describeGatewayRestart,
  stagedGatewayRestart,
  toPromotionRule,
} from "../gateway-restart.js";
import { formatHostPort, splitHostPort } from "../host-port.js";

const EMPTY: EgressRuleView[] = [];
const EMPTY_HOSTS: readonly string[] = [];
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface AddRuleDraft {
  host: string;
  method: string;
  pathPattern: string;
  verdict: "allow" | "deny";
}

const EMPTY_DRAFT: AddRuleDraft = {
  host: "",
  method: "*",
  pathPattern: "*",
  verdict: "allow",
};

export interface PendingAdd extends AddRuleDraft {
  tempId: string;
}

export interface StagedNetworkAccessController {
  preset: EgressPreset | null;
  setPreset: (next: EgressPreset | null) => void;
  pendingDeletes: ReadonlySet<string>;
  togglePendingDelete: (id: string) => void;
  pendingAdds: ReadonlyArray<PendingAdd>;
  appendPendingAdd: (draft: AddRuleDraft) => void;
  removePendingAdd: (tempId: string) => void;
  pendingConnectionGrants: ReadonlyArray<ConnectionGrantPreview>;
  pendingConnectionRevokes: ReadonlySet<string>;
  connectionLabels: ReadonlyMap<string, string>;
}

export interface ConnectionGrantPreview {
  connectionId: string;
  host: string;
  label: string;
}

export function AgentEgressEditor({
  agentId,
  currentPreset,
  staged,
}: {
  agentId: string;
  currentPreset?: EgressPreset | null;
  staged?: StagedNetworkAccessController;
}) {
  const { data: serverRules = EMPTY, isLoading } =
    useEgressRulesForAgent(agentId);
  const { data: trustedHosts = EMPTY_HOSTS } = useTrustedHosts();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();
  const applyPreset = useApplyEgressPreset();
  const [draft, setDraft] = useState<AddRuleDraft>(EMPTY_DRAFT);
  const [livePreset, setLivePreset] = useState<EgressPreset>(
    currentPreset ?? "trusted",
  );

  const stagedMode = staged !== undefined;
  const showConfirm = useStore((s) => s.showConfirm);

  const draftIsComplete =
    draft.host.trim().length > 0 &&
    draft.method.trim().length > 0 &&
    draft.pathPattern.trim().length > 0;
  const canAdd = draftIsComplete && !createRule.isPending;

  const stagedAdds = staged?.pendingAdds;
  const stagedDeletes = staged?.pendingDeletes;
  const pendingRestart = useMemo(
    () =>
      stagedGatewayRestart({
        current: serverRules,
        adds: [
          ...(stagedAdds?.map(toPromotionRule) ?? []),
          ...(draftIsComplete ? [toPromotionRule(draft)] : []),
        ],
        removeIds: stagedDeletes ? [...stagedDeletes] : [],
      }),
    [serverRules, stagedAdds, stagedDeletes, draft, draftIsComplete],
  );
  const demotedByStagedDeletes = new Set(pendingRestart.demotedByRemovals);

  const onAddRule = async () => {
    if (!canAdd) return;
    const next: AddRuleDraft = {
      host: draft.host.trim(),
      method: draft.method.trim().toUpperCase(),
      pathPattern: draft.pathPattern.trim(),
      verdict: draft.verdict,
    };
    if (stagedMode) {
      staged.appendPendingAdd(next);
      setDraft(EMPTY_DRAFT);
      return;
    }
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
      { onSuccess: () => setDraft(EMPTY_DRAFT) },
    );
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void onAddRule();
    }
  };

  const onPresetSelect = (next: EgressPreset) => {
    if (stagedMode) {
      staged.setPreset(next);
    } else {
      setLivePreset(next);
    }
  };

  const onApplyPresetLive = () => {
    if (
      livePreset === "all" &&
      !window.confirm(
        "Allow everything is a development escape hatch. Are you sure? You can still narrow with deny rules below.",
      )
    )
      return;
    applyPreset.mutate({ agentId, preset: livePreset });
  };

  const onRowDeleteClick = async (rule: EgressRuleView) => {
    if (stagedMode) {
      staged.togglePendingDelete(rule.id);
      return;
    }
    if (
      !(await confirmStagedGatewayRestart(
        showConfirm,
        agentId,
        { removeIds: [rule.id] },
        "Revoke & restart",
      ))
    )
      return;
    revokeRule.mutate({ id: rule.id });
  };

  const dropdownValue = stagedMode
    ? (staged.preset ?? currentPreset ?? "trusted")
    : livePreset;
  const stagedAddCount = stagedMode ? staged.pendingAdds.length : 0;
  const stagedDeleteCount = stagedMode ? staged.pendingDeletes.size : 0;
  const presetPending = stagedMode && staged.preset !== null;

  const presetPreviewRows: PreviewRow[] = presetPending
    ? buildPresetPreviewRows(staged.preset!, trustedHosts)
    : [];
  const connectionGrantPreviews: PreviewRow[] = stagedMode
    ? staged.pendingConnectionGrants.map((g) => ({
        key: `preview:connection:${g.connectionId}:${g.host}`,
        host: g.host,
        method: "*",
        pathPattern: "*",
        sourceBadge: `from ${g.label}`,
      }))
    : [];
  const previewRows: PreviewRow[] = [
    ...presetPreviewRows,
    ...connectionGrantPreviews,
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground max-w-prose">
        Rules decide which outbound HTTP requests this agent can make. The
        most-specific rule wins; <code>*</code> in <em>method</em> or
        <em>path</em> matches any value. Without a matching rule, the request
        goes to the inbox for your approval.
      </p>

      <Card className="px-3 py-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <SectionLabel>{stagedMode ? "Preset" : "Apply preset"}</SectionLabel>
          <Select
            size="xs"
            value={dropdownValue}
            onChange={(e) => onPresetSelect(e.target.value as EgressPreset)}
          >
            <option value="trusted">
              Trusted defaults (npm, PyPI, GitHub, Anthropic, …)
            </option>
            <option value="none">Strict default-deny (no rules added)</option>
            <option value="all">Allow everything (development only)</option>
          </Select>
        </div>
        {!stagedMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={onApplyPresetLive}
            disabled={applyPreset.isPending}
          >
            Apply
          </Button>
        )}
        <p className="basis-full text-sm text-muted-foreground">
          {stagedMode
            ? presetPending
              ? `Save will replace existing preset rules with "${staged.preset}". Manual and connection-derived rules are preserved.`
              : "Pick a preset and Save to replace existing preset rules. Manual and connection-derived rules are preserved."
            : "Replaces previous preset rules. Manual edits and connection-derived rules are preserved."}
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-3 py-3 border-b border-border flex flex-wrap items-end gap-2">
          <Field label="Host" widthClass="min-w-[220px] flex-1">
            <Input
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              onKeyDown={onInputKeyDown}
              placeholder="api.anthropic.com"
              size="xs"
            />
          </Field>
          <Field label="Method" widthClass="w-[100px]">
            <Select
              size="xs"
              value={
                ALL_METHODS.includes(
                  draft.method as (typeof ALL_METHODS)[number],
                ) || draft.method === "*"
                  ? draft.method
                  : "*"
              }
              onChange={(e) => setDraft({ ...draft, method: e.target.value })}
            >
              <option value="*">* (any)</option>
              {ALL_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Path" widthClass="min-w-[160px] flex-1">
            <Input
              value={draft.pathPattern}
              onChange={(e) =>
                setDraft({ ...draft, pathPattern: e.target.value })
              }
              onKeyDown={onInputKeyDown}
              placeholder="*  or  /v1/messages*"
              size="xs"
              variant="monospace"
            />
          </Field>
          <Field label="Verdict" widthClass="w-[100px]">
            <Select
              size="xs"
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
          </Field>
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => void onAddRule()}
            disabled={!canAdd}
            variant="outline"
          >
            <Add size={11} /> Add rule
          </Button>
          {pendingRestart.willRestart && (
            <p className="basis-full text-[11px] text-warning">
              {describeGatewayRestart(pendingRestart)}
            </p>
          )}
        </div>

        {isLoading ? (
          <p className="px-4 py-5 text-xs text-muted-foreground">loading…</p>
        ) : serverRules.length === 0 &&
          stagedAddCount === 0 &&
          previewRows.length === 0 ? (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            No rules yet. Every outbound request will surface in the inbox.
          </p>
        ) : (
          <ul className="flex flex-col">
            {serverRules.map((r) => {
              const userDelete = stagedMode && staged.pendingDeletes.has(r.id);
              const presetSweep =
                presetPending && r.source.startsWith("preset:");
              const connId = r.source.startsWith("connection:")
                ? r.source.slice("connection:".length)
                : null;
              const connectionSweep =
                stagedMode &&
                connId !== null &&
                staged.pendingConnectionRevokes.has(connId);
              const sourceLabelOverride =
                connId !== null &&
                stagedMode &&
                staged.connectionLabels.has(connId)
                  ? `from ${staged.connectionLabels.get(connId)!}`
                  : null;
              return (
                <RuleRow
                  key={r.id}
                  rule={r}
                  sourceLabelOverride={sourceLabelOverride}
                  pendingDelete={userDelete || presetSweep || connectionSweep}
                  demotesHost={userDelete && demotedByStagedDeletes.has(r.host)}
                  hideAction={(presetSweep || connectionSweep) && !userDelete}
                  onAction={() => void onRowDeleteClick(r)}
                  disabled={!stagedMode && revokeRule.isPending}
                />
              );
            })}
            {previewRows.map((p) => (
              <PreviewPresetRow key={p.key} row={p} />
            ))}
            {stagedMode &&
              staged.pendingAdds.map((a) => (
                <PendingAddRow
                  key={a.tempId}
                  add={a}
                  onCancel={() => staged.removePendingAdd(a.tempId)}
                />
              ))}
          </ul>
        )}
        {stagedMode &&
          (stagedAddCount > 0 || stagedDeleteCount > 0 || presetPending) && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border bg-background/40">
              Pending:{" "}
              {[
                presetPending && `apply preset ${staged.preset}`,
                stagedAddCount > 0 &&
                  `${stagedAddCount} new rule${stagedAddCount === 1 ? "" : "s"}`,
                stagedDeleteCount > 0 &&
                  `${stagedDeleteCount} delete${stagedDeleteCount === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              . Save to commit.
            </p>
          )}
      </Card>
    </div>
  );
}

function Field({
  label,
  widthClass,
  children,
}: {
  label: string;
  widthClass: string;
  children: React.ReactNode;
}) {
  return (
    <FormField label={label} disableInset className={cn("gap-1", widthClass)}>
      {children}
    </FormField>
  );
}

function RuleRow({
  rule,
  sourceLabelOverride,
  pendingDelete,
  demotesHost,
  hideAction,
  onAction,
  disabled,
}: {
  rule: EgressRuleView;
  sourceLabelOverride?: string | null;
  pendingDelete: boolean;
  demotesHost?: boolean;
  hideAction?: boolean;
  onAction: () => void;
  disabled: boolean;
}) {
  const sourceLabel =
    sourceLabelOverride ??
    (rule.source === "manual" ? null : formatEgressRuleSource(rule.source));
  const dim = pendingDelete ? "opacity-40 line-through" : "";
  return (
    <li
      className={`border-b border-border px-3 py-2 flex items-center gap-2 text-xs ${dim}`}
    >
      <VerdictBadge verdict={rule.verdict} />
      <span className="font-mono text-[11px] text-muted-foreground w-[60px]">
        {rule.method}
      </span>
      <span className="font-medium truncate">{formatHostPort(rule)}</span>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {rule.pathPattern}
      </span>
      {sourceLabel && (
        <SourceTag label={sourceLabel} hint={`source: ${rule.source}`} />
      )}
      {demotesHost && (
        <Badge
          size="sm"
          variant="warning"
          title={`Saving stops request inspection for ${rule.host}, which restarts the network gateway (~5–15s). The agent keeps running.`}
        >
          restarts gateway
        </Badge>
      )}
      <span className="ml-auto text-[10px] text-muted-foreground hidden sm:block">
        by {rule.decidedBy.slice(0, 8)}
      </span>
      {!hideAction && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onAction}
          disabled={disabled}
          aria-label={pendingDelete ? "Undo delete" : "Revoke rule"}
          tooltip={pendingDelete ? "Undo delete" : "Revoke rule"}
        >
          {pendingDelete ? (
            <RotateCounterclockwise size={11} />
          ) : (
            <TrashCan size={11} />
          )}
        </Button>
      )}
    </li>
  );
}

function PendingAddRow({
  add,
  onCancel,
}: {
  add: PendingAdd;
  onCancel: () => void;
}) {
  return (
    <li className="border-b border-border px-3 py-2 flex items-center gap-2 text-xs bg-primary/10">
      <VerdictBadge verdict={add.verdict} />
      <span className="font-mono text-[11px] text-muted-foreground w-[60px]">
        {add.method}
      </span>
      <span className="font-medium truncate">{add.host}</span>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {add.pathPattern}
      </span>
      <Badge size="sm" variant="accent" className="uppercase tracking-wider">
        new
      </Badge>
      <span className="ml-auto" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={onCancel}
        aria-label="Discard pending rule"
        tooltip="Discard pending rule"
      >
        <TrashCan size={11} />
      </Button>
    </li>
  );
}

interface PreviewRow {
  key: string;
  host: string;
  method: string;
  pathPattern: string;
  sourceBadge: string;
}

function buildPresetPreviewRows(
  preset: EgressPreset,
  trustedHosts: readonly string[],
): PreviewRow[] {
  if (preset === "none") return [];
  if (preset === "all") {
    return [
      {
        key: "preview:all",
        host: "*",
        method: "*",
        pathPattern: "*",
        sourceBadge: "preset: all",
      },
    ];
  }
  return trustedHosts.map((host) => ({
    key: `preview:trusted:${host}`,
    host,
    method: "*",
    pathPattern: "*",
    sourceBadge: "preset: trusted",
  }));
}

function PreviewPresetRow({ row }: { row: PreviewRow }) {
  return (
    <li className="border-b border-border px-3 py-2 flex items-center gap-2 text-xs bg-primary/5">
      <VerdictBadge verdict="allow" />
      <span className="font-mono text-[11px] text-muted-foreground w-[60px]">
        {row.method}
      </span>
      <span className="font-medium truncate">{row.host}</span>
      <span className="font-mono text-[11px] text-muted-foreground truncate">
        {row.pathPattern}
      </span>
      <SourceTag
        label={row.sourceBadge}
        hint={`Preview — ${row.sourceBadge} (saved on commit)`}
      />
      <Badge
        size="sm"
        variant="accent"
        className="uppercase tracking-wider"
        title="This rule will be saved on commit"
      >
        preview
      </Badge>
      <span className="ml-auto" />
      {}
    </li>
  );
}

function VerdictBadge({ verdict }: { verdict: EgressRuleView["verdict"] }) {
  return (
    <Badge
      size="sm"
      variant={verdict === "allow" ? "success" : "danger"}
      className="uppercase tracking-wider"
    >
      {verdict}
    </Badge>
  );
}

function SourceTag({ label, hint }: { label: string; hint: string }) {
  return (
    <Badge size="sm" variant="muted" title={hint}>
      {label}
    </Badge>
  );
}
