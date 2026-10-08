export const CORE_FEATURES = [
  "starter_kit",
  "artifact",
  "scheduling",
  "slack_agent",
  "skills",
] as const;

export type CoreFeature = (typeof CORE_FEATURES)[number];

export type UserFact = { sub: string; firstSeenAt: Date };
export type ActiveDayFact = { sub: string; day: string };
export type FeatureFirstFact = {
  sub: string;
  feature: CoreFeature;
  firstAt: Date;
};
export type SlackSetupFact = { sub: string; firstAt: Date };
export type KitAgentFact = {
  agentId: string;
  sub: string;
  kitId: string;
  createdAt: Date;
  onboardedAt: Date | null;
  checklistStarted: boolean;
};
export type AgentCreatedFact = {
  agentId: string;
  ownerSub: string;
  createdAt: Date;
  kitId: string | null;
};
export type LiveAgentFact = {
  id: string;
  cpu: string | undefined;
  memory: string | undefined;
  hibernationTimeout: string | undefined;
  storageSize: string | undefined;
  grantedConnectionIds: ReadonlyArray<string>;
};
export type AgentSizing = {
  slot: { cpu: string; memory: string };
  defaultStorage: string;
  idleTimeoutMin: number;
};

export type AnalyticsFacts = {
  users: ReadonlyArray<UserFact>;
  activeDays: ReadonlyArray<ActiveDayFact>;
  featureFirsts: ReadonlyArray<FeatureFirstFact>;
  slackSetups: ReadonlyArray<SlackSetupFact>;
  kitAgents: ReadonlyArray<KitAgentFact>;
  agentsCreated: ReadonlyArray<AgentCreatedFact>;
  liveAgents: ReadonlyArray<LiveAgentFact>;
  oomAgentIds: ReadonlySet<string>;
  knowledgeBaseConnectionIds: ReadonlySet<string>;
  sizing: AgentSizing;
};

export type Tile = {
  value: number | null;
  previous: number | null;
  trend: Array<number | null>;
};

export type Share = { label: string; count: number };

export type CohortRow = {
  weekStart: string;
  size: number;
  counts: number[];
};

export type CohortPanel = {
  categories: string[];
  rows: CohortRow[];
};

export type WeeklySeries = { label: string; values: number[] };

export type FunnelStage = { label: string; count: number; base: number };

export type SizeRow = {
  size: "1x" | "2x" | "4x" | "custom";
  agents: number;
  alwaysOn: number;
  outOfMemory: number;
};

export type AnalyticsReport = {
  generatedAt: string;
  today: string;
  totalUsers: number;
  last7: {
    from: string;
    to: string;
    previousFrom: string;
    weeklyActive: Tile & { regular: number; super: number };
    weeklyAbandoned: Tile;
    longitudinallyActive: Tile & { eligible: number };
    agentsCreated: Tile & { fromKits: number; other: number };
    starterKitAdoption: Tile;
    onboardingConversion: Tile & { users: number };
  };
  onboarding: {
    cohortWeeks: string[];
    cohortSizes: number[];
    funnel: FunnelStage[];
    firstWeekActiveDays: CohortPanel;
    firstDayFeatureCount: CohortPanel;
    firstDayFeatureUse: Array<{ label: string; percents: number[] }>;
    firstDayStart: Share[];
    firstDayKits: Share[];
    firstDayKitUsers: number;
    slackSetup: CohortPanel;
    checklistCompletion: CohortPanel;
  };
  allUse: {
    weeks: string[];
    activity: WeeklySeries[];
    longitudinalWeeks: string[];
    longitudinal: WeeklySeries[];
    longitudinalEligible: number[];
    agentsCreated: { fromKits: number[]; other: number[] };
    agentsPerUser: Share[];
    featureAdoption: Share[];
    kitPopularity: Share[];
    checklistState: Share[];
  };
  agentsNow: {
    total: number;
    sizes: SizeRow[];
    disk: Share[];
    connections: Share[];
    knowledgeBases: Share[];
  };
};
