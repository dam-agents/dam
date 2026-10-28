import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

export function environmentMockupTranscript(): Message[] {
  return [
    msg("env-1", "user", [
      {
        kind: "text",
        text: "Make a small reports app with a backend that serves a CSV download. Then create an environment for it so I can share it. Share it with only me.",
      },
    ]),
    msg("env-2", "assistant", [
      {
        kind: "tool",
        toolCallId: "env-t1",
        title: "Create ~/work/reports-app/server.js",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t2",
        title: "Create ~/work/reports-app/index.html",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t3",
        title: "Create ~/work/reports-app/app.js",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t4",
        title: "Create ~/work/reports-app/styles.css",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t5",
        title: "Create ~/work/reports-app/package.json",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t6",
        title: "Run npm start",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t7",
        title: "Run curl localhost:4444/healthz",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t8",
        title: "Run curl -I localhost:4444/reports.csv",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t9",
        title: "Run git add -A && git commit -m 'init reports app'",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t10",
        title: "Create environment reports",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t11",
        title: "Run ssh env-reports -- rc-service reports-app start",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t12",
        title:
          "Run curl -s -o /dev/null -w '%{http_code}' https://app-reports-f89197.env-dam-dev.apps.dam-cl.fmaas.res.ibm.com/healthz",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "env-t13",
        title: "Set environment access to owner-only",
        status: "failed",
      },
      {
        kind: "text",
        text: `Built and deployed.

**The app** — \`~/work/reports-app\`, committed on main as \`3385554\`:

| File | Role |
|---|---|
| \`server.js\` | dependency-free \`node:http\`: \`/\`, \`/api/reports\`, \`/reports.csv\`, \`/healthz\` |
| \`index.html\` / \`app.js\` / \`styles.css\` | table, totals, "Download CSV" link |
| \`package.json\`, \`README.md\`, \`.gitignore\` | \`npm start\`, docs |

CSV is rendered server-side, so \`GET /reports.csv\` works with no JS at all — verified \`Content-Type: text/csv\`, \`Content-Disposition: attachment; filename="reports-2026-10-27.csv"\`, 7 lines including header, and \`/healthz\` → \`ok\`.

**The environment** — reports, running:

- **URL:** \`app-reports-f89197.env-dam-dev.apps.dam-cl.fmaas.res.ibm.com\`
- endpoint \`app\` → port 4444, start command \`PORT=4444 HOST=0.0.0.0 node reports-app/server.js\` as an openrc Startup Item (verified started; it restarts on exit and at every boot)
- expires 2026-11-03; code at \`~/work/reports-app\` inside it, deployed over \`ssh env-reports\`
- behind the platform's share sign-in: an anonymous request gets \`401 Unauthorized\` from the auth gate, so nothing is public

Two things to note:

1. **"Only me" is the default**, not a narrowed list. I tried to set access to your address and the platform refused — "not on your owner's list of people. Only your owner adds people, in the app." So the environment carries \`access: null\`, meaning the owner's default people list. Since that list evidently contains no one else, only you can open it. If others should be excluded explicitly, add yourself under people in the app, then tell me the address and I'll pin access to just it.
2. **Sign-in is required** — the panel will show the platform sign-in page first. Sign in there and the report page loads; the "Download CSV" button then hits \`/reports.csv\` directly.

Want me to pin the access list, extend the expiry, or add a \`/healthz\` probe to the environment's checks?`,
      },
      {
        kind: "work",
        tool: "environment",
        status: "running",
        name: "reports",
        url: "https://app-reports-f89197.env-dam-dev.apps.dam-cl.fmaas.res.ibm.com",
        expiresAt: sevenDays,
        accessLabel: "Only you",
        items: [
          { label: "Endpoint", value: "app → port 4444" },
          {
            label: "Start command",
            value: "PORT=4444 HOST=0.0.0.0 node reports-app/server.js",
          },
          { label: "Commit", value: "3385554 (main)" },
        ],
      },
    ]),
  ];
}
