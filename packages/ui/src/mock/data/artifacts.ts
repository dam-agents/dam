/** Raw content returned by artifactLibrary.getContent */
export const artifactContents: Record<string, string> = {
  "art-1": `# Sprint 14 Retrospective

## What went well
- Shipped credential injection ahead of schedule
- Zero P0 incidents during the sprint
- Knowledge base indexing pipeline hit 99.7% uptime

## What could improve
- Experiment result notifications were delayed by ~2h due to queue backpressure
- Need better visibility into sandbox resource consumption

## Action items
- [ ] Add resource usage alerts per-sandbox (owner: @jamie)
- [ ] Investigate queue backpressure root cause (owner: @alex)
- [ ] Update runbook for KB reindex failures (owner: @sam)
`,
  "art-2": `#!/usr/bin/env python3
"""Data pipeline — pulls metrics from Prometheus, transforms, and pushes to warehouse."""

import asyncio
from datetime import datetime, timedelta

import httpx
import polars as pl


async def fetch_metrics(start: datetime, end: datetime) -> pl.DataFrame:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "http://prometheus:9090/api/v1/query_range",
            params={
                "query": 'sum(rate(container_cpu_usage_seconds_total[5m])) by (pod)',
                "start": start.isoformat(),
                "end": end.isoformat(),
                "step": "60s",
            },
        )
        resp.raise_for_status()
        data = resp.json()["data"]["result"]

    rows = []
    for series in data:
        pod = series["metric"]["pod"]
        for ts, val in series["values"]:
            rows.append({"pod": pod, "timestamp": ts, "cpu_rate": float(val)})
    return pl.DataFrame(rows)


async def main():
    end = datetime.utcnow()
    start = end - timedelta(hours=1)
    df = await fetch_metrics(start, end)
    df = df.with_columns(pl.col("timestamp").cast(pl.Datetime))
    print(f"Fetched {len(df)} rows across {df['pod'].n_unique()} pods")
    df.write_parquet("/data/metrics_hourly.parquet")


if __name__ == "__main__":
    asyncio.run(main())
`,
  "art-4": "# REST API Reference\n\n## Authentication\n\nAll requests require a Bearer token in the `Authorization` header.\n\n```\nAuthorization: Bearer <token>\n```\n\n## Endpoints\n\n### GET /api/agents\n\nList all agents in the organization.\n\n| Field | Type | Description |\n|-------|------|-------------|\n| id | string | Agent UUID |\n| name | string | Human-readable name |\n| state | enum | running, hibernated, error |\n| kind | string? | experiment, knowledge-base, or null |\n\n### POST /api/agents\n\nCreate a new agent sandbox.\n\n### GET /api/agents/:id/sessions\n\nList sessions for an agent.\n\n### POST /api/agents/:id/approve\n\nApprove a pending permission request.\n",
  "art-6": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-sandbox
  namespace: platform
  labels:
    app: agent-sandbox
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agent-sandbox
  template:
    metadata:
      labels:
        app: agent-sandbox
    spec:
      serviceAccountName: agent-sa
      containers:
        - name: harness
          image: ghcr.io/acme/platform-harness:latest
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "1000m"
          env:
            - name: AGENT_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.labels['agent-id']
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir:
            sizeLimit: 2Gi
`,
  "art-7": `# Sprint 13 Summary

**Duration:** Feb 12 – Feb 26, 2024
**Velocity:** 34 points (target: 32)

## Completed
- Network isolation policy engine (8pts)
- Schedule execution MVP — cron triggers (5pts)
- Artifact versioning backend (5pts)
- KB incremental reindex (8pts)
- UI: approval inbox redesign (5pts)
- Bug fixes & tech debt (3pts)

## Carried over
- Experiment comparison view (3pts) — blocked on design
`,
  "art-8": "import React from 'react';\n\ninterface ButtonProps {\n  variant?: 'primary' | 'secondary' | 'ghost';\n  size?: 'sm' | 'md' | 'lg';\n  children: React.ReactNode;\n  onClick?: () => void;\n  disabled?: boolean;\n}\n\nexport function Button({ variant = 'primary', size = 'md', children, onClick, disabled }: ButtonProps) {\n  return (\n    <button\n      className={`btn btn-${variant} btn-${size}`}\n      onClick={onClick}\n      disabled={disabled}\n    >\n      {children}\n    </button>\n  );\n}\n\ninterface CardProps {\n  title: string;\n  children: React.ReactNode;\n  actions?: React.ReactNode;\n}\n\nexport function Card({ title, children, actions }: CardProps) {\n  return (\n    <div className=\"card\">\n      <div className=\"card-header\">\n        <h3>{title}</h3>\n        {actions && <div className=\"card-actions\">{actions}</div>}\n      </div>\n      <div className=\"card-body\">{children}</div>\n    </div>\n  );\n}\n",
  "art-9": `[2024-03-13T22:01:14Z] ERROR agent=codex-research run=run-morning-sync: context deadline exceeded
[2024-03-13T22:01:14Z] ERROR agent=codex-research run=run-morning-sync: failed to fetch /repos/acme-org/my-repo/contents
[2024-03-13T21:45:02Z] WARN  agent=gemini-data-pipeline: memory usage at 95% of limit (486Mi/512Mi)
[2024-03-13T21:45:03Z] ERROR agent=gemini-data-pipeline run=run-data-pipeline: OOMKilled — container exceeded memory limit
[2024-03-13T20:12:44Z] ERROR agent=incident-postmortems: git-clone failed: SSH key expired
[2024-03-13T20:12:44Z] INFO  agent=incident-postmortems: last successful sync was 2024-03-11T18:00:00Z
[2024-03-13T19:30:01Z] WARN  agent=claude-code-main run=run-nightly-tests: test auth/session.test.ts FAILED
[2024-03-13T19:30:01Z] WARN  agent=claude-code-main run=run-nightly-tests: Expected token refresh to succeed
[2024-03-13T19:30:02Z] ERROR agent=claude-code-main run=run-nightly-tests: 3 of 142 tests failed
`,
  "art-12": "import React from 'react';\n\nconst variants = [\n  { name: 'baseline', accuracy: 78.4, latency: 1.2, cost: 0.42 },\n  { name: 'cot-v1', accuracy: 84.1, latency: 2.1, cost: 0.68 },\n  { name: 'cot-v2-concise', accuracy: 83.8, latency: 1.4, cost: 0.51 },\n  { name: 'few-shot-5', accuracy: 81.2, latency: 1.8, cost: 0.73 },\n];\n\nexport function VariantComparison() {\n  const winner = variants.reduce((a, b) => (a.accuracy / a.cost > b.accuracy / b.cost ? a : b));\n\n  return (\n    <div className=\"p-4\">\n      <h2 className=\"text-lg font-semibold mb-4\">Variant Comparison</h2>\n      <div className=\"space-y-2\">\n        {variants.map((v) => (\n          <div key={v.name} className={`flex items-center gap-4 p-3 rounded border ${v.name === winner.name ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>\n            <span className=\"font-medium w-32\">{v.name}</span>\n            <span className=\"text-sm\">Accuracy: {v.accuracy}%</span>\n            <span className=\"text-sm\">Latency: {v.latency}s</span>\n            <span className=\"text-sm\">Cost: ${v.cost}/1k</span>\n            {v.name === winner.name && <span className=\"ml-auto text-green-600 font-medium\">Best value</span>}\n          </div>\n        ))}\n      </div>\n    </div>\n  );\n}\n",
};

/** HTML previews returned by artifactLibrary.preview (for renderable kinds) */
export const artifactPreviews: Record<string, string> = {
  "art-3": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent Usage Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #fafafa; }
  h1 { font-size: 20px; margin-bottom: 24px; color: #1a1a1a; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; }
  .card h3 { font-size: 13px; color: #666; font-weight: 500; margin-bottom: 8px; }
  .card .big { font-size: 28px; font-weight: 700; color: #1a1a1a; }
</style>
</head>
<body>
  <h1>Agent Usage Dashboard</h1>
  <div class="grid">
    <div class="card"><h3>Total Sessions</h3><p class="big">1,247</p></div>
    <div class="card"><h3>Avg Duration</h3><p class="big">18m</p></div>
    <div class="card"><h3>Success Rate</h3><p class="big">94.2%</p></div>
  </div>
</body>
</html>`,
  "art-5": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authentication Flow</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background: white; }
</style>
</head>
<body>
<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:600px">
  <defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#333"/></marker></defs>
  <rect x="20" y="60" width="100" height="40" rx="6" fill="#e3f2fd" stroke="#1976d2" stroke-width="1.5"/>
  <text x="70" y="84" text-anchor="middle" font-size="13" fill="#1a1a1a">User</text>
  <rect x="220" y="60" width="120" height="40" rx="6" fill="#e3f2fd" stroke="#1976d2" stroke-width="1.5"/>
  <text x="280" y="84" text-anchor="middle" font-size="13" fill="#1a1a1a">API Gateway</text>
  <rect x="440" y="60" width="120" height="40" rx="6" fill="#e3f2fd" stroke="#1976d2" stroke-width="1.5"/>
  <text x="500" y="84" text-anchor="middle" font-size="13" fill="#1a1a1a">Keycloak</text>
  <line x1="120" y1="80" x2="218" y2="80" stroke="#333" stroke-width="1.5" marker-end="url(#arrow)"/>
  <line x1="340" y1="80" x2="438" y2="80" stroke="#333" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="170" y="72" text-anchor="middle" font-size="11" fill="#666">POST /login</text>
  <text x="390" y="72" text-anchor="middle" font-size="11" fill="#666">validate token</text>
  <line x1="438" y1="105" x2="340" y2="130" stroke="#333" stroke-width="1.5" stroke-dasharray="4" marker-end="url(#arrow)"/>
  <text x="390" y="125" text-anchor="middle" font-size="11" fill="#666">JWT</text>
  <line x1="218" y1="130" x2="120" y2="105" stroke="#333" stroke-width="1.5" stroke-dasharray="4" marker-end="url(#arrow)"/>
  <text x="170" y="125" text-anchor="middle" font-size="11" fill="#666">200 + token</text>
</svg>
</body>
</html>`,
  "art-11": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Prompt Tuning Results</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: white; }
  h1 { font-size: 18px; margin-bottom: 20px; color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
  th { background: #f8f8f8; font-weight: 600; color: #333; }
  .winner { background: #e8f5e9; }
  .check { color: #2e7d32; font-weight: bold; }
  p { margin-top: 16px; font-size: 14px; color: #444; }
  strong { color: #1a1a1a; }
</style>
</head>
<body>
<h1>Prompt Tuning v2 — Results</h1>
<table>
  <thead><tr><th>Variant</th><th>Accuracy</th><th>Latency (p50)</th><th>Cost/1k</th><th>Winner</th></tr></thead>
  <tbody>
    <tr><td>baseline</td><td>78.4%</td><td>1.2s</td><td>$0.42</td><td></td></tr>
    <tr><td>cot-v1</td><td>84.1%</td><td>2.1s</td><td>$0.68</td><td></td></tr>
    <tr class="winner"><td>cot-v2-concise</td><td>83.8%</td><td>1.4s</td><td>$0.51</td><td class="check">✓</td></tr>
    <tr><td>few-shot-5</td><td>81.2%</td><td>1.8s</td><td>$0.73</td><td></td></tr>
  </tbody>
</table>
<p><strong>Recommendation:</strong> cot-v2-concise — near-best accuracy with minimal latency/cost trade-off.</p>
</body>
</html>`,
};

export const artifactFolders = [
  {
    id: "folder-1",
    name: "Sprint Reports",
    createdAt: "2024-02-01T10:00:00.000Z",
    updatedAt: "2024-03-14T10:00:00.000Z",
  },
  {
    id: "folder-2",
    name: "API Documentation",
    createdAt: "2024-01-20T10:00:00.000Z",
    updatedAt: "2024-03-10T10:00:00.000Z",
  },
  {
    id: "folder-exp-1",
    name: "Experiments / Prompt Tuning v2",
    createdAt: "2024-03-01T10:00:00.000Z",
    updatedAt: "2024-03-13T10:00:00.000Z",
  },
];

const AGENT_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const AGENT_ID_2 = "a1b2c3d4-0002-4000-8000-000000000002";
const AGENT_ID_3 = "a1b2c3d4-0003-4000-8000-000000000003";
const AGENT_ID_KB = "a1b2c3d4-0004-4000-8000-000000000004";
const AGENT_ID_EXP = "a1b2c3d4-0005-4000-8000-000000000005";

// Recent timestamps (relative to "now" so they always appear as new)
const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

export const artifacts = [
  {
    id: "art-1",
    title: "Sprint 14 Retrospective",
    slug: "sprint-14-retro",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "sprint-14-retro.md",
    sizeBytes: 4200,
    version: 3,
    folderId: "folder-1",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 8,
    shareUrl: null,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
  },
  {
    id: "art-2",
    title: "Data Pipeline Script",
    slug: "data-pipeline",
    kind: "code",
    contentType: "text/plain",
    fileName: "pipeline.py",
    sizeBytes: 8100,
    version: 2,
    folderId: null,
    agentId: AGENT_ID_3,
    visibility: "public",
    expiresAt: null,
    viewCount: 12,
    shareUrl: "https://share.example.com/abc",
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
  },
  {
    id: "art-3",
    title: "Interactive Dashboard",
    slug: "interactive-dashboard",
    kind: "html",
    contentType: "text/html",
    fileName: "dashboard.html",
    sizeBytes: 24600,
    version: 5,
    folderId: null,
    agentId: AGENT_ID_KB,
    visibility: "public",
    expiresAt: null,
    viewCount: 47,
    shareUrl: "https://share.example.com/dash",
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
  },
  {
    id: "art-4",
    title: "REST API Reference",
    slug: "api-reference",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "api-reference.md",
    sizeBytes: 18400,
    version: 4,
    folderId: "folder-2",
    agentId: AGENT_ID,
    visibility: "public",
    expiresAt: null,
    viewCount: 31,
    shareUrl: "https://share.example.com/api-ref",
    createdAt: "2024-02-20T08:00:00.000Z",
    updatedAt: "2024-03-12T11:00:00.000Z",
  },
  {
    id: "art-5",
    title: "Authentication Flow Diagram",
    slug: "auth-flow",
    kind: "html",
    contentType: "text/html",
    fileName: "auth-flow.html",
    sizeBytes: 12300,
    version: 1,
    folderId: "folder-2",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: null,
    viewCount: 5,
    shareUrl: null,
    createdAt: "2024-03-05T09:00:00.000Z",
    updatedAt: "2024-03-05T09:00:00.000Z",
  },
  {
    id: "art-6",
    title: "Kubernetes Deploy Config",
    slug: "k8s-deploy",
    kind: "code",
    contentType: "text/yaml",
    fileName: "deploy.yaml",
    sizeBytes: 3200,
    version: 1,
    folderId: null,
    agentId: null,
    visibility: "private",
    expiresAt: null,
    viewCount: 2,
    shareUrl: null,
    createdAt: "2024-03-11T15:00:00.000Z",
    updatedAt: "2024-03-11T15:00:00.000Z",
  },
  {
    id: "art-7",
    title: "Sprint 13 Summary",
    slug: "sprint-13-summary",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "sprint-13.md",
    sizeBytes: 3800,
    version: 2,
    folderId: "folder-1",
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: "2024-02-01T00:00:00.000Z",
    viewCount: 15,
    shareUrl: null,
    createdAt: "2024-02-28T10:00:00.000Z",
    updatedAt: "2024-02-28T10:00:00.000Z",
  },
  {
    id: "art-8",
    title: "React Component Library",
    slug: "react-components",
    kind: "jsx",
    contentType: "text/jsx",
    fileName: "components.jsx",
    sizeBytes: 15700,
    version: 3,
    folderId: null,
    agentId: AGENT_ID,
    visibility: "public",
    expiresAt: null,
    viewCount: 22,
    shareUrl: "https://share.example.com/components",
    createdAt: "2024-03-02T11:00:00.000Z",
    updatedAt: "2024-03-14T08:00:00.000Z",
  },
  {
    id: "art-9",
    title: "Error Logs Export",
    slug: "error-logs",
    kind: "text",
    contentType: "text/plain",
    fileName: "errors-2024-03.log",
    sizeBytes: 52400,
    version: 1,
    folderId: null,
    agentId: AGENT_ID,
    visibility: "private",
    expiresAt: "2024-04-01T00:00:00.000Z",
    viewCount: 4,
    shareUrl: null,
    createdAt: "2024-03-13T22:00:00.000Z",
    updatedAt: "2024-03-13T22:00:00.000Z",
  },
  {
    id: "art-10",
    title: "Architecture Diagram",
    slug: "arch-diagram",
    kind: "binary",
    contentType: "image/png",
    fileName: "architecture.png",
    sizeBytes: 186000,
    version: 2,
    folderId: "folder-2",
    agentId: null,
    visibility: "public",
    expiresAt: null,
    viewCount: 19,
    shareUrl: "https://share.example.com/arch",
    createdAt: "2024-02-15T14:00:00.000Z",
    updatedAt: "2024-03-10T10:00:00.000Z",
  },
  {
    id: "art-11",
    title: "Prompt Tuning Results",
    slug: "prompt-results",
    kind: "html",
    contentType: "text/html",
    fileName: "results.html",
    sizeBytes: 9800,
    version: 1,
    folderId: "folder-exp-1",
    agentId: AGENT_ID_EXP,
    visibility: "private",
    expiresAt: null,
    viewCount: 6,
    shareUrl: null,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(4),
  },
  {
    id: "art-12",
    title: "Variant Comparison Chart",
    slug: "variant-comparison",
    kind: "jsx",
    contentType: "text/jsx",
    fileName: "comparison.jsx",
    sizeBytes: 6400,
    version: 2,
    folderId: "folder-exp-1",
    agentId: AGENT_ID_EXP,
    visibility: "private",
    expiresAt: null,
    viewCount: 3,
    shareUrl: null,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
  },
];
