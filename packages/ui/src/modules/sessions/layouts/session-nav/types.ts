import type { SessionView } from "api-server-api";

import type { PendingPermission } from "../../../../store.js";

export interface SessionNavProps {
  sessions: SessionView[];
  activeSessionId: string | null;
  loading: boolean;
  pendingPermissions: PendingPermission[];
  onResume: (sid: string) => void;
  onNew: () => void;
  onDelete: (sid: string, title?: string | null) => void;
  onRename: (sid: string, title?: string | null) => void;
  onViewLogs: (sid: string) => void;
  onRefresh: () => void;
}
