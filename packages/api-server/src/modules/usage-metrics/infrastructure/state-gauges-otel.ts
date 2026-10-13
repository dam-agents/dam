import type { Meter } from "@opentelemetry/api";
import type { StateSnapshot } from "../domain/state-snapshot.js";

export function registerOtelStateGauges(
  meter: Meter,
  current: () => StateSnapshot | null,
): void {
  const agents = meter.createObservableGauge("platform.agents", {
    description: "Agents that exist, by harness and how they were made",
  });
  const slackWorkspaces = meter.createObservableGauge(
    "platform.slack.workspaces",
    { description: "Slack workspaces the platform is installed in" },
  );
  const sharedKnowledgeBases = meter.createObservableGauge(
    "platform.knowledge_bases.shared",
    { description: "Knowledge bases with an active share" },
  );
  const skillSets = meter.createObservableGauge("platform.skill_sets", {
    description: "Saved skill sets",
  });

  meter.addBatchObservableCallback(
    (result) => {
      const snapshot = current();
      if (!snapshot) return;
      for (const { harness, origin, count } of snapshot.agents)
        result.observe(agents, count, {
          "platform.agent.harness": harness,
          "platform.agent.origin": origin,
        });
      for (const { state, count } of snapshot.slackWorkspaces)
        result.observe(slackWorkspaces, count, {
          "platform.slack.credential_state": state,
        });
      result.observe(sharedKnowledgeBases, snapshot.sharedKnowledgeBases);
      result.observe(skillSets, snapshot.skillSets);
    },
    [agents, slackWorkspaces, sharedKnowledgeBases, skillSets],
  );
}
