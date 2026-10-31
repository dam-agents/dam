import {
  UI_FLOW_STEPS,
  UI_FLOWS,
  type UiFlow,
  type UiFlowStep,
  type UiSignal,
} from "api-server-api";

export const UI_EVENTS_RETENTION_DAYS = 30;
export const UI_MIN_USERS = 3;
export const UI_TRAIL_LIMIT = 50;

export interface UiPeriod {
  from: Date;
  to: Date;
}

export interface UiBuildRow {
  version: string;
  firstSeen: Date;
  users: number;
}

export interface UiFeatureRow {
  route: string;
  element: string | null;
  users: number;
  uses: number;
}

export interface UiFrictionRow {
  signal: UiSignal;
  route: string;
  element: string | null;
  build: string;
  users: number;
  events: number;
  views: number;
  prevEvents: number;
  prevViews: number;
}

export interface UiFlowStepRow {
  flow: UiFlow;
  step: UiFlowStep;
  users: number;
  medianMsFromStart: number;
}

export interface UiTrailStep {
  kind: "view" | "action";
  route: string;
  element: string | null;
  dtMs: number;
}

export interface UiTrailRow {
  id: string;
  signal: UiSignal;
  route: string;
  element: string | null;
  build: string;
  users: number;
  steps: UiTrailStep[];
}

export interface UiSignalsFacts {
  builds: UiBuildRow[];
  features: UiFeatureRow[];
  friction: UiFrictionRow[];
  flowSteps: UiFlowStepRow[];
  trails: UiTrailRow[];
}

export interface UiSignalsReport {
  period: { from: string; to: string };
  builds: Array<{ version: string; firstSeen: string }>;
  features: UiFeatureRow[];
  friction: Array<{
    signal: UiSignal;
    route: string;
    element: string | null;
    build: string;
    users: number;
    events: number;
    views: number;
    rate: number;
    prevRate: number | null;
  }>;
  funnels: Array<{
    flow: UiFlow;
    steps: Array<{
      step: UiFlowStep;
      users: number;
      medianMsFromStart: number;
    }>;
  }>;
  trails: UiTrailRow[];
}

export function previousPeriod(period: UiPeriod): UiPeriod {
  const span = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - span), to: period.from };
}

const anonymous = <T extends { users: number }>(row: T) =>
  row.users >= UI_MIN_USERS;

const byUsersThenName =
  <T extends { users: number }>(name: (row: T) => string) =>
  (a: T, b: T) =>
    b.users - a.users || name(a).localeCompare(name(b));

export function buildUiSignalsReport(
  period: UiPeriod,
  facts: UiSignalsFacts,
): UiSignalsReport {
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    builds: facts.builds
      .filter(anonymous)
      .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime())
      .map((b) => ({
        version: b.version,
        firstSeen: b.firstSeen.toISOString(),
      })),
    features: facts.features
      .filter(anonymous)
      .sort(byUsersThenName((f) => `${f.route} ${f.element ?? ""}`)),
    friction: facts.friction
      .filter(anonymous)
      .map(({ prevEvents, prevViews, ...row }) => ({
        ...row,
        rate: row.events / Math.max(row.views, 1),
        prevRate: prevViews > 0 ? prevEvents / prevViews : null,
      }))
      .sort((a, b) => b.rate - a.rate || b.users - a.users),
    funnels: UI_FLOWS.flatMap((flow) => {
      const steps = UI_FLOW_STEPS.flatMap((step) =>
        facts.flowSteps
          .filter((r) => r.flow === flow && r.step === step && anonymous(r))
          .map(({ users, medianMsFromStart }) => ({
            step,
            users,
            medianMsFromStart,
          })),
      );
      return steps.length > 0 ? [{ flow, steps }] : [];
    }),
    trails: facts.trails
      .filter(anonymous)
      .sort(byUsersThenName((t) => t.id))
      .slice(0, UI_TRAIL_LIMIT),
  };
}
