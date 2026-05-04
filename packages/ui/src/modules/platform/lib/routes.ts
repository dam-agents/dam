export type View =
  | "list"
  | "chat"
  | "providers"
  | "connections"
  | "settings"
  | "inbox"
  | "agent-egress";

export function viewToPath(view: View, instance?: string | null, agentId?: string | null): string {
  if (view === "chat" && instance) return `/chat/${encodeURIComponent(instance)}`;
  if (view === "providers") return "/providers";
  if (view === "connections") return "/connections";
  if (view === "settings") return "/settings";
  if (view === "inbox") return "/inbox";
  if (view === "agent-egress" && agentId) return `/agents/${encodeURIComponent(agentId)}/egress`;
  return "/";
}

export function pathToState(path: string): { view: View; instance?: string; agentId?: string } {
  if (path.startsWith("/chat/")) return { view: "chat", instance: decodeURIComponent(path.slice(6)) };
  if (path === "/providers") return { view: "providers" };
  if (path === "/connections") return { view: "connections" };
  if (path === "/settings") return { view: "settings" };
  if (path === "/inbox") return { view: "inbox" };
  const egressMatch = path.match(/^\/agents\/([^/]+)\/egress$/);
  if (egressMatch) return { view: "agent-egress", agentId: decodeURIComponent(egressMatch[1]!) };
  return { view: "list" };
}
