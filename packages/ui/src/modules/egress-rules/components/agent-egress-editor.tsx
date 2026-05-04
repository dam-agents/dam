import type { EgressPreset, EgressRuleView } from "api-server-api";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../api/mutations.js";
import { useEgressRulesForAgent, useTrustedHosts } from "../api/queries.js";

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
  /** Stable client-side id used as the React key while the row is unsaved.
   *  Replaced by a server id on the next refetch after Save commits. */
  tempId: string;
}

/**
 * Optional staging hook used when the editor is embedded in a parent form
 * with its own Save button (the configure-agent dialog). Rules edits and
 * the preset choice are all funneled through this controller; the parent
 * accumulates them and commits on Save. When the prop is omitted the
 * editor falls back to live mode — every action commits immediately.
 */
export interface StagedNetworkAccessController {
  preset: EgressPreset | null;
  setPreset: (next: EgressPreset | null) => void;
  pendingDeletes: ReadonlySet<string>;
  togglePendingDelete: (id: string) => void;
  pendingAdds: ReadonlyArray<PendingAdd>;
  appendPendingAdd: (draft: AddRuleDraft) => void;
  removePendingAdd: (tempId: string) => void;
  /** Mirrors the secret-grant diff in the parent dialog. The server's
   *  `setAgentAccess` writes a `(host, *, *, allow, source=connection:<id>)`
   *  rule per granted secret on Save — we render the same rows as preview
   *  here so the user sees what their connection toggles will produce. */
  pendingConnectionGrants: ReadonlyArray<ConnectionGrantPreview>;
  /** Connection ids whose rules will be revoked on Save. Existing rows
   *  with `source = connection:<id>` for these ids are struck through to
   *  match how preset sweeps render. */
  pendingConnectionRevokes: ReadonlySet<string>;
  /** Resolves `connection:<id>` → human-readable label so the rule list
   *  shows "from Anthropic API Key" instead of a raw UUID. */
  connectionLabels: ReadonlyMap<string, string>;
}

export interface ConnectionGrantPreview {
  connectionId: string;
  host: string;
  label: string;
}

/**
 * Renders the per-agent network access rules form + list. Embedded in the
 * configure-agent dialog (staged via `staged` controller — Save commits)
 * and in the standalone /agents/:id/egress route (live — every action
 * fires its mutation directly).
 *
 * `currentPreset` is the preset the server derives from the agent's rule
 * `source` column (via `useCurrentPreset` in the parent dialog) — the
 * preset isn't stored on the agent spec; it's the projection of which
 * `preset:*` rows are present. It seeds the dropdown so the user sees
 * their existing choice instead of a hardcoded default. It's also what
 * we treat as the "effective" preset when no staged change is pending.
 */
