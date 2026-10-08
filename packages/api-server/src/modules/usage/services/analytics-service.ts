import {
  buildAnalyticsReport,
  OUT_OF_MEMORY_WINDOW_DAYS,
} from "../domain/build-analytics-report.js";
import type {
  AgentSizing,
  AnalyticsReport,
  LiveAgentFact,
} from "../domain/analytics-report.js";
import type { AnalyticsRepository } from "../infrastructure/analytics-repository.js";

export type AnalyticsServiceDeps = {
  repo: AnalyticsRepository;
  listLiveAgents: () => Promise<LiveAgentFact[]>;
  sizing: AgentSizing;
  now?: () => Date;
};

export type AnalyticsService = {
  report(): Promise<AnalyticsReport>;
};

export function createAnalyticsService(
  deps: AnalyticsServiceDeps,
): AnalyticsService {
  return {
    async report() {
      const [
        users,
        activeDays,
        featureFirsts,
        slackSetups,
        kitAgents,
        agentsCreated,
        oomAgentIds,
        knowledgeBaseConnectionIds,
        liveAgents,
      ] = await Promise.all([
        deps.repo.users(),
        deps.repo.activeDays(),
        deps.repo.featureFirsts(),
        deps.repo.slackSetups(),
        deps.repo.kitAgents(),
        deps.repo.agentsCreated(),
        deps.repo.outOfMemoryAgentIds(OUT_OF_MEMORY_WINDOW_DAYS),
        deps.repo.knowledgeBaseConnectionIds(),
        deps.listLiveAgents(),
      ]);
      return buildAnalyticsReport(
        {
          users,
          activeDays,
          featureFirsts,
          slackSetups,
          kitAgents,
          agentsCreated,
          liveAgents,
          oomAgentIds,
          knowledgeBaseConnectionIds,
          sizing: deps.sizing,
        },
        (deps.now ?? (() => new Date()))(),
      );
    },
  };
}
