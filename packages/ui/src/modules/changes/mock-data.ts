import type { ChangeSet, ChangeSetDiff, FileDiff } from "./types.js";

const PLATFORM_REPO = {
  id: "repo-platform",
  name: "platform",
  root: "/home/user/platform",
};

const DOCS_REPO = {
  id: "repo-docs",
  name: "docs",
  root: "/home/user/docs",
};

const MONOREPO = {
  id: "repo-monorepo",
  name: "acme-monorepo",
  root: "/home/user/acme-monorepo",
};

export const MOCK_CHANGE_SETS: ChangeSet[] = [
  {
    path: "/home/user/platform",
    repository: PLATFORM_REPO,
    branch: "fix/csv-export",
    baseRef: "main",
    stat: { files: 3, additions: 34, deletions: 6 },
    commitsAhead: 2,
    uncommitted: false,
    pullRequest: {
      number: 142,
      url: "https://github.com/acme/platform/pull/142",
      state: "pending",
    },
    sessionEditedAt: "2026-10-30T14:32:00Z",
    readError: null,
  },
  {
    path: "/home/user/platform-fix",
    repository: { ...PLATFORM_REPO, root: "/home/user/platform-fix" },
    branch: "feat/dashboard-charts",
    baseRef: "main",
    stat: { files: 7, additions: 156, deletions: 42 },
    commitsAhead: 5,
    uncommitted: true,
    pullRequest: null,
    sessionEditedAt: null,
    readError: null,
  },
  {
    path: "/home/user/docs",
    repository: DOCS_REPO,
    branch: "main",
    baseRef: "main",
    stat: { files: 0, additions: 0, deletions: 0 },
    commitsAhead: 0,
    uncommitted: false,
    pullRequest: null,
    sessionEditedAt: null,
    readError: null,
  },
  {
    path: "/home/user/acme-monorepo",
    repository: MONOREPO,
    branch: "feat/auth-refactor",
    baseRef: "main",
    stat: { files: 60, additions: 1842, deletions: 567 },
    commitsAhead: 14,
    uncommitted: true,
    pullRequest: {
      number: 387,
      url: "https://github.com/acme/monorepo/pull/387",
      state: "changes-requested",
    },
    sessionEditedAt: "2026-10-30T16:05:00Z",
    readError: null,
  },
];

const CSV_EXPORT_PATCH = `@@ -12,8 +12,14 @@
 import { formatRow } from "./format";
 import { escapeField } from "./escape";

-function buildCsvRow(columns: string[], row: Record<string, unknown>) {
-  return columns.map((col) => String(row[col] ?? "")).join(",");
+function buildCsvRow(columns: string[], row: Record<string, unknown>): string {
+  return columns
+    .map((col) => {
+      const value = String(row[col] ?? "");
+      return escapeField(value);
+    })
+    .join(",");
 }

 export function exportToCsv(`;

const CSV_ESCAPE_PATCH = `@@ -1,6 +1,12 @@
-export function escapeField(value: string) {
-  return value;
+export function escapeField(value: string): string {
+  if (
+    value.includes(",") ||
+    value.includes('"') ||
+    value.includes("\\n")
+  ) {
+    return \`"\${value.replace(/"/g, '""')}"\`;
+  }
+  return value;
 }`;

const CSV_TEST_PATCH = `@@ -8,6 +8,16 @@ describe("escapeField", () => {
   it("returns plain values unchanged", () => {
     expect(escapeField("hello")).toBe("hello");
   });
+
+  it("wraps values containing commas", () => {
+    expect(escapeField("a,b")).toBe('"a,b"');
+  });
+
+  it("escapes double quotes", () => {
+    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
+  });
+
+  it("wraps values with newlines", () => {
+    expect(escapeField("line1\\nline2")).toBe('"line1\\nline2"');
+  });
 });`;

const DASHBOARD_FILES: FileDiff[] = [
  {
    path: "src/components/dashboard/chart-card.tsx",
    oldPath: null,
    status: "added",
    additions: 48,
    deletions: 0,
    binary: false,
    uncommitted: false,
    patch: `@@ -0,0 +1,48 @@
+import { Card } from "../ui/card";
+import { BarChart } from "./bar-chart";
+
+interface ChartCardProps {
+  title: string;
+  data: number[];
+  labels: string[];
+}
+
+export function ChartCard({ title, data, labels }: ChartCardProps) {
+  return (
+    <Card className="p-4">
+      <h3 className="text-sm font-medium">{title}</h3>
+      <BarChart data={data} labels={labels} />
+    </Card>
+  );
+}`,
  },
  {
    path: "src/components/dashboard/bar-chart.tsx",
    oldPath: null,
    status: "added",
    additions: 62,
    deletions: 0,
    binary: false,
    uncommitted: true,
    patch: null,
  },
  {
    path: "src/components/dashboard/index.ts",
    oldPath: null,
    status: "modified",
    additions: 2,
    deletions: 0,
    binary: false,
    uncommitted: false,
    patch: `@@ -1,3 +1,5 @@
 export { Dashboard } from "./dashboard";
+export { ChartCard } from "./chart-card";
+export { BarChart } from "./bar-chart";`,
  },
  {
    path: "src/pages/dashboard.tsx",
    oldPath: null,
    status: "modified",
    additions: 18,
    deletions: 4,
    binary: false,
    uncommitted: true,
    patch: `@@ -1,8 +1,22 @@
 import { Layout } from "../components/layout";
-import { Dashboard } from "../components/dashboard";
+import { Dashboard, ChartCard } from "../components/dashboard";
+import { useMetrics } from "../hooks/use-metrics";

 export function DashboardPage() {
-  return <Layout><Dashboard /></Layout>;
+  const { metrics, labels } = useMetrics();
+
+  return (
+    <Layout>
+      <Dashboard />
+      <div className="mt-6 grid grid-cols-2 gap-4">
+        <ChartCard title="Revenue" data={metrics.revenue} labels={labels} />
+        <ChartCard title="Users" data={metrics.users} labels={labels} />
+      </div>
+    </Layout>
+  );
 }`,
  },
  {
    path: "src/hooks/use-metrics.ts",
    oldPath: null,
    status: "added",
    additions: 22,
    deletions: 0,
    binary: false,
    uncommitted: false,
    patch: null,
  },
  {
    path: "public/chart-placeholder.png",
    oldPath: null,
    status: "added",
    additions: 0,
    deletions: 0,
    binary: true,
    uncommitted: false,
    patch: null,
  },
  {
    path: "src/styles/charts.css",
    oldPath: null,
    status: "added",
    additions: 4,
    deletions: 0,
    binary: false,
    uncommitted: false,
    patch: `@@ -0,0 +1,4 @@
+.chart-container {
+  min-height: 200px;
+  position: relative;
+}`,
  },
];

