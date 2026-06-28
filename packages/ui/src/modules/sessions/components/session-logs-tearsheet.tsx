import { Close } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import { Modal } from "../../../components/modal.js";

interface LogEntry {
  id: string;
  ts: string;
  type: string;
  payload: object;
}

const badgeStyle: Record<string, string> = {
  text: "bg-background text-muted-foreground border-border",
  tool: "bg-primary/10 text-primary border-primary",
  done: "bg-success-light text-success border-success",
  error: "bg-destructive/10 text-destructive border-destructive",
  prompt: "bg-info-light text-info border-info",
  session: "bg-background text-muted-foreground border-border",
  thought: "bg-muted text-muted-foreground border-border",
  image: "bg-primary/10 text-primary border-primary",
};

const MOCK_LOGS: LogEntry[] = [
  {
    id: "log-001",
    ts: "09:00:01.234",
    type: "session",
    payload: { event: "session_start", sessionId: "sess-001" },
  },
  {
    id: "log-002",
    ts: "09:00:01.456",
    type: "prompt",
    payload: {
      text: "Refactor the auth module to use JWT tokens instead of session cookies",
    },
  },
  {
    id: "log-003",
    ts: "09:00:02.012",
    type: "thought",
    payload: {
      text: "I need to identify the current auth implementation, find all session-cookie references, and replace them with JWT logic.",
    },
  },
  {
    id: "log-004",
    ts: "09:00:03.789",
    type: "tool",
    payload: { tool: "code_search", query: "session cookie auth", results: 12 },
  },
  {
    id: "log-005",
    ts: "09:00:05.123",
    type: "tool",
    payload: { tool: "file_read", path: "src/middleware/auth.ts", lines: 142 },
  },
  {
    id: "log-006",
    ts: "09:00:06.456",
    type: "text",
    payload: {
      text: "Found the auth middleware at src/middleware/auth.ts. It currently uses express-session with a Redis store.",
    },
  },
  {
    id: "log-007",
    ts: "09:00:08.234",
    type: "tool",
    payload: {
      tool: "file_write",
      path: "src/middleware/auth.ts",
      bytesWritten: 2048,
    },
  },
  {
    id: "log-008",
    ts: "09:00:09.567",
    type: "tool",
    payload: { tool: "file_write", path: "src/lib/jwt.ts", bytesWritten: 1024 },
  },
  {
    id: "log-009",
    ts: "09:00:11.890",
    type: "tool",
    payload: {
      tool: "terminal",
      command: "npm test -- --grep auth",
      exitCode: 0,
    },
  },
  {
    id: "log-010",
    ts: "09:00:14.123",
    type: "done",
    payload: { tokensUsed: 4521, duration: "12.9s" },
  },
  {
    id: "log-011",
    ts: "09:15:22.001",
    type: "prompt",
    payload: { text: "Now add refresh token rotation" },
  },
  {
    id: "log-012",
    ts: "09:15:23.234",
    type: "thought",
    payload: {
      text: "Refresh token rotation requires storing token families and invalidating the entire family if a reuse is detected.",
    },
  },
  {
    id: "log-013",
    ts: "09:15:25.456",
    type: "tool",
    payload: {
      tool: "file_write",
      path: "src/lib/refresh-tokens.ts",
      bytesWritten: 1536,
    },
  },
  {
    id: "log-014",
    ts: "09:15:27.789",
    type: "tool",
    payload: { tool: "terminal", command: "npm test", exitCode: 1 },
  },
  {
    id: "log-015",
    ts: "09:15:28.012",
    type: "error",
    payload: {
      message: "Test failed: token rotation test — expected 401, got 200",
    },
  },
  {
    id: "log-016",
    ts: "09:15:30.345",
    type: "tool",
    payload: {
      tool: "file_write",
      path: "src/lib/refresh-tokens.ts",
      bytesWritten: 1792,
    },
  },
  {
    id: "log-017",
    ts: "09:15:32.678",
    type: "tool",
    payload: { tool: "terminal", command: "npm test", exitCode: 0 },
  },
  {
    id: "log-018",
    ts: "09:15:33.901",
    type: "done",
    payload: { tokensUsed: 3102, duration: "11.9s" },
  },
];

export function SessionLogsTearsheet({
  sessionTitle,
  onClose,
}: {
  sessionTitle: string;
  onClose: () => void;
}) {
  return (
    <Modal widthClass="w-[90vw] max-w-[900px]">
      <div className="flex flex-col h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[15px] font-semibold text-foreground truncate">
              Logs
            </span>
            <span className="text-[13px] text-muted-foreground truncate">
              {sessionTitle}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors p-1.5 rounded-md"
          >
            <Close size={16} />
          </button>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto">
          {MOCK_LOGS.length === 0 && (
            <p className="px-6 py-8 text-[12px] text-muted-foreground">
              No events yet
            </p>
          )}
          {MOCK_LOGS.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-col gap-1 border-b border-border/50 px-6 py-3 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                  {entry.ts}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-bold uppercase tracking-[0.05em] border rounded-full px-2 py-0.5 ${badgeStyle[entry.type] ?? "bg-background text-muted-foreground border-border"}`}
                >
                  {entry.type}
                </Badge>
              </div>
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-[1.5] max-h-[100px] overflow-y-auto">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
