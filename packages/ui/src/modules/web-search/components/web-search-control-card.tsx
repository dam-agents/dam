import {
  WEB_SEARCH_HARNESSES_COVERED,
  WEB_SEARCH_HARNESSES_NOT_COVERED,
} from "api-server-api";

import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleRow } from "@/components/ui/toggle-row";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { confirmWebSearchControlRestart } from "../../egress-rules/gateway-restart.js";
import {
  useSetWebSearchControl,
  useSetWebSearchRule,
} from "../api/mutations.js";
import { useWebSearchState } from "../api/queries.js";
import {
  ruleChoiceOf,
  verdictOfChoice,
  WEB_SEARCH_RULE_CHOICES,
} from "../lib/rule-choice.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's Web search control in its network settings: the switch that makes its gateway hold every web search for the owner, which restarts the gateway and so asks first, and the agent's one web search rule, which answers every search without asking once the switch is on. The rule shows while the switch is off too when one is stored, and turning the switch on names it, because a stored rule answers in place of the hold the switch promises. The text names which harnesses the control covers, because Codex's hosted search never reaches the gateway as a request of its own, and says that Claude Code stops asking about a search while the switch is on, because the chat's Tool approval no longer decides it.
 */
export function WebSearchControlCard({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const setControl = useSetWebSearchControl();
  const setRule = useSetWebSearchRule();
  const { data: state, isPending: stateLoading } = useWebSearchState(agent.id);
  const editable = holds(agent.access, "egressRules");
  const on =
    (setControl.isPending
      ? setControl.variables.webSearchControl
      : undefined) ?? agent.webSearchControl;
  const choice = ruleChoiceOf(state?.rule?.verdict);
  const chosen = WEB_SEARCH_RULE_CHOICES.find((c) => c.value === choice);
  const storedRule = state?.rule ? chosen : undefined;

  const toggle = async (next: boolean) => {
    if (
      !(await confirmWebSearchControlRestart(
        showConfirm,
        next,
        storedRule?.label,
      ))
    )
      return;
    setControl.mutate({ id: agent.id, webSearchControl: next });
  };

  return (
    <section
      data-testid="web-search-control"
      className="mt-8 flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-2.5"
    >
      <ToggleRow
        className="w-full gap-3"
        title="Web search control"
        description={
          <>
            Hold each web search the agent&apos;s model makes for your approval,
            in the chat and on Home, before it runs. Covers{" "}
            {WEB_SEARCH_HARNESSES_COVERED}. Does not cover{" "}
            {WEB_SEARCH_HARNESSES_NOT_COVERED}. While this is on, Claude Code
            does not ask about a web search itself, whatever the chat&apos;s
            Tool approval. Other tools still follow Tool approval.
          </>
        }
        control={
          <Switch
            className="mt-0.5"
            checked={on}
            disabled={!editable || setControl.isPending || stateLoading}
            onCheckedChange={(next) => void toggle(next)}
            label="Web search control"
          />
        }
      />
      {(on || storedRule) && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`web-search-rule-${agent.id}`}
            className="text-sm font-medium text-foreground"
          >
            When the agent searches
          </label>
          <div className="max-w-60">
            <Select
              id={`web-search-rule-${agent.id}`}
              size="sm"
              value={choice}
              disabled={!editable || setRule.isPending || state === undefined}
              onChange={(event) => {
                const picked = WEB_SEARCH_RULE_CHOICES.find(
                  (c) => c.value === event.target.value,
                );
                if (picked)
                  setRule.mutate({
                    agentId: agent.id,
                    verdict: verdictOfChoice(picked.value),
                  });
              }}
            >
              {WEB_SEARCH_RULE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">
            {!on && "Applies once web search control is on. "}
            {chosen?.hint}
            {state?.rule &&
              ` Set by ${state.rule.decidedByEmail ?? state.rule.decidedBy}.`}
          </p>
        </div>
      )}
    </section>
  );
}