const AUTH_DIRS = [
  "packages/auth/src",
  "packages/auth/src/middleware",
  "packages/auth/src/providers",
  "packages/auth/src/session",
  "packages/auth/src/tokens",
  "packages/auth/src/__tests__",
  "packages/api/src/routes/auth",
  "packages/api/src/routes/users",
  "packages/ui/src/modules/auth",
  "packages/ui/src/modules/auth/components",
  "packages/ui/src/modules/auth/hooks",
  "packages/ui/src/modules/settings/components",
  "packages/shared/src/types",
  "packages/shared/src/validators",
  "packages/e2e/tests/auth",
  "deploy/helm/platform/templates",
];

const AUTH_FILENAMES = [
  "index.ts",
  "types.ts",
  "middleware.ts",
  "session-store.ts",
  "token-manager.ts",
  "refresh-handler.ts",
  "oauth-callback.ts",
  "saml-provider.ts",
  "oidc-provider.ts",
  "password-policy.ts",
  "mfa-controller.ts",
  "login-form.tsx",
  "signup-form.tsx",
  "reset-password.tsx",
  "use-auth.ts",
  "use-session.ts",
  "auth-guard.tsx",
  "role-gate.tsx",
  "session-schema.ts",
  "user-schema.ts",
  "auth-validators.ts",
  "login.spec.ts",
  "signup.spec.ts",
  "mfa.spec.ts",
  "session.spec.ts",
  "token-refresh.spec.ts",
  "configmap.yaml",
];

const STATUSES: FileDiff["status"][] = [
  "modified",
  "added",
  "modified",
  "modified",
  "deleted",
  "modified",
  "added",
  "renamed",
];

function generateAuthFiles(): FileDiff[] {
  const files: FileDiff[] = [];
  let i = 0;
  for (const dir of AUTH_DIRS) {
    for (const name of AUTH_FILENAMES.slice(0, 4)) {
      if (files.length >= 60) break;
      const status = STATUSES[i % STATUSES.length]!;
      const adds = status === "deleted" ? 0 : 10 + ((i * 7) % 50);
      const dels = status === "added" ? 0 : 2 + ((i * 3) % 20);
      files.push({
        path: `${dir}/${name}`,
        oldPath: status === "renamed" ? `${dir}/old-${name}` : null,
        status,
        additions: adds,
        deletions: dels,
        binary: false,
        uncommitted: i % 5 === 0,
        patch: null,
      });
      i++;
    }
  }
  return files;
}

export const MOCK_DIFFS: Record<string, ChangeSetDiff> = {
  "/home/user/platform": {
    path: "/home/user/platform",
    compare: "base",
    baseRef: "main",
    files: [
      {
        path: "src/reports/csv-export.ts",
        oldPath: null,
        status: "modified",
        additions: 14,
        deletions: 4,
        binary: false,
        uncommitted: false,
        patch: CSV_EXPORT_PATCH,
      },
      {
        path: "src/reports/escape.ts",
        oldPath: null,
        status: "modified",
        additions: 8,
        deletions: 2,
        binary: false,
        uncommitted: false,
        patch: CSV_ESCAPE_PATCH,
      },
      {
        path: "src/reports/__tests__/escape.test.ts",
        oldPath: null,
        status: "modified",
        additions: 12,
        deletions: 0,
        binary: false,
        uncommitted: false,
        patch: CSV_TEST_PATCH,
      },
    ],
    truncated: false,
  },
  "/home/user/platform-fix": {
    path: "/home/user/platform-fix",
    compare: "base",
    baseRef: "main",
    files: DASHBOARD_FILES,
    truncated: false,
  },
  "/home/user/docs": {
    path: "/home/user/docs",
    compare: "base",
    baseRef: "main",
    files: [],
    truncated: false,
  },
  "/home/user/acme-monorepo": {
    path: "/home/user/acme-monorepo",
    compare: "base",
    baseRef: "main",
    files: generateAuthFiles(),
    truncated: false,
  },
};