export function AgentEgressEditor({
  agentId,
  currentPreset,
  staged,
}: {
  agentId: string;
  currentPreset?: EgressPreset | null;
  staged?: StagedNetworkAccessController;
}) {
  const { data: serverRules = EMPTY, isLoading } = useEgressRulesForAgent(agentId);
  const { data: trustedHosts = EMPTY_HOSTS } = useTrustedHosts();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();
  const applyPreset = useApplyEgressPreset();
  const [draft, setDraft] = useState<AddRuleDraft>(EMPTY_DRAFT);
  const [livePreset, setLivePreset] = useState<EgressPreset>(currentPreset ?? "trusted");

  const stagedMode = staged !== undefined;

  // Path-specific rules need MITM, which means the controller has to
  // re-issue the leaf cert and roll the agent pod. The L4 (host-only) path
  // is a pure DB write — no roll. Warn the user so they own the timing.
  const draftIsPathSpecific = draft.method !== "*" || draft.pathPattern.trim() !== "*";
  const draftRequiresRestart =
    draft.host.trim().length > 0
    && draftIsPathSpecific
    && !serverRules.some(
      (r) => r.host === draft.host.trim() && (r.method !== "*" || r.pathPattern !== "*"),
    );

  const canAdd =
    draft.host.trim().length > 0
    && draft.method.trim().length > 0
    && draft.pathPattern.trim().length > 0
    && !createRule.isPending;

  const onAddRule = () => {
    if (!canAdd) return;
    const next: AddRuleDraft = {
      host: draft.host.trim(),
      method: draft.method.trim().toUpperCase(),
      pathPattern: draft.pathPattern.trim(),
      verdict: draft.verdict,
    };
    if (stagedMode) {
      // Path-rule warning fires at Save time — staging is reversible, so
      // a confirm here is premature.
      staged.appendPendingAdd(next);
      setDraft(EMPTY_DRAFT);
      return;
    }
    if (
      draftRequiresRestart
      && !window.confirm(
        `Saving this rule will restart the agent (~5–15s) so Envoy can MITM "${next.host}" for path-level enforcement. Continue?`,
      )
    ) return;
    createRule.mutate(
      { agentId, ...next },
      { onSuccess: () => setDraft(EMPTY_DRAFT) },
    );
  };

  // Pressing Enter inside any input commits the rule. We avoid a wrapper
  // <form> so this editor is safe to embed inside other forms (the configure-
  // agent dialog) — nested forms are invalid HTML and break event handling.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddRule();
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
      livePreset === "all"
      && !window.confirm(
        "Allow everything is a development escape hatch. Are you sure? You can still narrow with deny rules below.",
      )
    ) return;
    applyPreset.mutate({ agentId, preset: livePreset });
  };

  const onRowDeleteClick = (rule: EgressRuleView) => {
    if (stagedMode) {
      staged.togglePendingDelete(rule.id);
    } else {
      revokeRule.mutate({ id: rule.id });
    }
  };

  const dropdownValue = stagedMode
    ? staged.preset ?? currentPreset ?? "trusted"
    : livePreset;
  const stagedAddCount = stagedMode ? staged.pendingAdds.length : 0;
  const stagedDeleteCount = stagedMode ? staged.pendingDeletes.size : 0;
  const presetPending = stagedMode && staged.preset !== null;

  // Preset preview: when a preset switch is staged, render existing
  // `preset:*` rows as struck-through (server will sweep them on Save) and
  // append virtual rows for what the new preset will seed. Same visual
  // treatment as a user-initiated delete keeps the "this is going away on
  // save" affordance consistent across both flows. Connection-grant
  // toggles in the parent dialog produce the same kind of preview rows
  // (pre-server) so the user sees the rules a Save will generate.
  const presetPreviewRows: PreviewRow[] = presetPending
    ? buildPresetPreviewRows(staged.preset!, trustedHosts)
    : [];
  const connectionGrantPreviews: PreviewRow[] = stagedMode
    ? staged.pendingConnectionGrants.map((g) => ({
        key: `preview:connection:${g.connectionId}`,
        host: g.host,
        method: "*",
        pathPattern: "*",
        sourceBadge: `from ${g.label}`,
      }))
    : [];
  const previewRows: PreviewRow[] = [...presetPreviewRows, ...connectionGrantPreviews];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-text-muted leading-relaxed max-w-prose">
        Rules decide which outbound HTTP requests this agent can make. The
        most-specific rule wins; <code>*</code> in <em>method</em> or
        <em>path</em> matches any value. Without a matching rule, the request
        goes to the inbox for your approval.
      </p>

      <div className="rounded-lg border border-border-light bg-surface px-3 py-3 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            {stagedMode ? "Preset" : "Apply preset"}
          </span>
          <select
            value={dropdownValue}
            onChange={(e) => onPresetSelect(e.target.value as EgressPreset)}
            className="h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
          >
            <option value="trusted">Trusted defaults (npm, PyPI, GitHub, Anthropic, …)</option>
            <option value="none">Strict default-deny (no rules added)</option>
            <option value="all">Allow everything (development only)</option>
          </select>
        </div>
        {!stagedMode && (
          <button
            type="button"
            onClick={onApplyPresetLive}
            disabled={applyPreset.isPending}
            className="h-7 inline-flex items-center gap-1 rounded-md border border-border-light bg-bg px-2.5 text-[11px] hover:border-accent hover:text-accent disabled:opacity-40 transition-colors"
          >
            Apply
          </button>
        )}
        <p className="basis-full text-[11px] text-text-muted">
          {stagedMode
            ? presetPending
              ? `Save will replace existing preset rules with "${staged.preset}". Manual and connection-derived rules are preserved.`
              : "Pick a preset and Save to replace existing preset rules. Manual and connection-derived rules are preserved."
            : "Replaces previous preset rules. Manual edits and connection-derived rules are preserved."}
        </p>
      </div>

      <div className="rounded-lg border border-border-light bg-surface overflow-hidden">
        <div className="px-3 py-3 border-b border-border-light flex flex-wrap items-end gap-2">
          <Field label="Host" widthClass="min-w-[220px] flex-1">
            <input
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              onKeyDown={onInputKeyDown}
              placeholder="api.anthropic.com"
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            />
          </Field>
          <Field label="Method" widthClass="w-[100px]">
            <select
              value={ALL_METHODS.includes(draft.method as (typeof ALL_METHODS)[number]) || draft.method === "*" ? draft.method : "*"}
              onChange={(e) => setDraft({ ...draft, method: e.target.value })}
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            >
              <option value="*">* (any)</option>
              {ALL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Path" widthClass="min-w-[160px] flex-1">
            <input
              value={draft.pathPattern}
              onChange={(e) => setDraft({ ...draft, pathPattern: e.target.value })}
              onKeyDown={onInputKeyDown}
              placeholder="*  or  /v1/messages*"
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px] font-mono"
            />
          </Field>
          <Field label="Verdict" widthClass="w-[100px]">
            <select
              value={draft.verdict}
              onChange={(e) => setDraft({ ...draft, verdict: e.target.value as "allow" | "deny" })}
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            >
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </Field>
          <button
            type="button"
            onClick={onAddRule}
            disabled={!canAdd}
            className="h-7 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <Plus size={11} /> Add rule
          </button>
          {draftRequiresRestart && (
            <p className="basis-full text-[11px] text-warning">
              {stagedMode
                ? "Saving will restart the agent (~5–15s) — path-level rules need MITM on this host."
                : "Saving will restart the agent (~5–15s) — path-level rules need MITM on this host."}
            </p>
          )}
        </div>

        {isLoading ? (
          <p className="px-4 py-5 text-[12px] text-text-muted">loading…</p>
        ) : serverRules.length === 0 && stagedAddCount === 0 && previewRows.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No rules yet. Every outbound request will surface in the inbox.
          </p>
        ) : (
          <ul className="flex flex-col">
            {serverRules.map((r) => {
              const userDelete = stagedMode && staged.pendingDeletes.has(r.id);
              const presetSweep = presetPending && r.source.startsWith("preset:");
              const connId = r.source.startsWith("connection:")
                ? r.source.slice("connection:".length)
                : null;
              const connectionSweep =
                stagedMode && connId !== null && staged.pendingConnectionRevokes.has(connId);
              const sourceLabelOverride =
                connId !== null && stagedMode && staged.connectionLabels.has(connId)
                  ? `from ${staged.connectionLabels.get(connId)!}`
                  : null;
              return (
                <RuleRow
                  key={r.id}
                  rule={r}
                  sourceLabelOverride={sourceLabelOverride}
                  pendingDelete={userDelete || presetSweep || connectionSweep}
                  // Preset / connection sweeps are tied to picker state in
                  // the parent, not to the trash icon — toggling here can't
                  // undo them, so hide the per-row action.
                  hideAction={(presetSweep || connectionSweep) && !userDelete}
                  onAction={() => onRowDeleteClick(r)}
                  disabled={!stagedMode && revokeRule.isPending}
                />
              );
            })}
            {previewRows.map((p) => (
              <PreviewPresetRow key={p.key} row={p} />
            ))}
            {stagedMode && staged.pendingAdds.map((a) => (
              <PendingAddRow
                key={a.tempId}
                add={a}
                onCancel={() => staged.removePendingAdd(a.tempId)}
              />
            ))}
          </ul>
        )}
        {stagedMode && (stagedAddCount > 0 || stagedDeleteCount > 0 || presetPending) && (
          <p className="px-3 py-2 text-[11px] text-text-muted border-t border-border-light bg-bg/40">
            Pending: {[
              presetPending && `apply preset ${staged.preset}`,
              stagedAddCount > 0 && `${stagedAddCount} new rule${stagedAddCount === 1 ? "" : "s"}`,
              stagedDeleteCount > 0 && `${stagedDeleteCount} delete${stagedDeleteCount === 1 ? "" : "s"}`,
            ].filter(Boolean).join(" · ")}. Save to commit.
          </p>
        )}
      </div>
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
    <label className={`flex flex-col gap-1 ${widthClass}`}>
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function RuleRow({
  rule,
  sourceLabelOverride,
  pendingDelete,
  hideAction,
  onAction,
  disabled,
}: {
  rule: EgressRuleView;
  /** When non-null, replaces the source badge text. Used to resolve a raw
   *  `connection:<id>` source into "from <connection-name>". */
  sourceLabelOverride?: string | null;
  /** true → row is staged for deletion; render dimmed with an undo affordance. */
  pendingDelete: boolean;
  /** true → omit the per-row action button. Used when the row is being
   *  removed by a preset sweep, where the only undo is to revert the
   *  preset selection in the dropdown. */
  hideAction?: boolean;
  /** Fired when the user clicks the trash (live mode) or the toggle button
   *  (staged mode). Caller decides whether to mutate or stage. */
  onAction: () => void;
  disabled: boolean;
}) {
  const verdictTone =
    rule.verdict === "allow"
      ? "text-accent border-accent/40"
      : "text-danger border-danger/40";
  const sourceLabel = sourceLabelOverride ?? formatSource(rule.source);
  const dim = pendingDelete ? "opacity-40 line-through" : "";
  return (
    <li className={`border-b border-border-light px-3 py-2 flex items-center gap-2 text-[12px] ${dim}`}>
      <span className={`uppercase tracking-wider text-[10px] rounded border px-1.5 py-0.5 ${verdictTone}`}>
        {rule.verdict}
      </span>
      <span className="font-mono text-[11px] text-text-muted w-[60px]">{rule.method}</span>
      <span className="font-medium truncate">{rule.host}</span>
      <span className="font-mono text-[11px] text-text-muted truncate">{rule.pathPattern}</span>
      {sourceLabel && (
        <span
          title={`source: ${rule.source}`}
          className="text-[10px] text-text-muted rounded border border-border-light px-1.5 py-0.5"
        >
          {sourceLabel}
        </span>
      )}
      <span className="ml-auto text-[10px] text-text-muted hidden sm:block">
        by {rule.decidedBy.slice(0, 8)}
      </span>
      {!hideAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          title={pendingDelete ? "Undo delete" : "Revoke rule"}
          className="h-6 inline-flex items-center justify-center rounded border border-border-light text-text-muted hover:text-danger hover:border-danger px-1.5 disabled:opacity-40 transition-colors"
        >
          {pendingDelete ? <RotateCcw size={11} /> : <Trash2 size={11} />}
        </button>
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
  const verdictTone =
    add.verdict === "allow"
      ? "text-accent border-accent/40"
      : "text-danger border-danger/40";
  return (
    <li className="border-b border-border-light px-3 py-2 flex items-center gap-2 text-[12px] bg-accent-light/30">
      <span className={`uppercase tracking-wider text-[10px] rounded border px-1.5 py-0.5 ${verdictTone}`}>
        {add.verdict}
      </span>
      <span className="font-mono text-[11px] text-text-muted w-[60px]">{add.method}</span>
      <span className="font-medium truncate">{add.host}</span>
      <span className="font-mono text-[11px] text-text-muted truncate">{add.pathPattern}</span>
      <span className="text-[10px] text-accent rounded border border-accent/40 px-1.5 py-0.5">
        new
      </span>
      <span className="ml-auto" />
      <button
        type="button"
        onClick={onCancel}
        title="Discard pending rule"
        className="h-6 inline-flex items-center justify-center rounded border border-border-light text-text-muted hover:text-danger hover:border-danger px-1.5 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </li>
  );
}

/** Virtual row rendered when a preset switch or connection grant is staged
 *  but not yet saved. Mirrors the same allow/host/method/path columns as a
 *  real rule, with a "preview" badge and no actions — the user can't
 *  interact with these individually; they materialize on Save. */
interface PreviewRow {
  key: string;
  host: string;
  method: string;
  pathPattern: string;
  /** Renders in the source slot, e.g. "preset: trusted" or "from <name>". */
  sourceBadge: string;
}

function buildPresetPreviewRows(preset: EgressPreset, trustedHosts: readonly string[]): PreviewRow[] {
  if (preset === "none") return [];
  if (preset === "all") {
    return [{
      key: "preview:all",
      host: "*",
      method: "*",
      pathPattern: "*",
      sourceBadge: "preset: all",
    }];
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
    <li className="border-b border-border-light px-3 py-2 flex items-center gap-2 text-[12px] bg-accent-light/20">
      <span className="uppercase tracking-wider text-[10px] rounded border px-1.5 py-0.5 text-accent border-accent/40">
        allow
      </span>
      <span className="font-mono text-[11px] text-text-muted w-[60px]">{row.method}</span>
      <span className="font-medium truncate">{row.host}</span>
      <span className="font-mono text-[11px] text-text-muted truncate">{row.pathPattern}</span>
      <span
        title={`Preview — ${row.sourceBadge} (saved on commit)`}
        className="text-[10px] text-text-muted rounded border border-border-light px-1.5 py-0.5"
      >
        {row.sourceBadge}
      </span>
      <span
        className="text-[10px] text-accent rounded border border-accent/40 px-1.5 py-0.5"
        title="This rule will be saved on commit"
      >
        preview
      </span>
      <span className="ml-auto" />
      {/* No per-row actions in preview mode: the rules don't exist yet, so
          there's nothing to revoke. The user can change the dropdown
          selection or cancel the dialog to drop the preview. */}
    </li>
  );
}

function formatSource(source: EgressRuleView["source"]): string | null {
  if (source === "manual") return null;
  if (source === "inbox") return "from inbox";
  if (source === "preset:trusted") return "preset: trusted";
  if (source === "preset:all") return "preset: all";
  if (source.startsWith("connection:")) return `from ${source.slice("connection:".length)}`;
  return source;
}
