import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;
const hr = 60 * min;
const day = 24 * hr;

const sessionTitles = [
  "Design review for checkout flow redesign",
  "User research synthesis — Q3 interviews",
  "Sprint planning — mobile team",
  "Competitive analysis of onboarding patterns",
  "Finalize pricing page copy and layout",
  "Accessibility audit for dashboard components",
  "Write PRD for notifications feature",
  "Prototype search and filter patterns",
  "Customer journey map — enterprise tier",
  "A/B test results for signup form variants",
  "Update design system color tokens",
  "Review analytics for feature adoption",
  "Stakeholder presentation — Q4 roadmap",
  "Persona update based on new survey data",
  "Heuristic evaluation of settings flow",
  "Draft release notes for v3.0 launch",
  "Information architecture for help center",
  "Usability test script — billing flow",
  "Design QA for dark mode components",
  "Weekly product sync — growth team",
  "Map user flows for team onboarding",
  "Prioritize backlog items for next sprint",
  "Create wireframes for reporting dashboard",
  "Review NPS feedback and tag themes",
  "Define success metrics for new search",
  "Update component library documentation",
  "Analyze funnel drop-off in trial signup",
  "Design handoff notes for profile page",
  "Content strategy for empty states",
  "Benchmark load times against competitors",
  "Plan beta launch for collaboration features",
  "Interview debrief — power user segment",
  "Audit notification preferences UX",
  "Spec out keyboard shortcuts for power users",
  "Review support tickets for UX patterns",
  "Design token migration to new naming scheme",
  "Mockup variants for mobile navigation",
  "Write acceptance criteria for file upload",
  "Localization review for date formats",
  "Gather feedback on new sidebar layout",
  "Plan research sessions for Q4 features",
  "Map integration touchpoints for Slack connect",
  "Evaluate icon set for consistency",
  "Draft microcopy for error messages",
  "Analyze session recordings for friction points",
  "Scope MVP for team permissions feature",
  "Review brand guidelines for marketing pages",
  "Prototype drag-and-drop reordering",
  "Create storyboard for onboarding tutorial",
  "Define edge cases for bulk actions flow",
  "Compile insights from customer advisory board",
  "Design system spacing scale proposal",
  "Review competitor pricing and packaging",
  "Test color contrast ratios for WCAG AA",
  "Write user story for scheduled reports",
  "Prepare demo for investor product review",
  "Catalog reusable patterns across product",
  "Plan migration path for legacy dashboard",
  "Outline strategy for self-serve analytics",
  "Compile feature requests from sales team",
];

const slackChannels = [
  "code-review",
  "incidents",
  "deployments",
  "api-docs",
  "engineering",
  "platform-alerts",
  "security",
];

function generateSessions(
  agentId: string,
  count: number,
  options?: {
    runningCount?: number;
    slackRatio?: number;
    scheduleRatio?: number;
  },
) {
  const {
    runningCount = 1,
    slackRatio = 0.2,
    scheduleRatio = 0.15,
  } = options ?? {};
  const sessions = [];

  for (let i = 0; i < count; i++) {
    const ageMs =
      i < 3 ? i * 30 * min : (i - 2) * 4 * hr + Math.random() * 2 * hr;
    const isRunning = i < runningCount;
    const isSlack = !isRunning && Math.random() < slackRatio;
    const isSchedule = !isRunning && !isSlack && Math.random() < scheduleRatio;
    const isUnread = !isRunning && i < 6 && Math.random() < 0.5;

    const createdAt = new Date(now - ageMs - 30 * min).toISOString();
    const updatedAt = new Date(now - ageMs).toISOString();
    const seenAt =
      isRunning || isUnread
        ? new Date(now - ageMs - hr).toISOString()
        : new Date(now - ageMs + 10 * min).toISOString();

    sessions.push({
      sessionId: `sess-${agentId.slice(-4)}-${String(i).padStart(3, "0")}`,
      agentId,
      type: isSlack
        ? ("channel_slack" as const)
        : isSchedule
          ? ("schedule_cron" as const)
          : ("regular" as const),
      mode: "chat" as const,
      createdAt,
      updatedAt,
      title: sessionTitles[i % sessionTitles.length],
      running: isRunning,
      seenAt,
      ...(isSlack
        ? {
            threadTs: `17258${String(i).padStart(5, "0")}.000${i}`,
            slackChannel: slackChannels[i % slackChannels.length],
          }
        : {}),
      ...(isSchedule
        ? { scheduleId: `sched-${String(i).padStart(3, "0")}` }
        : {}),
    });
  }

  return sessions;
}

export const mockSessions: Record<string, unknown[]> = {
  [AGENT_IDS.codexResearch]: generateSessions(AGENT_IDS.codexResearch, 55, {
    runningCount: 2,
    slackRatio: 0.1,
    scheduleRatio: 0.25,
  }),
  [AGENT_IDS.claudeCodeMain]: generateSessions(AGENT_IDS.claudeCodeMain, 58, {
    runningCount: 1,
    slackRatio: 0.35,
    scheduleRatio: 0.05,
  }),
  [AGENT_IDS.geminiPipeline]: generateSessions(AGENT_IDS.geminiPipeline, 50, {
    runningCount: 0,
    slackRatio: 0.15,
    scheduleRatio: 0.1,
  }),
  [AGENT_IDS.knowledgeBase]: generateSessions(AGENT_IDS.knowledgeBase, 50, {
    runningCount: 0,
    slackRatio: 0.3,
    scheduleRatio: 0.2,
  }),
  [AGENT_IDS.experiment1]: generateSessions(AGENT_IDS.experiment1, 40, {
    runningCount: 0,
    slackRatio: 0.1,
    scheduleRatio: 0.3,
  }),
  [AGENT_IDS.experiment2]: generateSessions(AGENT_IDS.experiment2, 35, {
    runningCount: 0,
    slackRatio: 0.1,
    scheduleRatio: 0.2,
  }),
  [AGENT_IDS.knowledgeBase2]: generateSessions(AGENT_IDS.knowledgeBase2, 30, {
    runningCount: 0,
    slackRatio: 0.2,
    scheduleRatio: 0.15,
  }),
};
